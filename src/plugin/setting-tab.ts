// Settings › Dowse: turning it on for this vault (what that downloads, said first), and once on, where the model runs,
// how far reading is (pausing it), and the room Dowse takes on this computer (the model can be
// removed: it stays in Obsidian's cache otherwise, even once the plugin is gone).

import { type App, type ButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type DowsePlugin from "../main.ts";
import { kindOf } from "../engine/reading/types.ts";
import { prefer, preferred, situation } from "./graphics.ts";
import { sizeText } from "./disk.ts";
import { heldText, modelTrouble, readingText } from "./status.ts";
import { runtimeProblem } from "./compat.ts";

const DOWNLOAD = "542 MB";   // the model's text part, fp16 (measurements/README.md)
const SPEEDUP = "about 8 times";   // an RTX 4070 Ti against the integrated AMD GPU beside it (measurements/README.md)

/** A button that does what it says only when clicked again within a few seconds (said, to a screen reader too): the
 * first click says what it will cost (nothing undoes it). */
function twice(button: ButtonComponent, label: string, cost: () => string, run: () => Promise<void>): void {
  let armed = 0;
  const reset = () => { button.setButtonText(label); button.buttonEl.removeClass("mod-warning"); };
  reset();
  button.buttonEl.setAttr("aria-live", "polite");
  button.onClick(async () => {
    if (!armed) {
      button.setButtonText(cost()).setWarning();
      armed = window.setTimeout(() => { armed = 0; reset(); }, 8000);
      return;
    }
    window.clearTimeout(armed);
    armed = 0;
    button.setDisabled(true);
    await run();
  });
}

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
    const problem = runtimeProblem();
    if (problem) { containerEl.createEl("p", { text: problem, attr: { role: "alert" } }); return; }
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
    this.removeSetting(el);
  }

  private statusEl: HTMLElement | null = null;
  private retryEl: HTMLElement | null = null;
  private indexEl: Setting | null = null;
  private modelEl: Setting | null = null;

  private refreshStatus(): void {
    if (!this.statusEl || !this.plugin.engine) return;
    const { model, status } = this.plugin.engine;
    const where = model.state !== "ready" ? { asleep: "asleep (it wakes when there's something to read)",
      downloading: `downloading, ${Math.round((model.progress ?? 0) * 100)}%`, loading: "starting",
      failed: `couldn't start. ${modelTrouble(model.error).replace(/\.$/, "")}; Dowse tries again every 2 minutes`,
      ready: "" }[model.state]
      : model.device === "webgpu" ? `on the graphics card (WebGPU${model.gpu ? `: ${model.gpu}` : ""})`
      : "on the processor (no WebGPU here: slower)";
    const reading = status.state === "idle" ? "Up to date" : status.state === "waiting" ? "Waiting while you type"
      : status.state === "paused" ? `${heldText(status.held)[0].toUpperCase()}${heldText(status.held).slice(1)}`
      : `${readingText(status)[0].toUpperCase()}${readingText(status).slice(1)}`;
    this.statusEl.setText(`Model: ${where}. ${reading}.` + (status.failed ? ` ${status.failed} couldn't be read.` : ""));
    this.retryEl?.toggle(model.state === "failed" || status.held === "the model couldn't start");
    this.showDisk();
  }

  /** The room Dowse takes, as the engine last measured it (Settings never reads storage itself: see `Engine.disk`). */
  private showDisk(): void {
    const disk = this.plugin.engine?.disk;
    this.indexEl?.setDesc(!disk ? "Measured once reading is done." :
      `${disk.files.toLocaleString()} files, ${disk.passages.toLocaleString()} passages: about ${sizeText(disk.bytes)}, ` +
      `in Obsidian's own storage on this computer (not in the vault, so it isn't synced).`);
    // By part (the text part is the 542 MB the first screen spoke of; pictures and sound are downloaded when turned on)
    const parts = disk ? [["text", disk.modelParts.text], ["pictures", disk.modelParts.pictures],
                          ["sound", disk.modelParts.sound], ["other builds of it", disk.modelOthers]]
      .filter(([, bytes]) => (bytes as number) > 0).map(([name, bytes]) => `${name} ${sizeText(bytes as number)}`).join(" · ") : "";
    this.modelEl?.setDesc(!disk ? "Measured once reading is done." : !disk.model ? "Not downloaded on this computer."
      : `${sizeText(disk.model)} in Obsidian's cache, for all your vaults (${parts}). It stays there if you remove the ` +
        "plugin: to remove it, turn Dowse off for this vault (below), then remove it there.");
  }

  private onView(el: HTMLElement): void {
    const top = el.createDiv({ cls: "dowse-settings-top" });
    this.statusEl = top.createEl("p", { cls: "dowse-settings-status" });
    this.retryEl = top.createEl("button", { text: "Try again" });
    this.retryEl.onclick = () => this.plugin.engine?.retry();
    this.refreshStatus();

    this.graphics(el.createDiv());

    new Setting(el).setName("Reading").setHeading();
    new Setting(el).setName("Pause reading")
      .setDesc("Until you resume it, or Obsidian starts again. Search still works on what's read; the status bar's " +
        "menu pauses and resumes too.")
      .addToggle((toggle) => toggle.setValue(this.plugin.paused).onChange((paused) => this.plugin.setPaused(paused)));
    new Setting(el).setName("Pause on battery")
      .setDesc("Reading waits while this computer runs on its battery, and goes on once it's plugged in.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.batteryPause).onChange(async (on) => {
        this.plugin.settings.batteryPause = on;
        await this.plugin.save();
        this.plugin.setPaused(this.plugin.paused);   // (looked at again now)
      }));

    new Setting(el).setName("Pictures and sound").setHeading();
    new Setting(el).setName("Run the model on")
      .setDesc("Automatic uses WebGPU when it works and falls back to the processor. Choosing the processor also works when a graphics driver is unreliable.")
      .addDropdown(dropdown => dropdown.addOptions({ auto: "Automatic (GPU preferred)", wasm: "Processor" })
        .setValue(this.plugin.settings.device ?? "auto").onChange(async value => {
          this.plugin.settings.device = value === "wasm" ? "wasm" : "auto";
          this.plugin.engine?.unload();
          await this.plugin.save();
          this.plugin.engine?.indexer.resume();
          this.refreshStatus();
        }));
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

    new Setting(el).setName("On this computer").setHeading();
    this.indexEl = new Setting(el).setName("This vault's index");
    this.modelSetting(el);
    this.showDisk();
    new Setting(el).setName("Read everything again")
      .setDesc("Clears this vault's index and reads the vault again from the start.")
      .addButton((button) => twice(button, "Read again", () => `Click again to read ${this.files()} again`, async () => {
        await this.plugin.turnOff(true);
        await this.plugin.turnOn();
        this.display();
      }));
    new Setting(el).setName("Turn Dowse off for this vault")
      .setDesc("Stops reading. Keep the index to turn it back on instantly, or delete it. Your notes are never touched.")
      .addButton((button) => button.setButtonText("Turn off, keep the index").onClick(async () => {
        await this.plugin.turnOff(false);
        this.display();
      }))
      .addButton((button) => twice(button, "Turn off and delete", () => "Click again to delete the index",
        async () => {
          await this.plugin.turnOff(true);
          this.display();
        }));
  }

  /** "280 files", as far as the index knows (else the vault). */
  private files(): string {
    const n = this.plugin.engine?.disk?.files ?? this.app.vault.getFiles().length;
    return `${n.toLocaleString()} file${n === 1 ? "" : "s"}`;
  }

  /** The model's files on this computer: their size, as the engine measured it. Removed once Dowse is off here
   * (`removeSetting`): with Dowse on, it would only be downloaded again. */
  private modelSetting(el: HTMLElement): void {
    this.modelEl = new Setting(el).setName("The search model");
  }

  /** Dowse off here: the model's files removed from this computer (two clicks: the second within a few seconds), the
   * way to leave nothing behind before removing the plugin. Its size isn't shown: Settings never reads storage itself
   * (see `Engine.disk`), and with Dowse off there's no engine to have measured it. */
  private removeSetting(el: HTMLElement): void {
    new Setting(el).setName("Remove the search model from this computer")
      .setDesc("Its files stay in Obsidian's cache, for all your vaults, until removed here, even once the plugin is " +
        "gone. Vaults where Dowse is on download it again when they next need it.")
      .addButton((button) => twice(button, "Remove", () => "Click again to remove", async () => {
        button.setButtonText("Removing…");
        const freed = await this.plugin.removeModel();
        new Notice(freed ? `Dowse's model removed: ${sizeText(freed)} freed.` : "Dowse's model wasn't on this computer.");
        this.display();
      }));
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
