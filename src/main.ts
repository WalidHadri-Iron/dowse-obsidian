// Dowse for Obsidian: the vault searched by what's in it. Off until turned on for a vault (that downloads the model);
// then the vault is read in the background and kept up to date, folders and files can be turned off by right-click.

import { Notice, Plugin, type TAbstractFile, TFile, TFolder } from "obsidian";
import { Engine } from "./plugin/engine.ts";
import { DEFAULTS, isOn, turnOff, turnOn, type Settings } from "./plugin/settings.ts";
import { DowseSettingTab } from "./plugin/setting-tab.ts";
import { statusText } from "./plugin/status.ts";

const QUIET_MS = 2000;   // a file being edited is read again once it's been still this long (as Dowse waits)
const TYPING_MS = 1500;  // reading waits while you've typed this recently

export default class DowsePlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  engine: Engine | null = null;
  private statusBar!: HTMLElement;
  private lastKey = 0;
  private quiet = new Map<string, number>();

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...(await this.loadData()) };
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("dowse-status");
    this.statusBar.onClickEvent(() => this.openSettings());
    this.addSettingTab(new DowseSettingTab(this.app, this));
    this.registerDomEvent(document, "keydown", () => (this.lastKey = Date.now()), { capture: true });
    this.registerEvents();
    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.on) await this.start();
      this.showStatus();
      if (DEV) (await import("./dev/hooks.ts")).run(this);
    });
  }

  onunload(): void {
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
    this.engine.onChange(() => this.showStatus());
    this.engine.start();
  }

  async turnOn(): Promise<void> {
    this.settings.on = true;
    await this.save();
    await this.start();
    this.showStatus();
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
