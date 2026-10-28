// A note, read as Dowse reads a document (passages of ~1,800 characters overlapping a little, each with the note's
// title), and as a note is written: frontmatter (title, tags, aliases) set apart, links read as their words, embeds and
// comments left out, and passages cut at headings and line ends, each knowing its lines (a result opens there).

import { chunks, hasWords } from "../searchtext.ts";
import { Prompts, titleOf, type Piece, type Reading } from "./types.ts";

export const PASSAGE = 1800;
export const OVERLAP = 200;

interface Frontmatter { title?: string; tags: string[]; aliases: string[]; lines: number }

/** The YAML block at the top: the title, tags and aliases (as Obsidian reads them), and how many lines it takes. */
export function frontmatter(lines: string[]): Frontmatter {
  const out: Frontmatter = { tags: [], aliases: [], lines: 0 };
  if (lines[0]?.trim() !== "---") return out;
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return out;
  out.lines = end + 1;
  let list: "tags" | "aliases" | null = null;
  const value = (raw: string) => raw.trim().replace(/^["']|["']$/g, "").trim();
  const items = (raw: string) => raw.replace(/^\[|\]$/g, "").split(",").map(value).filter(Boolean);
  for (const line of lines.slice(1, end)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && list) {
      out[list].push(value(item[1]));
      continue;
    }
    const field = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    list = null;
    if (!field) continue;
    const [, key, rest] = field;
    const name = key.toLowerCase();
    if (name === "title" && rest.trim()) out.title = value(rest);
    else if (name === "tags" || name === "tag" || name === "aliases" || name === "alias") {
      const target = name.startsWith("tag") ? "tags" : "aliases";
      if (rest.trim()) out[target].push(...items(rest));
      else list = target;
    }
  }
  out.tags = out.tags.map((tag) => tag.replace(/^#/, ""));
  return out;
}

/** A line as its words: links as what they say, embeds and markup left out. */
export function plain(line: string): string {
  return line
    .replace(/!\[\[[^\]]*\]\]/g, "")                                    // an embed: the embedded file is read on its own
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")                                // an image
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")                       // [[note|what it says]]
    .replace(/\[\[([^\]]*)\]\]/g, (_, target: string) =>                 // [[folder/note#heading]]
      target.split("/").pop()!.replace(/[#^]+/g, " ").trim())
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")                             // [text](url)
    .replace(/\[\^[^\]]*\]/g, "")                                        // footnote marks
    .replace(/^\s{0,3}>\s*\[![\w-]+\][+-]?\s*/, "")                       // a callout's type
    .replace(/^\s{0,3}>\s?/, "")                                         // a quote
    .replace(/^\s{0,3}#{1,6}\s+/, "")                                    // a heading's marks
    .replace(/^(\s*[-*+]\s+)\[[ xX/-]\]\s+/, "$1")                       // a task's box
    .replace(/<[^>]+>/g, "")                                             // HTML
    .replace(/\*\*|__|~~|==|`/g, "")                                     // emphasis, highlights, code marks
    .replace(/\s+$/, "");
}

const HEADING = /^\s{0,3}#{1,6}\s+\S/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** The note's lines as words, each with its line in the file; headings marked. Comments (%% %%, <!-- -->) and
 * code fences' marks are left out; code itself is kept (it's searched too). */
export function lines(source: string): { text: string; line: number; heading: boolean }[] {
  const all = source.replace(/\r\n?/g, "\n").split("\n");
  const front = frontmatter(all).lines;
  const out: { text: string; line: number; heading: boolean }[] = [];
  let fenced = false, comment = false, html = false;
  for (let i = front; i < all.length; i++) {
    let line = all[i];
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (fenced) { out.push({ text: line.replace(/\s+$/, ""), line: i, heading: false }); continue; }
    // Comments that may span lines: what's outside them stays
    let kept = "";
    let rest = line;
    while (rest.length) {
      if (comment) {
        const end = rest.indexOf("%%");
        if (end < 0) { rest = ""; break; }
        comment = false; rest = rest.slice(end + 2);
      } else if (html) {
        const end = rest.indexOf("-->");
        if (end < 0) { rest = ""; break; }
        html = false; rest = rest.slice(end + 3);
      } else {
        const percent = rest.indexOf("%%"), angle = rest.indexOf("<!--");
        const first = [percent, angle].filter((p) => p >= 0).sort((a, b) => a - b)[0];
        if (first === undefined) { kept += rest; break; }
        kept += rest.slice(0, first);
        if (first === percent) { comment = true; rest = rest.slice(first + 2); }
        else { html = true; rest = rest.slice(first + 4); }
      }
    }
    line = kept;
    out.push({ text: plain(line), line: i, heading: HEADING.test(line) });
  }
  return out;
}

/** The note's passages: a heading starts a new one; a passage takes whole lines up to `size` characters, then the
 * next starts with the last lines that fit in `overlap` (a long line is cut as Dowse cuts text). */
export function passages(noteLines: { text: string; line: number; heading: boolean }[], size = PASSAGE,
                         overlap = OVERLAP): { text: string; first: number; last: number }[] {
  const out: { text: string; first: number; last: number }[] = [];
  let current: { text: string; line: number }[] = [];
  const length = (group: { text: string }[]) => group.reduce((sum, l) => sum + l.text.length + 1, 0);
  const close = (keep: boolean) => {
    const text = current.map((l) => l.text).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text) out.push({ text, first: current[0].line, last: current[current.length - 1].line });
    if (!keep) { current = []; return; }
    const tail: { text: string; line: number }[] = [];
    for (let i = current.length - 1; i >= 0 && length([...tail, current[i]]) <= overlap; i--) tail.unshift(current[i]);
    current = tail.length < current.length ? tail : [];
  };
  for (const line of noteLines) {
    if (line.heading && current.some((l) => l.text.trim())) close(false);
    if (line.text.length > size) {   // a line longer than a passage: cut it as Dowse cuts any text
      if (current.some((l) => l.text.trim())) close(false);
      for (const piece of chunks(line.text, size, overlap)) out.push({ text: piece, first: line.line, last: line.line });
      current = [];
      continue;
    }
    if (length(current) + line.text.length + 1 > size && current.some((l) => l.text.trim())) close(true);
    current.push({ text: line.text, line: line.line });
  }
  if (current.some((l) => l.text.trim())) close(false);
  return out;
}

/** A note, read: each passage with the note's title (its frontmatter's, its first heading's, or its name when that
 * says something). Tags and aliases are kept for keyword search. */
export function readNote(path: string, source: string): Reading {
  const all = source.replace(/\r\n?/g, "\n").split("\n");
  const front = frontmatter(all);
  const noteLines = lines(source);
  const firstHeading = noteLines.find((l) => l.heading && /^\s{0,3}#\s/.test(all[l.line]))?.text.trim();
  const title = titleOf(path, front.title ?? firstHeading ?? null);
  const found = passages(noteLines);
  const info: Record<string, unknown> = { passages: found.length, chars: source.length };
  if (title) info.title = title;
  if (front.tags.length) info.tags = front.tags;
  if (front.aliases.length) info.aliases = front.aliases;
  if (!found.length) return { pieces: [], info, note: "no text" };
  const pieces: Piece[] = found.map((p) => ({
    kind: "passage", body: p.text, loc: p.first, locEnd: p.last,
    text: hasWords(p.text) ? Prompts.document(p.text, title) : null,
  }));
  return { pieces, info };
}
