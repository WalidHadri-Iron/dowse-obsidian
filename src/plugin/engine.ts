// Dowse in one vault: its index, the indexer that keeps it in step, and the model, loaded when there's something to
// read (or search) and let go after 10 idle minutes (it holds a lot of memory), as Dowse does.

import type { App } from "obsidian";
import { Indexer, type Status } from "../engine/indexer.ts";
import { Model } from "../engine/model.ts";
import type { Dtype, Parts } from "../engine/protocol.ts";
import { MODEL_REVISION } from "../engine/protocol.ts";
import { Cancelled } from "../engine/cancel.ts";
import { kindOf } from "../engine/reading/types.ts";
import { Store } from "../engine/store.ts";
import { VaultSearch } from "./search.ts";
import { SearchWorker } from "./search-worker.ts";
import { isOn, type Settings } from "./settings.ts";
import { VaultSource } from "./source.ts";
import { modelSizes } from "./disk.ts";

export const DTYPE: Dtype = "fp16";   // the one build on both the GPU and the processor (measurements/README.md)
export const MODEL_TAG = `embeddinggemma-2/${DTYPE}/${MODEL_REVISION}/1`;
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
  return (app as App & { appId?: string }).appId ?? app.vault.getName();   // (appId isn't in the public API)
}

/** The room Dowse takes on this computer: this vault's index, and the model's files (for all vaults). */
export interface Disk {
  files: number;
  passages: number;
  bytes: number;
  model: number;         // the model's files, all builds
  modelOthers: number;   // of them, other builds than the one used
  modelParts: { text: number; pictures: number; sound: number };   // the one used, by part
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
  private closed = false;
  private epoch = 0;
  private startTask: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  /** Measured by the engine when reading settles, never asked for by Settings: Settings' window froze Obsidian's
   * renderer every time it showed what it had itself just read from IndexedDB or the cache (Obsidian 1.14.5, 2026-10-29;
   * shown through `onChange`, as the status is, it doesn't). */
  disk: Disk | null = null;
  private measuring: Promise<void> | null = null;

  private constructor(store: Store, app: App, settings: () => Settings, you: You) {
    this.store = store;
    this.settings = settings;
    this.indexer = new Indexer(store, new VaultSource(app), {
      active: (path) => !this.closed && !!kindOf(path) && isOn(settings(), path) && !!app.vault.getFileByPath(path),
      parts: () => this.parts(),
      embed: async () => {
        const model = await this.use();
        const read = async <T>(run: () => Promise<T>): Promise<T> => {
          try { return await run(); }
          catch (error) {
            if (model === this.loaded) this.unload();
            throw new Cancelled(error instanceof Error ? error.message : String(error));
          }
        };
        return { texts: (p) => read(() => model.texts(p)), images: (p) => read(() => model.images(p)), audio: (c) => read(() => model.audio(c)) };
      },
      gpu: () => this.model.device !== "wasm",
      busy: you.busy,
      held: you.held,
      onStatus: (status) => {
        if (!this.closed && status.state === "idle" && this.wasReading) {
          this.search.changed(true);
          void this.measure().catch(console.error);
        }
        this.wasReading = status.state !== "idle";
        this.changed();
      },
      onSaved: () => { this.search.changed(); this.changed(); },
    });
    this.search = new VaultSearch(store, {
      ready: () => {
        if (this.loaded?.closed) this.unload();
        if (this.loaded) {
          this.lastUsed = Date.now();
          if (this.model.device !== this.loaded.device) this.setModel({ state: "ready", device: this.loaded.device ?? undefined, gpu: this.loaded.gpu });
        }
        return this.loaded;
      },
      wake: () => void this.use().catch(() => {}),
    }, (path) => !this.closed && !!kindOf(path) && isOn(settings(), path) && !!app.vault.getFileByPath(path), new SearchWorker(store.name));
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
        const none = { total: 0, others: 0, text: 0, pictures: 0, sound: 0 };
        const [index, model] = await Promise.all([this.store.size(), modelSizes(DTYPE).catch(() => none)]);
        this.disk = { ...index, model: model.total, modelOthers: model.others,
                      modelParts: { text: model.text, pictures: model.pictures, sound: model.sound } };
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
    if (this.closed) throw new Cancelled();
    this.lastUsed = Date.now();
    const parts = this.parts();
    if (this.loaded?.closed || (this.loaded && ((parts.image && !this.loaded.parts.image) || (parts.audio && !this.loaded.parts.audio)))) this.unload();
    if (this.loaded) return this.loaded;
    const loading = this.loading ??= this.load();
    try {
      const model = await loading;
      const wanted = this.parts();
      if ((wanted.image && !model.parts.image) || (wanted.audio && !model.parts.audio)) return this.use();
      return model;
    } finally {
      if (this.loading === loading) this.loading = null;
    }
  }

  private async load(): Promise<Model> {
    const epoch = this.epoch;
    this.downloads.clear();
    this.setModel({ state: "loading" });
    const model = this.starting = new Model((file, loaded, total) => {
      if (epoch !== this.epoch || this.closed) return;
      this.downloads.set(file, [loaded, total]);
      const [got, all] = [...this.downloads.values()].reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
      if (all > 0 && got < all) this.setModel({ state: "downloading", progress: got / all });
    }, (device, gpu) => { if (epoch === this.epoch && !this.closed) this.setModel({ state: "ready", device, gpu }); });
    try {
      const device = await model.load(DTYPE, this.settings().device ?? "auto", this.parts());
      if (epoch !== this.epoch || this.closed) { model.close(); throw new Cancelled(); }
      this.loaded = model;
      this.setModel({ state: "ready", device, gpu: model.gpu });
      return model;
    } catch (error) {
      model.close();
      if (epoch === this.epoch && !this.closed)
        this.setModel({ state: "failed", error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      if (this.starting === model) this.starting = null;
    }
  }

  /** The model let go now, a model still loading (downloading) too: it's loaded again when needed. */
  unload(): void {
    this.epoch++;
    this.loading = null;
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
    if (this.closed || this.startTask) return;
    this.startTask = (async () => { await this.indexer.sync(); if (!this.closed) await this.indexer.run(); })();
    void this.startTask.catch((error) => { if (!this.closed) { console.error("Dowse reading stopped", error); this.setModel({ state: "failed", error: String(error) }); } });
  }

  stop(): void {
    this.indexer.stop();
  }

  close(forget = false): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    window.clearInterval(this.timer);
    this.indexer.stop();
    this.unload();
    this.listeners.clear();
    this.closing = (async () => {
      await this.startTask?.catch(() => {});
      await this.indexer.join();
      this.search.close();
      await this.measuring?.catch(() => {});
      if (forget) await this.store.clear();
      this.store.close();
    })();
    return this.closing;
  }
}
