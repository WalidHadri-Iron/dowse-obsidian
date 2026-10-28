// The vault, as the indexer reads it: Obsidian's own file list and reads (never the disk behind its back), and PDFs
// through the pdf.js Obsidian carries.

import { loadPdfJs, type App, type TFile } from "obsidian";
import type { Source, VaultFile } from "../engine/indexer.ts";

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

  async pdf(path: string) {
    const pdfjs = await loadPdfJs();
    const data = await this.app.vault.readBinary(this.file(path));
    return pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;   // (it has destroy())
  }
}
