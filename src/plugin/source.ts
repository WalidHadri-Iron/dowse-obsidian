// The vault, as the indexer reads it: Obsidian's own file list and reads (never the disk behind its back), PDFs
// through the pdf.js Obsidian carries, pictures and sound decoded by Chromium (sized for the model as Dowse sizes
// them), videos played in a hidden video element from Obsidian's own URL for the file (streamed, never read whole).

import { loadPdfJs, type App, type TFile } from "obsidian";
import type { Pdf, Source, VaultFile } from "../engine/indexer.ts";
import { RATE, targetSize } from "../engine/reading/media.ts";
import type { Picture } from "../engine/protocol.ts";

const LARGEST_SOUND = 300 * 1024 * 1024;   // decoded at once: a larger file's sound isn't read (its pictures still are)

function pixels(canvas: OffscreenCanvas, budget: number): Picture {
  const context = canvas.getContext("2d")!;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return { rgba: data.buffer as ArrayBuffer, width: canvas.width, height: canvas.height, budget };
}

/** A drawable's 8×8 grey levels (for telling a new shot from the same one). */
function grey(source: CanvasImageSource): number[] {
  const canvas = new OffscreenCanvas(8, 8);
  const context = canvas.getContext("2d")!;
  context.drawImage(source, 0, 0, 8, 8);
  const data = context.getImageData(0, 0, 8, 8).data;
  return Array.from({ length: 64 }, (_, i) => 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
}

function once(target: EventTarget, success: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { done(); reject(new Error(`no ${success} in ${timeout / 1000} s`)); }, timeout);
    const ok = () => { done(); resolve(); };
    const failed = () => { done(); reject(new Error("the video couldn't be read")); };
    const done = () => {
      window.clearTimeout(timer);
      target.removeEventListener(success, ok);
      target.removeEventListener("error", failed);
    };
    target.addEventListener(success, ok);
    target.addEventListener("error", failed);
  });
}

export class VaultSource implements Source {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private file(path: string): TFile {
    const file = this.app.vault.getFileByPath(path);
    if (!file) throw new Error(`${path} isn't in the vault any more`);
    return file;
  }

  list(): VaultFile[] {
    return this.app.vault.getFiles().map((f) => ({ path: f.path, mtime: f.stat.mtime, size: f.stat.size }));
  }

  text(path: string): Promise<string> {
    return this.app.vault.cachedRead(this.file(path));
  }

  async pdf(path: string): Promise<Pdf> {
    const pdfjs = await loadPdfJs();
    const data = await this.app.vault.readBinary(this.file(path));
    return pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;   // (it has destroy())
  }

  async picture(path: string, budget: number, minSide: number): Promise<Picture | null> {
    const blob = new Blob([await this.app.vault.readBinary(this.file(path))]);
    let whole: ImageBitmap;
    try {
      whole = await createImageBitmap(blob);
    } catch {
      return null;   // a format Chromium can't decode
    }
    const [height, width] = [whole.height, whole.width];
    whole.close();
    if (Math.min(width, height) < minSide) return null;
    const size = targetSize(height, width, budget);
    if (!size) return null;
    const sized = await createImageBitmap(blob, { resizeWidth: size[1], resizeHeight: size[0], resizeQuality: "high" });
    const canvas = new OffscreenCanvas(sized.width, sized.height);
    canvas.getContext("2d")!.drawImage(sized, 0, 0);
    sized.close();
    return pixels(canvas, budget);
  }

  async page(pdf: Pdf, number: number, budget: number): Promise<Picture | null> {
    const page = await (pdf as any).getPage(number);
    const base = page.getViewport({ scale: 1 });
    const size = targetSize(base.height, base.width, budget);
    if (!size) return null;
    const viewport = page.getViewport({ scale: size[1] / base.width });
    const canvas = new OffscreenCanvas(size[1], size[0]);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return pixels(canvas, budget);
  }

  async sound(path: string): Promise<Float32Array | null> {
    const file = this.file(path);
    if (file.stat.size > LARGEST_SOUND) return null;
    let decoded: AudioBuffer;
    try {
      decoded = await new OfflineAudioContext(1, RATE, RATE).decodeAudioData(await this.app.vault.readBinary(file));
    } catch {
      return null;   // no sound, or none Chromium can decode
    }
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return mono;
  }

  async video(path: string) {
    const element = document.createElement("video");
    element.muted = true;
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    element.src = this.app.vault.getResourcePath(this.file(path));
    try {
      await once(element, "loadedmetadata", 20000);
    } catch {
      element.removeAttribute("src");
      element.load();
      return null;
    }
    if (!element.videoWidth || !Number.isFinite(element.duration)) return null;
    return {
      duration: element.duration,
      frames: async (times: number[], budget: number) => {
        const out = [];
        const size = targetSize(element.videoHeight, element.videoWidth, budget);
        if (!size) return [];
        for (const time of times) {
          element.currentTime = time;
          try {
            await once(element, "seeked", 20000);
          } catch {
            continue;
          }
          const canvas = new OffscreenCanvas(size[1], size[0]);
          canvas.getContext("2d")!.drawImage(element, 0, 0, size[1], size[0]);
          out.push({ time, picture: pixels(canvas, budget), grey: grey(canvas) });
        }
        return out;
      },
      close: () => {
        element.removeAttribute("src");
        element.load();
      },
    };
  }
}
