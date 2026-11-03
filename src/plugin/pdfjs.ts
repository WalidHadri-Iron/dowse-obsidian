// What Dowse uses of the pdf.js Obsidian carries (`loadPdfJs` answers it untyped): a document's pages, read as text
// (engine/reading/pdf.ts) and drawn (a scan's page for the model, a page for the wall and the floor).

import { loadPdfJs } from "obsidian";

export interface PdfViewport { width: number; height: number }

export interface PdfPage {
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvasContext: OffscreenCanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void>; cancel(): void };
  getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
  cleanup?(): void;
}

export interface PdfDocument {
  numPages: number;
  getPage(number: number): Promise<PdfPage>;
  getMetadata(): Promise<{ info?: { Title?: string } }>;
  destroy(): Promise<void>;
}

interface PdfJs { getDocument(source: { data: Uint8Array; isEvalSupported: boolean }): { promise: Promise<PdfDocument> } }

/** A PDF's bytes opened by Obsidian's pdf.js (no script in it run). */
export async function openPdf(data: ArrayBuffer): Promise<PdfDocument> {
  const pdfjs = (await loadPdfJs()) as PdfJs;
  return pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
}
