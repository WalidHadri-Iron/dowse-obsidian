// What reading a file gives: pieces, each a passage, a picture or a stretch of sound, and where it is in the file.
// Dowse's `Piece`, for a vault.

import type { Picture } from "../protocol.ts";

export type Kind = "note" | "pdf" | "canvas" | "image" | "audio" | "video";
export type Modality = "text" | "image" | "audio" | "none";

/** Where a piece is: a note's lines, a PDF's page, a canvas card, an image, seconds of a recording or video. */
export interface Piece {
  kind: "passage" | "page" | "card" | "name" | "image" | "frame" | "audio";
  /** What the model reads as text (the prompt included); null: a picture, a sound, or keyword search only. */
  text: string | null;
  picture?: Picture;        // what the model sees
  sound?: Float32Array;     // what it hears (mono, 16 kHz)
  /** The words kept for keyword search, and shown. */
  body: string;
  loc: number | null;
  locEnd?: number | null;
}

export function modalityOf(piece: Piece): Modality {
  return piece.text !== null ? "text" : piece.picture ? "image" : piece.sound ? "audio" : "none";
}

export interface Reading {
  pieces: Piece[];
  /** What's known of the file (its title, pages, passages…), kept with it. */
  info: Record<string, unknown>;
  /** Why it's searched by name only, when it is ("no text"). */
  note?: string;
}

/** What each kind's reader keeps, by version: when one changes, files read before are read again. */
export const READERS: Record<Kind, number> = { note: 2, pdf: 1, canvas: 1, image: 1, audio: 2, video: 3 };

/** The model's parts each kind needs for its content (else it's searched by name, and read once they're on). */
export const NEEDS: Record<Kind, ("image" | "audio")[]> = {
  note: [], pdf: [], canvas: [], image: ["image"], audio: ["audio"], video: ["image", "audio"],
};

const EXTENSIONS: Record<string, Kind> = {
  md: "note", pdf: "pdf", canvas: "canvas",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", avif: "image",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio", flac: "audio", oga: "audio", opus: "audio", "3gp": "audio",
  mp4: "video", webm: "video", mov: "video", m4v: "video", ogv: "video", mkv: "video",
};

/** The kind of a vault file by its extension, or null (not read). */
export function kindOf(path: string): Kind | null {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? null : EXTENSIONS[path.slice(dot + 1).toLowerCase()] ?? null;
}

// Words of file names that say nothing about what's in the file (Dowse's)
const GENERIC = new Set(("img dsc dscn pxl vid mvimg scan doc docs document documents untitled new copy file files " +
  "image photo picture screenshot capture recording final draft version page export download").split(" "));
const JUNK_TITLES = ["untitled", "document", "presentation", "title", "microsoft word - ", "microsoft powerpoint - "];

/** What a file is called: its own title, or else its name when the name says something ("Grandma's soup", not
 * "IMG_1001" or "Untitled 3"). The model reads it with every passage, as it was trained to. */
export function titleOf(path: string, given?: string | null): string | null {
  if (given && !JUNK_TITLES.some((junk) => given.trim().toLowerCase().startsWith(junk))) return given;
  const name = path.split("/").pop() ?? path;
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const parts = stem.split(/[\s_\-.()[\]]+/).filter(Boolean);
  const letters = (word: string) => [...word].filter((c) => /\p{L}/u.test(c)).length;
  return parts.some((w) => letters(w) >= 3 && !GENERIC.has(w.toLowerCase())) ? parts.join(" ") : null;
}

/** EmbeddingGemma 2's prompts (its model card): a document's passage, and a search. */
export const Prompts = {
  document: (text: string, title?: string | null) => `title: ${title || "none"} | text: ${text}`,
  query: (text: string) => `task: search result | query: ${text}`,
};
