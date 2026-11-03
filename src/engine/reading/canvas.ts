// A canvas (Obsidian's JSON Canvas): each text card read as a short note, with the canvas's title; group labels, links
// and the names of the files on it kept for keyword search (the files themselves are read on their own).

import { lines, passages } from "./markdown.ts";
import { hasWords } from "../searchtext.ts";
import { Prompts, titleOf, type Piece, type Reading } from "./types.ts";

interface CanvasNode { id?: string; type?: string; text?: string; file?: string; url?: string; label?: string }

export function readCanvas(path: string, source: string): Reading {
  let nodes: CanvasNode[] = [];
  try {
    nodes = (JSON.parse(source) as { nodes?: CanvasNode[] }).nodes ?? [];
  } catch {
    return { pieces: [], info: {}, note: "not a canvas Obsidian can read" };
  }
  const title = titleOf(path);
  const pieces: Piece[] = [];
  nodes.forEach((node, index) => {
    if (node.type === "text" && node.text?.trim()) {
      for (const passage of passages(lines(node.text))) {
        pieces.push({ kind: "card", body: passage.text, loc: index,
                      text: hasWords(passage.text) ? Prompts.document(passage.text, title) : null });
      }
    }
  });
  const words = nodes.flatMap((node) => node.type === "group" ? [node.label ?? ""]
    : node.type === "file" ? [node.file?.split("/").pop() ?? ""] : node.type === "link" ? [node.url ?? ""] : [])
    .filter(Boolean).join("\n");
  if (words) pieces.push({ kind: "name", text: null, body: words, loc: null });
  const info: Record<string, unknown> = { cards: nodes.length };
  if (title) info.title = title;
  return pieces.length ? { pieces, info } : { pieces, info, note: "no text" };
}
