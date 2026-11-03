// The vault, as the indexer reads it: Obsidian's own file list and reads (never the disk behind its back), PDFs
// through the pdf.js Obsidian carries, pictures and sound decoded by Chromium (sized for the model as Dowse sizes
// them), videos played in a hidden video element from Obsidian's own URL for the file (streamed, never read whole).

import { loadPdfJs, type App, type TFile } from "obsidian";
import type { Pdf, Source, VaultFile } from "../engine/indexer.ts";
import { RATE, targetSize } from "../engine/reading/media.ts";
import type { Picture } from "../engine/protocol.ts";
import { abortable, cancelled, checkSound, mediaEvent, SOUND_FILE_BYTES, SOUND_DECODED_BYTES } from "./media-limits.ts";


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

  async page(pdf: Pdf, number: number, budget: number, signal?: AbortSignal): Promise<Picture | null> {
    cancelled(signal);
    const page = await (pdf as any).getPage(number);
    const base = page.getViewport({ scale: 1 });
    const size = targetSize(base.height, base.width, budget);
    if (!size) return null;
    const viewport = page.getViewport({ scale: size[1] / base.width });
    const canvas = new OffscreenCanvas(size[1], size[0]);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const rendering = page.render({ canvasContext: context, viewport });
    const stop = () => rendering.cancel();
    signal?.addEventListener("abort", stop, { once: true });
    try { await abortable(rendering.promise, signal); }
    finally { signal?.removeEventListener("abort", stop); page.cleanup?.(); }
    return pixels(canvas, budget);
  }

  async sound(path: string, signal?: AbortSignal): Promise<Float32Array | null> {
    cancelled(signal);
    const file = this.file(path);
    if (file.stat.size > SOUND_FILE_BYTES) return null;
    const metadata = createEl("audio");
    metadata.preload = "metadata";
    try {
      const ready = mediaEvent(metadata, "loadedmetadata", signal);
      metadata.src = this.app.vault.getResourcePath(file);
      await ready;
      if (!checkSound(file.stat.size, metadata.duration)) return null;
    } catch (error) { cancelled(signal); return null; }
    finally { metadata.removeAttribute("src"); metadata.load(); }
    let decoded: AudioBuffer;
    try {
      const data = await this.app.vault.readBinary(file);
      cancelled(signal);
      decoded = await abortable(new OfflineAudioContext(1, RATE, RATE).decodeAudioData(data), signal);
    } catch {
      cancelled(signal);
      return null;   // no sound, or none Chromium can decode
    }
    if (!checkSound(file.stat.size, decoded.duration) || decoded.length * decoded.numberOfChannels * 4 > SOUND_DECODED_BYTES) return null;
    // Mixing is native asynchronous work, not millions of additions on Obsidian's interface thread.
    const context = new OfflineAudioContext(1, decoded.length, RATE);
    const source = context.createBufferSource(); source.buffer = decoded;
    const splitter = context.createChannelSplitter(decoded.numberOfChannels); source.connect(splitter);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const gain = context.createGain(); gain.gain.value = 1 / decoded.numberOfChannels;
      splitter.connect(gain, channel); gain.connect(context.destination);
    }
    source.start();
    const mixed = await abortable(context.startRendering(), signal);
    return mixed.getChannelData(0).slice();
  }

  async video(path: string, signal?: AbortSignal) {
    cancelled(signal);
    const element = createEl("video");
    element.muted = true;
    element.preload = "auto";
    element.crossOrigin = "anonymous";
    element.src = this.app.vault.getResourcePath(this.file(path));
    try {
      await mediaEvent(element, "loadedmetadata", signal);
    } catch {
      element.removeAttribute("src");
      element.load();
      cancelled(signal); return null;
    }
    if (!element.videoWidth || !Number.isFinite(element.duration)) { element.removeAttribute("src"); element.load(); return null; }
    return {
      duration: element.duration,
      frames: async (times: number[], budget: number) => {
        const out = [];
        const size = targetSize(element.videoHeight, element.videoWidth, budget);
        if (!size) return [];
        for (const time of times) {
          cancelled(signal);
          try {
            const ready = mediaEvent(element, "seeked", signal);
            element.currentTime = time;
            await ready;
          } catch {
            cancelled(signal);
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
