// What the views ask of the plugin: one interface, so the Svelte views don't reach into Obsidian or the engine.

import type { Answer } from "../plugin/search.ts";
import type { Piece } from "./wall/piece.ts";
import type { Shown } from "./results.ts";

export interface Controller {
  /** Dowse is on for this vault (else the views offer to turn it on). */
  on(): boolean;
  turnOn(): Promise<void>;
  search(query: string, kinds: string[]): Promise<Answer>;
  similar(path: string): Promise<Answer>;
  recent(): Promise<Shown[]>;
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
  /** Called on anything worth showing again (the index, the model, the theme); returns how to stop. */
  subscribe(listener: () => void): () => void;
}
