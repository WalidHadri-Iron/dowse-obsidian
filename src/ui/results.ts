// How a result is shown: its title, its line (kind, where in it, folder), whether it's a picture; and how the wall
// takes it.

import type { Hit } from "../engine/search/searcher.ts";
import type { Piece } from "./wall/piece.ts";

export const KIND_NAME: Record<string, string> = {
  note: "Note", pdf: "PDF", canvas: "Canvas", image: "Image", audio: "Recording", video: "Video",
};
export const KIND_ICON: Record<string, string> = {
  note: "file-text", pdf: "file", canvas: "layout-dashboard", image: "image", audio: "audio-lines", video: "film",
};
// The kinds whose face is a picture: images, PDFs' and videos' own; notes' and canvases' pages, drawn (plugin/page.ts)
export const VISUAL = new Set(["image", "pdf", "video", "note", "canvas"]);

/** What the wall and the list need of a file, with or without a search (a recent file has no place in it). */
export interface Shown {
  path: string;
  kind: string;
  loc: number | null;
  locEnd: number | null;
  excerpt: string | null;
  info: Record<string, unknown>;
  score?: number;
  mtime?: number;
  moments?: [number, number | null][];   // additional matching places in the same file, best first
}

export type MediaMoment = [number, number | null];

export function timestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
}

/** Audio embeddings locate a passage, not an aligned spoken word. Show its actual range, never a fake exact time. */
export function momentLabel([start, end]: MediaMoment): string {
  return end !== null && end > start ? `≈ ${timestamp(start)}–${timestamp(Math.ceil(end))}` : timestamp(start);
}

export function mediaMoments(shown: Shown): MediaMoment[] {
  if ((shown.kind !== "audio" && shown.kind !== "video") || shown.loc === null) return [];
  const out: MediaMoment[] = [];
  for (const [start, end] of [[shown.loc, shown.locEnd], ...(shown.moments ?? [])] as MediaMoment[]) {
    if (!Number.isFinite(start) || start < 0 || (end !== null && (!Number.isFinite(end) || end <= start))) continue;
    if (!out.some(m => m[0] === start && m[1] === end)) out.push([start, end]);
  }
  return out.slice(0, 4);
}

export function atMoment(shown: Shown, [loc, locEnd]: MediaMoment): Shown {
  return { ...shown, loc, locEnd };
}

export function nameOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
}

export function folderOf(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join(" › ");
}

/** A note's title (its frontmatter's or first heading's) or else its name. */
export function titleOf(shown: Shown): string {
  const title = shown.info.title;
  return typeof title === "string" && title.trim() && shown.kind === "note" ? title : nameOf(shown.path);
}

/** Where in the file: a note's line, a PDF's page, a recording's moment. */
export function placeOf(shown: Shown): string | null {
  if (shown.loc === null) return null;
  if (shown.kind === "pdf") return `page ${shown.loc}`;
  if (shown.kind === "note") return shown.loc > 0 ? `line ${shown.loc + 1}` : null;   // (its start: nothing to say)
  if (shown.kind === "audio" || shown.kind === "video") {
    return momentLabel([shown.loc, shown.locEnd]);
  }
  return null;
}

/** The small line under a title: kind · where · folder. */
export function lineOf(shown: Shown): string {
  return [KIND_NAME[shown.kind] ?? shown.kind, placeOf(shown), folderOf(shown.path)].filter(Boolean).join(" · ");
}

export function pieceOf(shown: Shown, options: { strong: boolean; closest?: boolean; back?: boolean; score?: number }): Piece {
  return {
    key: shown.path, path: shown.path, kind: shown.kind, loc: shown.loc, name: titleOf(shown), line: lineOf(shown),
    strong: options.strong, closest: options.closest, back: options.back, visual: VISUAL.has(shown.kind),
    excerpt: shown.excerpt, score: options.score,
  };
}

/** An excerpt's runs, the query's words (between « ») marked. */
export function runs(excerpt: string): { text: string; marked: boolean }[] {
  const out: { text: string; marked: boolean }[] = [];
  let marked = false;
  for (const piece of excerpt.replaceAll("»", "«").split("«")) {
    if (piece) out.push({ text: piece, marked });
    marked = !marked;
  }
  return out;
}

export function shownOf(hit: Hit): Shown {
  return { path: hit.path, kind: hit.kind, loc: hit.loc, locEnd: hit.locEnd, excerpt: hit.excerpt && readable(hit.excerpt),
           info: hit.info, score: hit.score, mtime: hit.mtime, moments: hit.moments.map(m => [...m]) };
}

/** An excerpt as it reads, not as it's written: Markdown's tables, emphasis, code marks, links and headings' hashes
 * taken out (the query's « » marks kept). */
export function readable(excerpt: string): string {
  return excerpt
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")         // [[note|shown]] → shown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")                   // [text](url) → text
    .replace(/(^|\s)#{1,6}\s+/g, "$1")                             // heading hashes
    .replace(/\*\*|__|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)|`+/g, "")  // emphasis, code
    .replace(/\s*\|[\s|:-]*\|\s*|\s*\|\s*/g, " · ")             // table cells
    .replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
