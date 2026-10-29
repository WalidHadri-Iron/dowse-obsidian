// Dowse in one vault: its index, the indexer that keeps it in step, and the model, loaded when there's something to
// read (or search) and let go after 10 idle minutes (it holds a lot of memory), as Dowse does.

import type { App } from "obsidian";
import { Indexer, type Status } from "../engine/indexer.ts";
import { Model } from "../engine/model.ts";
import type { Dtype, Parts } from "../engine/protocol.ts";
import { Store } from "../engine/store.ts";
import { VaultSearch } from "./search.ts";
import { isOn, type Settings } from "./settings.ts";
import { VaultSource } from "./source.ts";
import { modelSizes } from "./disk.ts";

export const DTYPE: Dtype = "fp16";   // the one build on both the GPU and the processor (measurements/README.md)
export const MODEL_TAG = `embeddinggemma-2/${DTYPE}/1`;
const IDLE_MS = 10 * 60 * 1000;

/** What reading waits for: you typing, or reading paused (and why). */
export interface You {
  busy: () => boolean;
  held: () => string | null;
}

export interface ModelState {
  state: "asleep" | "downloading" | "loading" | "ready" | "failed";
  progress?: number;      // 0..1 while downloading
  device?: string;        // "webgpu" or "wasm"
  gpu?: string | null;    // which graphics card (WebGPU's description of it: "nvidia ada-lovelace…")
  error?: string;
}

/** The vault's own key: Obsidian's id for it (one index per vault). */
export function vaultKey(app: App): string {
  return (app as any).appId ?? app.vault.getName();
}

/** The room Dowse takes on this computer: this vault's index, and the model's files (for all vaults). */
export interface Disk {
  files: number;
  passages: number;
  bytes: number;
  model: number;         // the model's files, all builds
  modelOthers: number;   // of them, other builds than the one used
}

export class Engine {
  readonly store: Store;
  readonly indexer: Indexer;
  readonly search: VaultSearch;
  model: ModelState = { state: "asleep" };
  private loaded: Model | null = null;
  private loading: Promise<Model> | null = null;
  private starting: Model | null = null;   // the model being loaded (downloaded), until it's ready
  private lastUsed = 0;
  private timer: number;
  private listeners = new Set<() => void>();
  private downloads = new Map<string, [number, number]>();
  private settings: () => Settings;
  /** Measured by the engine when reading settles, never asked for by Settings: Settings' window froze Obsidian's
   * renderer every time it showed what it had itself just read from IndexedDB or the cache (Obsidian 1.14.5, 2026-10-29;
   * shown through `onChange`, as the status is, it doesn't). */
  disk: Disk | null = null;
  private measuring: Promise<void> | null = null;

  private constructor(store: Store, app: App, settings: () => Settings, you: You) {
    this.store = store;
    this.settings = settings;
    this.indexer = new Indexer(store, new VaultSource(app), {
      active: (path) => isOn(settings(), path),
      parts: () => this.parts(),
      embed: async () => {
        const model = await this.use();
        return { texts: (p) => model.texts(p), images: (p) => model.images(p), audio: (c) => model.audio(c) };
      },
      gpu: () => this.model.device !== "wasm",
      busy: you.busy,
      held: you.held,
      onStatus: (status) => {
        if (status.state === "idle" && this.wasReading) void this.measure();
        this.wasReading = status.state !== "idle";
        this.changed();
      },
      onSaved: () => { this.search.changed(); this.changed(); },
    });
    this.search = new VaultSearch(store, {
      ready: () => { if (this.loaded) this.lastUsed = Date.now(); return this.loaded; },
      wake: () => void this.use().catch(() => {}),
    }, (path) => isOn(settings(), path));
    this.timer = window.setInterval(() => this.sleepIfIdle(), 60 * 1000);
  }

  static async open(app: App, settings: () => Settings, you: You): Promise<Engine> {
    const store = await Store.open(`dowse-${vaultKey(app)}`, MODEL_TAG);
    return new Engine(store, app, settings, you);
  }

  private wasReading = true;   // (so the first idle measures)

  /** The room Dowse takes, measured again (then `onChange`). */
  measure(): Promise<void> {
    this.measuring ??= (async () => {
      try {
        const [index, model] = await Promise.all([this.store.size(), modelSizes(DTYPE).catch(() => ({ total: 0, others: 0 }))]);
        this.disk = { ...index, model: model.total, modelOthers: model.others };
        this.changed();
      } finally {
        this.measuring = null;
      }
    })();
    return this.measuring;
  }

  /** The model tried again now (it couldn't start), and reading looked at again (resumed). */
  retry(): void {
    if (this.model.state === "failed") this.setModel({ state: "asleep" });
    this.indexer.resume();
  }

  get status(): Status {
    return this.indexer.status;
  }

  /** Called on any change worth showing (reading progress, the model's state). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private setModel(state: ModelState): void {
    this.model = state;
    this.changed();
  }

  /** The model's parts that are on (Settings › Dowse). */
  parts(): Parts {
    const settings = this.settings();
    return { image: settings.images, audio: settings.sound };
  }

  /** The model, loaded (downloaded the first time) if it isn't, with the parts that are on. */
  async use(): Promise<Model> {
    this.lastUsed = Date.now();
    const parts = this.parts();
    if (this.loaded && ((parts.image && !this.loaded.parts.image) || (parts.audio && !this.loaded.parts.audio))) {
      this.loaded.close();   // a part was turned on: loaded again with it
      this.loaded = null;
    }
    if (this.loaded) return this.loaded;
    this.loading ??= this.load();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async load(): Promise<Model> {
    this.downloads.clear();
    this.setModel({ state: "loading" });
    const model = this.starting = new Model((file, loaded, total) => {
      this.downloads.set(file, [loaded, total]);
      const [got, all] = [...this.downloads.values()].reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
      if (all > 0 && got < all) this.setModel({ state: "downloading", progress: got / all });
    });
    try {
      const device = await model.load(DTYPE, "auto", this.parts());
      this.loaded = model;
      this.setModel({ state: "ready", device, gpu: model.gpu });
      return model;
    } catch (error) {
      model.close();
      const letGo = this.starting !== model;   // (let go while it loaded: not a failure)
      this.setModel(letGo ? { state: "asleep" } : { state: "failed", error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      if (this.starting === model) this.starting = null;
    }
  }

  /** The model let go now, a model still loading (downloading) too: it's loaded again when needed. */
  unload(): void {
    const starting = this.starting;
    this.starting = null;
    starting?.close();
    this.loaded?.close();
    this.loaded = null;
    if (this.model.state !== "failed") this.setModel({ state: "asleep" });
  }

  private sleepIfIdle(): void {
    const resting = this.indexer.status.state === "idle" || this.indexer.status.state === "paused";
    if (this.loaded && resting && Date.now() - this.lastUsed > IDLE_MS) {
      this.loaded.close();
      this.loaded = null;
      this.setModel({ state: "asleep" });
    }
  }

  start(): void {
    void this.indexer.sync().then(() => this.indexer.run());
  }

  stop(): void {
    this.indexer.stop();
  }

  close(): void {
    window.clearInterval(this.timer);
    this.indexer.stop();
    this.unload();
    this.search.close();
    this.store.close();
    this.listeners.clear();
  }
}
