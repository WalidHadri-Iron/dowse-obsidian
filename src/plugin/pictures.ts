// Pictures for the wall: an image straight from the vault (Obsidian's own URL for it), a PDF's page drawn by the pdf.js
// Obsidian carries, kept a while (a few hundred, then the oldest are let go).

import { type App, loadPdfJs } from "obsidian";
import type { Piece } from "../ui/wall/piece.ts";

const KEEP = 200;

export class Pictures {
  private app: App;
  private made = new Map<string, Promise<string | null>>();   // key → blob URL (oldest first)

  constructor(app: App) {
    this.app = app;
  }

  picture = (piece: Piece, pixels: number): Promise<string | null> => {
    const file = this.app.vault.getFileByPath(piece.path);
    if (!file) return Promise.resolve(null);
    if (piece.kind === "image") return Promise.resolve(this.app.vault.getResourcePath(file));
    if (piece.kind !== "pdf") return Promise.resolve(null);
    const key = `${piece.path}#${piece.loc ?? 1}@${pixels}`;
    let made = this.made.get(key);
    if (!made) {
      made = this.page(piece.path, piece.loc ?? 1, pixels).catch(() => null);
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
