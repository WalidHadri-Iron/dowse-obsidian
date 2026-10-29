// Pictures for the wall and the floor: an image straight from the vault (Obsidian's own URL for it), a PDF's page drawn
// by the pdf.js Obsidian carries, a video's still at the moment that matched, a note's or a canvas's page drawn as it
// reads (page.ts, in the theme's colours, at the passage a search matched); kept a while (a few hundred, then the
// oldest go).

import { type App, loadPdfJs } from "obsidian";
import type { Piece } from "../ui/wall/piece.ts";
import { drawPage } from "./page.ts";

const KEEP = 200;

export class Pictures {
  private app: App;
  private made = new Map<string, Promise<string | null>>();   // key → blob URL (oldest first)

  constructor(app: App) {
    this.app = app;
  }

  picture = (piece: Piece, pixels: number, terms: readonly string[] = []): Promise<string | null> => {
    const file = this.app.vault.getFileByPath(piece.path);
    if (!file) return Promise.resolve(null);
    if (piece.kind === "image") return Promise.resolve(this.app.vault.getResourcePath(file));
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
    const key = `${piece.path}#${piece.loc ?? (piece.kind === "pdf" ? 1 : 0)}@${pixels}`;
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
      const viewport = page.getViewport({ scale: pixels / base.width });
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
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = this.app.vault.getResourcePath(file);
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("unreadable"));
      });
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("unreadable"));
        video.currentTime = Math.min(Math.max(time, 1), Math.max(video.duration - 0.1, 0));
      });
      const height = Math.round(pixels * video.videoHeight / video.videoWidth);
      const canvas = new OffscreenCanvas(pixels, height);
      canvas.getContext("2d")!.drawImage(video, 0, 0, pixels, height);
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
    for (const made of this.made.values()) void made.then((url) => url && URL.revokeObjectURL(url));
    this.made.clear();
  }
}
