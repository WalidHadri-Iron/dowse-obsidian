// Pictures for the wall and the floor: an image straight from the vault (Obsidian's own URL for it), a PDF's page drawn
// by the pdf.js Obsidian carries, a video's still at the moment that matched, a note's or a canvas's page drawn as it
// reads (page.ts, in the theme's colours, at the passage a search matched); kept a while (a few hundred, then the
// oldest go).

import { type App, loadPdfJs } from "obsidian";
import type { Piece } from "../ui/wall/piece.ts";
import { drawPage, PAGE } from "./page.ts";
import { mediaEvent } from "./media-limits.ts";
import { drawExcalidraw, excalidrawRenderer, isExcalidraw } from "./excalidraw.ts";

const KEEP = 200;

export class Pictures {
  private app: App;
  private made = new Map<string, Promise<string | null>>();   // key → blob URL (oldest first)
  private abort = new AbortController();
  private drawings = Promise.resolve();   // rendering several big drawings simultaneously can stall Obsidian

  constructor(app: App) {
    this.app = app;
  }

  picture = (piece: Piece, pixels: number, terms: readonly string[] = []): Promise<string | null> => {
    const file = this.app.vault.getFileByPath(piece.path);
    if (!file) return Promise.resolve(null);
    if (piece.kind === "image") return Promise.resolve(this.app.vault.getResourcePath(file));
    if (piece.kind === "note" && isExcalidraw(this.app, file)) {
      const dark = document.body.hasClass("theme-dark");
      const key = `${piece.path}|drawing@${pixels}|${dark}|${file.stat.mtime}|${file.stat.size}|${excalidrawRenderer(this.app)}`;
      let made = this.made.get(key);
      if (!made) {
        const signal = this.abort.signal;
        made = this.drawings.then(async () => {
          const url = await drawExcalidraw(this.app, file, pixels, dark, signal);
          if (!url) return null;
          // Drawing thumbnails must contain the whole diagram. Ordinary photos may be cropped by the wall/floor.
          let image: ImageBitmap | null = null;
          try {
            const element = new Image();   // (the drawing Excalidraw rendered here, loaded as a picture: nothing fetched)
            element.src = url;
            await element.decode();
            if (signal.aborted) return null;
            image = await createImageBitmap(element);
            if (signal.aborted) return null;
            const width = Math.round(Math.max(96, Math.min(pixels, 4096))), height = Math.round(width * PAGE.height / PAGE.width);
            const canvas = new OffscreenCanvas(width, height), g = canvas.getContext("2d")!;
            g.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
            const [r, green, b, a] = g.getImageData(0, 0, 1, 1).data;
            g.fillStyle = a ? `rgb(${r}, ${green}, ${b})` : dark ? "#1e1e1e" : "#ffffff";
            g.fillRect(0, 0, width, height);
            const scale = Math.min(width / image.width, height / image.height);
            g.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2,
              image.width * scale, image.height * scale);
            const png = await canvas.convertToBlob({ type: "image/png" });
            return signal.aborted ? null : URL.createObjectURL(png);
          } finally { image?.close(); URL.revokeObjectURL(url); }
        }).catch(() => null);
        this.drawings = made.then(() => {});
        this.made.set(key, made);
        const request = made;
        void made.then(url => { if (!url && this.made.get(key) === request) this.made.delete(key); });
        this.trim();
      }
      return made;
    }
    if (piece.kind === "note" || piece.kind === "canvas") {
      const dark = document.body.hasClass("theme-dark");   // (a page in the theme's colours: another theme, another page)
      const from = piece.kind === "note" ? piece.loc ?? 0 : 0;
      const key = `${piece.path}#${from}@${pixels}|${dark}|${file.stat.mtime}|${terms.join(" ")}`;
      let made = this.made.get(key);
      if (!made) {
        made = drawPage(this.app, file, piece.kind, pixels, from, terms).catch(() => null);
        this.made.set(key, made);
        this.trim();
      }
      return made;
    }
    if (piece.kind !== "pdf" && piece.kind !== "video") return Promise.resolve(null);
    const key = `${piece.path}#${piece.loc ?? (piece.kind === "pdf" ? 1 : 0)}@${pixels}|${file.stat.mtime}|${file.stat.size}`;
    let made = this.made.get(key);
    if (!made) {
      made = (piece.kind === "pdf" ? this.page(piece.path, piece.loc ?? 1, pixels) : this.still(piece.path, piece.loc ?? 0, pixels))
        .catch(() => null);
      this.made.set(key, made);
      this.trim();
    }
    return made;
  };

  private async page(path: string, number: number, pixels: number): Promise<string | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const pdfjs = await loadPdfJs();
    const document = await pdfjs.getDocument({ data: new Uint8Array(await this.app.vault.readBinary(file)), isEvalSupported: false }).promise;
    try {
      const page = await document.getPage(Math.min(Math.max(number, 1), document.numPages));
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(pixels / base.width, 4096 / base.height) });
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
    } finally {
      await document.destroy();
    }
  }

  /** A video's picture `time` seconds in (a second in when it's from the start: past a fade from black). */
  private async still(path: string, time: number, pixels: number): Promise<string | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    const video = createEl("video");
    video.muted = true;
    video.preload = "auto";
    const signal = this.abort.signal;
    try {
      const metadata = mediaEvent(video, "loadedmetadata", signal);
      video.src = this.app.vault.getResourcePath(file);
      await metadata;
      if (!video.videoWidth || !Number.isFinite(video.duration)) return null;
      const seeked = mediaEvent(video, "seeked", signal);
        video.currentTime = Math.min(Math.max(time, 1), Math.max(video.duration - 0.1, 0));
      await seeked;
      const scale = Math.min(pixels / video.videoWidth, 4096 / video.videoHeight);
      const width = Math.max(1, Math.round(video.videoWidth * scale)), height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
      return URL.createObjectURL(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 }));
    } finally {
      video.removeAttribute("src");
      video.load();
    }
  }

  private trim(): void {
    while (this.made.size > KEEP) {
      const [key, oldest] = this.made.entries().next().value!;
      this.made.delete(key);
      void oldest.then((url) => url && URL.revokeObjectURL(url));
    }
  }

  clear(): void {
    this.abort.abort(); this.abort = new AbortController();
    for (const made of this.made.values()) void made.then((url) => url && URL.revokeObjectURL(url));
    this.made.clear();
  }
}
