// Dowse for Obsidian: the vault searched by what's in it. Off until turned on for a vault (that downloads the model);
// then the vault is read in the background and kept up to date, folders and files can be turned off by right-click.

import { Notice, Plugin, type TAbstractFile, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { Engine } from "./plugin/engine.ts";
import { linkTo, openShown } from "./plugin/open.ts";
import { Pictures } from "./plugin/pictures.ts";
import { DEFAULTS, isOn, turnOff, turnOn, type Settings } from "./plugin/settings.ts";
import { DowseSettingTab } from "./plugin/setting-tab.ts";
import { statusText } from "./plugin/status.ts";
import { ICON, QuickSearch, SEARCH_VIEW, SIMILAR_VIEW, SearchView, SimilarView } from "./plugin/views.ts";
import type { Controller } from "./ui/controller.ts";

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
  controller!: Controller;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("dowse-status");
    this.statusBar.onClickEvent(() => this.openSettings());
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
    this.registerEvent(this.app.workspace.on("css-change", () => this.notify()));
    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.on) await this.start();
      this.showStatus();
      if (DEV) (await import("./dev/hooks.ts")).run(this);
    });
  }

  onunload(): void {
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
    this.engine = await Engine.open(this.app, () => this.settings, () => Date.now() - this.lastKey < TYPING_MS);
    this.engine.onChange(() => { this.showStatus(); this.notify(); });
    this.engine.start();
    this.notify();
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
      picture: (piece, pixels) => this.pictures.picture(piece, pixels),
      open: (shown, newTab) => void openShown(this.app, shown, newTab),
      link: (path) => linkTo(this.app, path, this.app.workspace.getActiveFile()?.path ?? ""),
      hover: (event, path, target) => this.app.workspace.trigger("hover-link", {
        event, source: "dowse", hoverParent: target, targetEl: target, linktext: path, sourcePath: "",
      }),
      status: () => this.engine ? statusText(this.engine) : "",
      ready: () => this.engine?.model.state === "ready",
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
    await this.engine?.indexer.sync();
    this.showStatus();
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
