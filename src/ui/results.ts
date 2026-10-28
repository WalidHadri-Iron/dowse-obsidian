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
export const VISUAL = new Set(["image", "pdf", "video"]);

/** What the wall and the list need of a file, with or without a search (a recent file has no place in it). */
export interface Shown {
  path: string;
  kind: string;
  loc: number | null;
  locEnd: number | null;
  excerpt: string | null;
  info: Record<string, unknown>;
  score?: number;
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
  if (shown.kind === "note") return `line ${shown.loc + 1}`;
  if (shown.kind === "audio" || shown.kind === "video") {
    const s = Math.round(shown.loc);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  return { path: hit.path, kind: hit.kind, loc: hit.loc, locEnd: hit.locEnd, excerpt: hit.excerpt, info: hit.info, score: hit.score };
}
