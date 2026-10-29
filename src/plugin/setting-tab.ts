// Settings › Dowse: turning it on for this vault (what that downloads, said first), and once on, where the model runs,
// how far reading is, and what's turned off.

import { type App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DowsePlugin from "../main.ts";
import { DTYPE } from "./engine.ts";
import { isOn, plainExclusions } from "./settings.ts";
import { kindOf } from "../engine/reading/types.ts";
import { prefer, preferred, situation } from "./graphics.ts";

const DOWNLOAD = "542 MB";   // the model's text part, fp16 (measurements/README.md)
const SPEEDUP = "about 8 times";   // an RTX 4070 Ti against the integrated AMD GPU beside it (measurements/README.md)

export class DowseSettingTab extends PluginSettingTab {
  private plugin: DowsePlugin;
  private unsubscribe: (() => void) | null = null;

  constructor(app: App, plugin: DowsePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("dowse-settings");
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!this.plugin.settings.on) return this.offView(containerEl);
    this.onView(containerEl);
    let pending = 0;
    this.unsubscribe = this.plugin.engine?.onChange(() => {   // live, without redrawing on every passage
      if (pending) return;
      pending = window.setTimeout(() => { pending = 0; this.refreshStatus(); }, 500);
    }) ?? null;
  }

  hide(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private offView(el: HTMLElement): void {
    el.createEl("p", { text: "Dowse reads this vault's notes, PDFs and canvases, and lets you search them by what " +
      "they're about, in your own words and in any of 100+ languages. Everything stays on this computer." });
    el.createEl("p", { cls: "setting-item-description", text: `Turning it on downloads the search model, ` +
      `EmbeddingGemma 2 (${DOWNLOAD}, from Hugging Face), once for all your vaults. Then this vault is read in the ` +
      `background, which takes a while the first time; you can keep working meanwhile.` });
    new Setting(el).setName("Search this vault with Dowse").addButton((button) => button
      .setButtonText("Turn on").setCta().onClick(async () => {
        await this.plugin.turnOn();
        this.display();
      }));
  }

  private statusEl: HTMLElement | null = null;

  private refreshStatus(): void {
    if (!this.statusEl || !this.plugin.engine) return;
    const { model, status } = this.plugin.engine;
    const where = model.state !== "ready" ? { asleep: "asleep (it wakes when there's something to read)",
      downloading: `downloading, ${Math.round((model.progress ?? 0) * 100)}%`, loading: "starting",
      failed: `couldn't start: ${model.error}`, ready: "" }[model.state]
      : model.device === "webgpu" ? `on the graphics card (WebGPU${model.gpu ? `: ${model.gpu}` : ""})`
      : "on the processor (no WebGPU here: slower)";
    const reading = status.state === "idle" ? "Up to date" : status.state === "waiting" ? "Waiting while you type"
      : `Reading ${Math.min(status.done + 1, status.total)} of ${status.total}`;
    this.statusEl.setText(`Model: ${where}. ${reading}.` + (status.failed ? ` ${status.failed} couldn't be read.` : ""));
  }

  private onView(el: HTMLElement): void {
    this.statusEl = el.createEl("p", { cls: "dowse-settings-status" });
    this.refreshStatus();

    this.graphics(el.createDiv());

    el.createEl("h3", { text: "Pictures and sound" });
    const counts = { image: 0, audio: 0, video: 0, pdf: 0 } as Record<string, number>;
    for (const file of this.app.vault.getFiles()) {
      const kind = kindOf(file.path);
      if (kind && kind in counts) counts[kind]++;
    }
    const many = (n: number, one: string, more: string) => `${n.toLocaleString()} ${n === 1 ? one : more}`;
    new Setting(el).setName("Read images")
      .setDesc(`What images show, the scanned pages of PDFs, and videos' pictures: this vault has ` +
        `${many(counts.image, "image", "images")} and ${many(counts.video, "video", "videos")}. Downloads the model's ` +
        `image part (336 MB) once. Off, they're found by name.`)
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.images)
        .onChange(async (on) => { await this.plugin.setParts({ images: on }); this.refreshStatus(); }));
    new Setting(el).setName("Read recordings and videos' sound")
      .setDesc(`What's said and heard: this vault has ${many(counts.audio, "recording", "recordings")} and ` +
        `${many(counts.video, "video", "videos")}. Downloads the model's audio part (587 MB) once. Off, they're found ` +
        `by name.`)
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.sound)
        .onChange(async (on) => { await this.plugin.setParts({ sound: on }); this.refreshStatus(); }));

    el.createEl("h3", { text: "What's searched" });
    el.createEl("p", { cls: "setting-item-description", text: "The whole vault, except what you turn off: " +
      "right-click a folder or file and choose “Dowse: stop searching”. What's turned off keeps what was " +
      "read of it, so turning it back on is instant." });
    const off = this.plugin.settings.off;
    if (!off.length) el.createEl("p", { cls: "setting-item-description", text: "Nothing is turned off." });
    for (const path of off) {
      new Setting(el).setName(path).addButton((button) => button.setButtonText("Search again").onClick(async () => {
        await this.plugin.setSearched(path, true);
        this.display();
      }));
    }
    const excluded = plainExclusions((this.app.vault as any).getConfig?.("userIgnoreFilters"))
      .filter((path) => isOn(this.plugin.settings, path));
    if (excluded.length) {
      new Setting(el).setName("Obsidian's excluded files")
        .setDesc(`Also turn off what Settings › Files and links excludes: ${excluded.join(", ")}.`)
        .addButton((button) => button.setButtonText("Turn them off").onClick(async () => {
          for (const path of excluded) await this.plugin.setSearched(path, false);
          this.display();
        }));
    }

    el.createEl("h3", { text: "This vault's index" });
    new Setting(el).setName("Read everything again")
      .setDesc("Clears this vault's index and reads the vault again from the start.")
      .addButton((button) => button.setButtonText("Read again").onClick(async () => {
        await this.plugin.turnOff(true);
        await this.plugin.turnOn();
        this.display();
      }));
    new Setting(el).setName("Turn Dowse off for this vault")
      .setDesc("Stops reading. Keep the index to turn it back on instantly, or delete it.")
      .addButton((button) => button.setButtonText("Turn off, keep the index").onClick(async () => {
        await this.plugin.turnOff(false);
        this.display();
      }))
      .addButton((button) => button.setButtonText("Turn off and delete").setWarning().onClick(async () => {
        await this.plugin.turnOff(true);
        this.display();
      }));

    el.createEl("p", { cls: "setting-item-description", text: `Model build: ${DTYPE}.` });
  }

  /** A PC with a graphics card and an integrated GPU: run Obsidian on the card (Windows' own preference for it). Only
   * shown when there's a card to choose. */
  private async graphics(el: HTMLElement): Promise<void> {
    const { faster, on } = await situation(this.plugin.engine?.model.gpu);
    if (!faster) return;
    const chosen = await preferred();
    const now = on === true ? `Dowse reads on it now.` : on === false ? `Dowse reads on the integrated graphics now${chosen ? ", until Obsidian starts again" : ""}.` : "";
    new Setting(el).setName(`Run Obsidian on the ${faster}`)
      .setDesc(`Windows gives Obsidian its integrated graphics unless told otherwise; the model reads ${SPEEDUP} faster ` +
        `on a graphics card. ${now} This sets Windows' graphics preference for Obsidian (Settings › System › Display ` +
        `› Graphics); it applies when Obsidian starts again.`)
      .addToggle((toggle) => toggle.setValue(chosen).onChange(async (high) => {
        try {
          await prefer(high);
          new Notice(`Quit Obsidian and open it again: it will run on ${high ? `the ${faster}` : "the graphics Windows chooses"}.`, 10000);
        } catch (error) {
          toggle.setValue(!high);
          new Notice(`Windows' graphics preference couldn't be changed: ${error instanceof Error ? error.message : error}`);
        }
      }));
  }
}
