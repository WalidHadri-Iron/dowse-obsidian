// What the views ask of the plugin: one interface, so the Svelte views don't reach into Obsidian or the engine.

import type { Answer } from "../plugin/search.ts";
import type { ExploreMap } from "../engine/search/explore.ts";
import type { Piece } from "./wall/piece.ts";
import type { Shown } from "./results.ts";

/** Reading as the views show it: the model (its download), how far reading is, and whether and why it's paused. */
export interface Reading {
  model: "asleep" | "downloading" | "loading" | "ready" | "failed";
  progress: number | null;   // the model's download, 0..1
  error?: string;
  state: "idle" | "reading" | "waiting" | "paused" | "stopped";
  done: number;
  total: number;
  left: number | null;       // seconds, about
  held?: string;             // why it's paused
  paused: boolean;           // paused by the person
}

export interface Controller {
  /** Dowse is on for this vault (else the views offer to turn it on). */
  on(): boolean;
  turnOn(): Promise<void>;
  search(query: string, kinds: string[]): Promise<Answer>;
  similar(path: string): Promise<Answer>;
  recent(): Promise<Shown[]>;
  /** Explore's map of the vault (aisles of files that are alike). */
  explore(): Promise<ExploreMap>;
  picture(piece: Piece, pixels: number, terms: string[]): Promise<string | null>;
  open(shown: Shown, newTab: boolean): void;
  /** A result dragged into a note: its link. */
  link(path: string): string | null;
  /** Obsidian's hover preview of a file, as its links show one. */
  hover(event: MouseEvent, path: string, target: HTMLElement): void;
  /** The status line: reading, the model, up to date. */
  status(): string;
  /** The model is there (meaning, not words alone). */
  ready(): boolean;
  dark(): boolean;
  /** The vault's files by kind (the first screen says what will be read). */
  counts(): Record<string, number>;
  reading(): Reading;
  pause(paused: boolean): void;
  /** The model tried again (it couldn't start). */
  retry(): void;
  /** Told when what the views show (the latest files, the map) was made again; returns how to stop. */
  follow(listener: () => void): () => void;
  /** A file's title as the views give it: a note's frontmatter title or first heading, else its name. */
  title(path: string): string;
  /** The notes `path` links to and those linking to it. */
  linked(path: string): Set<string>;
  /** A link to `target` written into the note `into` (at its cursor if it's being edited, else at its end). */
  insertLink(into: string, target: string): Promise<"cursor" | "end" | null>;
  /** Called on anything worth showing again (the index, the model, the theme); returns how to stop. */
  subscribe(listener: () => void): () => void;
}
