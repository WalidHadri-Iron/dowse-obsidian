// A PDF, read as Dowse reads one: each page with text a passage of its own, with the document's title; a page with
// little text (a scan, a slide) is for its picture (read once the model's image part is there), its few words kept for
// keyword search meanwhile. Read in steps of pages, so a long PDF is saved as it goes.

import { hasWords } from "../searchtext.ts";
import { Prompts, titleOf, type Piece } from "./types.ts";

export const MIN_PAGE_TEXT = 200;   // fewer characters: the page is read as a picture
export const PDF_STEP = 30;          // pages a step
export const MAX_PAGES = 5000;

/** What's needed of a PDF (pdf.js's document, as Obsidian's `loadPdfJs` gives it). */
export interface PdfLike {
  numPages: number;
  getMetadata(): Promise<{ info?: { Title?: string } }>;
  getPage(number: number): Promise<{ getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }> }>;
}

export async function pageText(pdf: PdfLike, number: number): Promise<string> {
  const content = await (await pdf.getPage(number)).getTextContent();
  let text = "";
  for (const item of content.items) {
    if (item.str) text += item.str;
    text += item.hasEOL ? "\n" : item.str ? " " : "";
  }
  return text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export interface PdfStep { pieces: Piece[]; info: Record<string, unknown>; next: number | null }

/** The pages from `start` (0-based) for one step; `next` is where the following step starts, or null at the end. */
export async function readPdfStep(path: string, pdf: PdfLike, start: number): Promise<PdfStep> {
  const total = pdf.numPages;
  const end = Math.min(total, MAX_PAGES);
  const metadata: { info?: { Title?: string } } = await pdf.getMetadata().catch(() => ({}));
  const given = metadata.info?.Title?.trim() || null;
  const title = titleOf(path, given);
  const stop = Math.min(start + PDF_STEP, end);
  const pieces: Piece[] = [];
  const pictures: number[] = [];
  for (let index = start; index < stop; index++) {
    const number = index + 1;   // as pages are numbered (and linked: file.pdf#page=3)
    const text = await pageText(pdf, number);
    if (text.length < MIN_PAGE_TEXT) {
      pictures.push(number);
      if (text) pieces.push({ kind: "page", text: null, body: text, loc: number });
    } else {
      pieces.push({ kind: "page", text: hasWords(text) ? Prompts.document(text, title) : null, body: text, loc: number });
    }
  }
  const info: Record<string, unknown> = { pages: total };
  if (given) info.title = given;
  if (pictures.length) info.pictures = pictures;
  return { pieces, info, next: stop < end ? stop : null };
}
