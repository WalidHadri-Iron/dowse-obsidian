// Dowse for Obsidian: the vault searched by what's in it. Off until turned on for a vault (that downloads the model);
// then the vault is read in the background and kept up to date, folders and files can be turned off by right-click.
// Reading can be paused (the status bar's menu, a command), until resumed or Obsidian starts again; and while on battery.

import { MarkdownView, Menu, Notice, Plugin, type TAbstractFile, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { Engine } from "./plugin/engine.ts";
import { linkTo, openShown } from "./plugin/open.ts";
import { Pictures } from "./plugin/pictures.ts";
import { DEFAULTS, isOn, turnOff, turnOn, type Settings } from "./plugin/settings.ts";
import { DowseSettingTab } from "./plugin/setting-tab.ts";
import { statusText } from "./plugin/status.ts";
import { Power } from "./plugin/power.ts";
import { removeModel } from "./plugin/disk.ts";
import { kindOf } from "./engine/reading/types.ts";
import { preferred, situation } from "./plugin/graphics.ts";
import { ICON, QuickSearch, SEARCH_VIEW, SIMILAR_VIEW, SearchView, SimilarView } from "./plugin/views.ts";
import type { Controller, Reading } from "./ui/controller.ts";

const QUIET_MS = 2000;   // a file being edited is read again once it's been still this long (as Dowse waits)
const TYPING_MS = 1500;  // reading waits while you've typed this recently

export default class DowsePlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  engine: Engine | null = null;
  private statusBar!: HTMLElement;
  private lastKey = 0;
  private quiet = new Map<string, number>();
  private listeners = new Set<() => void>();
  private pictures!: Pictures;
  private power!: Power;
  private followers = new Set<() => void>();
  paused = false;   // the person paused reading (until resumed, or Obsidian starts again)
  controller!: Controller;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("dowse-status");
    this.statusBar.onClickEvent((event) => this.statusMenu(event));
    this.statusBar.setAttr("aria-label", "Dowse: pause, resume, settings");
    this.power = new Power(() => { this.engine?.indexer.resume(); this.showStatus(); this.notify(); });
    this.addSettingTab(new DowseSettingTab(this.app, this));
    this.registerDomEvent(document, "keydown", () => (this.lastKey = Date.now()), { capture: true });
    this.registerEvents();
    this.pictures = new Pictures(this.app);
    this.controller = this.makeController();
    this.registerView(SEARCH_VIEW, (leaf) => new SearchView(leaf, this.controller));
    this.registerView(SIMILAR_VIEW, (leaf) => new SimilarView(leaf, this.controller));
    this.registerHoverLinkSource("dowse", { display: "Dowse", defaultMod: true });
    this.addRibbonIcon(ICON, "Dowse: search the vault by what's in it", () => void this.openSearch());
    this.addCommand({ id: "search", name: "Search the vault", callback: () => new QuickSearch(this.app, this.controller).open() });
    this.addCommand({ id: "open", name: "Open Dowse", callback: () => void this.openSearch() });
    this.addCommand({ id: "similar", name: "Show what's like this note", callback: () => void this.openSimilar() });
    this.addCommand({ id: "pause", name: "Pause or resume reading", checkCallback: (checking) => {
      if (!this.engine) return false;
      if (!checking) this.setPaused(!this.paused);
      return true;
    } });
    this.registerEvent(this.app.workspace.on("css-change", () => this.notify()));
    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.on) await this.start();
      this.showStatus();
      if (DEV) (await import("./dev/hooks.ts")).run(this);
    });
  }

  onunload(): void {
    this.power.close();
    this.pictures.clear();
    this.engine?.close();
    for (const timer of this.quiet.values()) window.clearTimeout(timer);
  }

  async save(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Dowse on for this vault: the index opened, the vault read (the model downloaded, the first time). */
  async start(): Promise<void> {
    if (this.engine) return;
    this.engine = await Engine.open(this.app, () => this.settings, {
      busy: () => Date.now() - this.lastKey < TYPING_MS,
      held: () => this.held(),
    });
    this.engine.onChange(() => { this.showStatus(); this.notify(); this.hintGraphics(); });
    this.engine.search.follow({
      wanted: () => this.followers.size > 0,
      made: () => { for (const follower of this.followers) follower(); },
    });
    this.engine.start();
    this.notify();
  }

  /** Why reading waits, if it does: the person paused it, or the computer is on its battery (and that's asked). */
  private held(): string | null {
    return this.paused ? "paused" : this.settings.batteryPause && this.power.onBattery ? "on battery" : null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.engine?.indexer.resume();   // (looked at now, not in half a second)
    this.showStatus();
    this.notify();
  }

  /** The status bar's menu: pause or resume, try the model again, the Dowse tab, the settings. */
  private statusMenu(event: MouseEvent): void {
    const menu = new Menu();
    const engine = this.engine;
    if (engine && (engine.model.state === "failed" || engine.status.held === "the model couldn't start")) {
      menu.addItem((item) => item.setTitle("Try to start the model again").setIcon("refresh-cw").onClick(() => engine.retry()));
    }
    if (engine && (this.paused || engine.status.state === "reading" || engine.status.state === "waiting")) {
      menu.addItem((item) => item.setTitle(this.paused ? "Resume reading" : "Pause reading")
        .setIcon(this.paused ? "play" : "pause").onClick(() => this.setPaused(!this.paused)));
    }
    menu.addItem((item) => item.setTitle("Open Dowse").setIcon(ICON).onClick(() => void this.openSearch()));
    menu.addItem((item) => item.setTitle("Dowse settings").setIcon("settings").onClick(() => this.openSettings()));
    menu.showAtMouseEvent(event);
  }

  /** Reading as the views show it. */
  private reading(): Reading {
    const engine = this.engine;
    if (!engine) return { model: "asleep", progress: null, state: "idle", done: 0, total: 0, left: null, paused: this.paused };
    const { model, status } = engine;
    return { model: model.state, progress: model.progress ?? null, error: model.error, state: status.state, done: status.done,
             total: status.total, left: status.left ?? null, held: status.held, paused: this.paused };
  }

  /** The notes `path` links to, and those that link to it. */
  private linked(path: string): Set<string> {
    const resolved = this.app.metadataCache.resolvedLinks;
    const linked = new Set(Object.keys(resolved[path] ?? {}));
    for (const [from, to] of Object.entries(resolved)) if (to[path]) linked.add(from);
    return linked;
  }

  /** A link to `target` written into the note `into`: at its cursor when it's open for editing, else at its end. */
  private async insertLink(into: string, target: string): Promise<"cursor" | "end" | null> {
    const link = linkTo(this.app, target, into);
    const note = this.app.vault.getFileByPath(into);
    if (!link || !note) return null;
    const view = this.app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === into && v.getMode() === "source");
    if (view) {
      view.editor.replaceSelection(link);
      return "cursor";
    }
    await this.app.vault.process(note, (text) => `${text}${text.endsWith("\n") || !text ? "" : "\n"}${link}\n`);
    return "end";
  }

  /** Once: the model runs on the integrated GPU while a faster card is there (Settings › Dowse can switch). */
  private hintGraphics(): void {
    const model = this.engine?.model;
    if (this.settings.graphicsHinted || model?.state !== "ready" || model.device !== "webgpu") return;
    this.settings.graphicsHinted = true;
    void this.save();
    void situation(model.gpu).then(async ({ faster, on }) => {
      if (faster && on === false && !(await preferred()))
        new Notice(`Dowse reads on the integrated graphics. Your ${faster} is much faster: Settings › Dowse can ` +
                   `switch Obsidian to it.`, 15000);
    });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private makeController(): Controller {
    const empty = { query: "", hits: [], strong: 0, terms: [], meaning: false, ms: 0 };
    return {
      on: () => this.settings.on && this.engine !== null,
      turnOn: () => this.turnOn(),
      search: async (query, kinds) => this.engine ? this.engine.search.search(query, { kinds }) : { ...empty, query },
      similar: async (path) => this.engine ? this.engine.search.similar(path) : empty,
      recent: async () => this.engine ? this.engine.search.recent() : [],
      explore: async () => this.engine ? this.engine.search.explore() : { aisles: [], pieces: [], total: 0, membership: {} },
      picture: (piece, pixels) => this.pictures.picture(piece, pixels),
      open: (shown, newTab) => void openShown(this.app, shown, newTab),
      link: (path) => linkTo(this.app, path, this.app.workspace.getActiveFile()?.path ?? ""),
      hover: (event, path, target) => this.app.workspace.trigger("hover-link", {
        event, source: "dowse", hoverParent: target, targetEl: target, linktext: path, sourcePath: "",
      }),
      status: () => this.engine ? statusText(this.engine) : "",
      ready: () => this.engine?.model.state === "ready",
      counts: () => {
        const counts: Record<string, number> = {};
        for (const file of this.app.vault.getFiles()) {
          const kind = kindOf(file.path);
          if (kind) counts[kind] = (counts[kind] ?? 0) + 1;
        }
        return counts;
      },
      reading: () => this.reading(),
      pause: (paused) => this.setPaused(paused),
      retry: () => this.engine?.retry(),
      follow: (listener) => { this.followers.add(listener); return () => this.followers.delete(listener); },
      linked: (path) => this.linked(path),
      insertLink: (into, target) => this.insertLink(into, target),
      dark: () => document.body.hasClass("theme-dark"),
      subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
    };
  }

  /** The Dowse tab: the one open, else a new one. */
  async openSearch(query = ""): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(SEARCH_VIEW)[0];
    const leaf: WorkspaceLeaf = open ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: SEARCH_VIEW, active: true, state: query ? { query } : {} });
    await this.app.workspace.revealLeaf(leaf);
  }

  async openSimilar(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(SIMILAR_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: SIMILAR_VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async turnOn(): Promise<void> {
    this.settings.on = true;
    await this.save();
    await this.start();
    this.showStatus();
    this.notify();
  }

  /** The model's files removed from this computer (a model loading or loaded let go first); answers the bytes freed. */
  async removeModel(): Promise<number> {
    this.engine?.unload();
    return removeModel().catch(() => 0);
  }

  /** Off for this vault: reading stops; `forget` also deletes the index. */
  async turnOff(forget: boolean): Promise<void> {
    this.settings.on = false;
    await this.save();
    const engine = this.engine;
    this.engine = null;
    if (engine && forget) await engine.store.clear();
    engine?.close();
    this.showStatus();
    this.notify();
  }

  async setSearched(path: string, searched: boolean): Promise<void> {
    this.settings = searched ? turnOn(this.settings, path) : turnOff(this.settings, path);
    await this.save();
    this.engine?.search.changed();   // found, or not, from the next search on
    await this.engine?.indexer.sync();
    this.showStatus();
  }

  /** The model's image or sound part turned on or off: what waited for it is read (the model loads it then). */
  async setParts(change: { images?: boolean; sound?: boolean }): Promise<void> {
    this.settings = { ...this.settings, ...change };
    await this.save();
    await this.engine?.indexer.sync();
    this.showStatus();
    this.notify();
  }

  showStatus(): void {
    const text = this.engine ? statusText(this.engine) : "";
    this.statusBar.setText(text);
    this.statusBar.toggle(Boolean(text));
  }

  openSettings(): void {
    const setting = (this.app as any).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  private registerEvents(): void {
    const file = (f: TAbstractFile) => f instanceof TFile ? { path: f.path, mtime: f.stat.mtime, size: f.stat.size } : null;
    const later = (f: TAbstractFile) => {   // once the file has been still a moment (an edit is many saves)
      window.clearTimeout(this.quiet.get(f.path));
      this.quiet.set(f.path, window.setTimeout(() => {
        this.quiet.delete(f.path);
        const now = file(f);
        if (now && this.engine) void this.engine.indexer.changed(now);
      }, QUIET_MS));
    };
    this.registerEvent(this.app.vault.on("create", (f) => this.engine && later(f)));
    this.registerEvent(this.app.vault.on("modify", (f) => this.engine && later(f)));
    this.registerEvent(this.app.vault.on("delete", (f) => void this.engine?.indexer.removed(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f, old) => void this.engine?.indexer.renamed(old, f.path)));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, target) => {
      if (!this.settings.on || !(target instanceof TFile || target instanceof TFolder) || target.path === "/") return;
      const searched = isOn(this.settings, target.path);
      menu.addItem((item) => item
        .setTitle(searched ? "Dowse: stop searching" : "Dowse: search again")
        .setIcon(searched ? "search-x" : "search")
        .onClick(async () => {
          await this.setSearched(target.path, !searched);
          new Notice(searched ? `Dowse won't search ${target.name}` : `Dowse searches ${target.name} again`);
        }));
    }));
  }
}
