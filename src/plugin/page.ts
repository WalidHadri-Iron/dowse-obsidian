// A document's face on the wall and the floor: the page itself, small, in the theme's colours. A note is drawn as it
// reads: its title, then its headings, paragraphs, lists, tasks, quotes, code, tables and its first embedded picture;
// a search's hit opens the page at the passage that matched (the section it's in above it, the query's words marked).
// A canvas is drawn as a map of itself: its cards and arrows on a dotted ground, as Obsidian shows it. Small, a page
// is a recognisable shape (a title, a picture, a list); close, it reads.

import type { App, TFile } from "obsidian";
import { cssColor } from "../ui/wall/css-color.ts";

export const PAGE = { width: 680, height: 500 };   // a case's shape (ui/wall/glass.ts), in the drawing's own units
const PAD = 34;

interface Palette { paper: string; ink: string; muted: string; faint: string; accent: string; border: string; code: string;
                    mark: string; text: string; mono: string }

/** The theme's colours and fonts, as the page uses them. */
function palette(): Palette {
  const host = document.body;
  const paper = cssColor(host, "--background-primary");
  const css = getComputedStyle(host);
  // The first of `names` the theme defines (a variable it lacks would resolve to the inherited text colour)
  const color = (...names: string[]) => cssColor(host, names.find((n) => css.getPropertyValue(n).trim()) ?? names[0], paper);
  const font = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    paper, ink: color("--text-normal"), muted: color("--text-muted"), faint: color("--text-faint"),
    accent: color("--text-accent"), border: color("--background-modifier-border"), code: color("--background-secondary"),
    mark: color("--highlight-background", "--text-highlight-bg"),   // (Obsidian 1.14's name; before, the second)
    text: font("--font-text", "'Segoe UI', system-ui, sans-serif"), mono: font("--font-monospace", "Consolas, monospace"),
  };
}

// ---------------------------------------------------------------- notes

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "item"; text: string; depth: number; mark: string; done?: boolean }
  | { kind: "quote"; text: string }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "picture"; link: string }
  | { kind: "rule" };

/** The note's blocks from line `from` on (its frontmatter left out), enough to fill a page. */
export function blocks(markdown: string, from = 0): Block[] {
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {   // frontmatter
    const end = lines.findIndex((line, n) => n > 0 && line.trim() === "---");
    if (end > 0) i = end + 1;
  }
  i = Math.max(i, from);
  const out: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => { if (paragraph.length) out.push({ kind: "paragraph", text: paragraph.join(" ") }); paragraph = []; };
  for (; i < lines.length && out.length < 40; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(trimmed.slice(0, 3)); i++) code.push(lines[i]);
      out.push({ kind: "code", lines: code.slice(0, 12) });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push({ kind: "heading", level: m[1].length, text: m[2] }); continue; }
    if (/^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(trimmed)) { flush(); out.push({ kind: "rule" }); continue; }
    if ((m = trimmed.match(/^!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/)) || (m = trimmed.match(/^!\[[^\]]*\]\(([^)\s]+)[^)]*\)$/))) {
      flush();
      if (/\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(m[1])) out.push({ kind: "picture", link: decodeURI(m[1]) });
      continue;
    }
    if (trimmed.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      i--;
      out.push({ kind: "table", rows: rows.slice(0, 8) });
      continue;
    }
    if ((m = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/))) {
      flush();
      out.push({ kind: "item", text: m[3], depth: Math.floor(m[1].replace(/\t/g, "    ").length / 2), mark: "task", done: m[2] !== " " });
      continue;
    }
    if ((m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/))) {
      flush();
      const mark = /\d/.test(m[2]) ? m[2] : "•";
      out.push({ kind: "item", text: m[3], depth: Math.floor(m[1].replace(/\t/g, "    ").length / 2), mark });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const text = trimmed.replace(/^>\s?/, "").replace(/^\[!(\w+)\][+-]?\s*/, (_, kind: string) => `${kind[0].toUpperCase()}${kind.slice(1)}: `);
      const last = out[out.length - 1];
      if (last?.kind === "quote") last.text += ` ${text}`; else out.push({ kind: "quote", text });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return out;
}

interface Run { text: string; accent?: boolean; bold?: boolean; code?: boolean; mark?: boolean }

/** A line's words as they read: Markdown's marks taken out, links and tags in the accent, the query's words marked. */
export function inline(text: string, terms: readonly string[]): Run[] {
  const runs: Run[] = [];
  const pattern = /(!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\])|(\[([^\]]*)\]\([^)]*\))|(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|((?:^|(?<=\s))#[\p{L}\p{N}_/-]+)/gu;
  let at = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > at) runs.push({ text: text.slice(at, m.index) });
    if (m[1]) runs.push({ text: (m[3] ?? m[2]).split("#")[0].split("/").pop() ?? "", accent: true });
    else if (m[4]) runs.push({ text: m[5], accent: true });
    else if (m[6]) runs.push({ text: m[6].slice(1, -1), code: true });
    else if (m[7]) runs.push({ text: m[7].slice(2, -2), bold: true });
    else if (m[8]) runs.push({ text: m[8], accent: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at) });
  const marked = terms.filter((t) => t.length >= 2).map((t) => t.toLowerCase());
  return runs.flatMap((run) => run.code ? [{ ...run }] : run.text.replace(/(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)|~~|==/g, "")
    .split(/(\s+)/).filter(Boolean).map((word) => {
      const bare = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
      return { ...run, text: word, mark: bare.length > 1 && marked.some((t) => bare.startsWith(t) || t.startsWith(bare) && bare.length >= 4) };
    }));
}

type Ctx = OffscreenCanvasRenderingContext2D;

/** Words laid out from (x, y) within `width`; answers the y after them, or stops at `bottom`. */
function flow(g: Ctx, runs: Run[], x: number, y: number, width: number, size: number, lead: number, p: Palette,
              bottom: number, base: { bold?: boolean; color?: string } = {}): number {
  let cx = x;
  const font = (run: Run) => `${run.bold || base.bold ? 600 : 400} ${run.code ? size * 0.9 : size}px ${run.code ? p.mono : p.text}`;
  for (const run of runs) {
    g.font = font(run);
    const w = g.measureText(run.text).width;
    if (cx + w > x + width && cx > x) {
      if (!run.text.trim()) continue;
      cx = x; y += lead;
      if (y > bottom) return y;
    }
    if (!run.text.trim()) { cx += w; continue; }
    if (run.mark) { g.fillStyle = p.mark; g.fillRect(cx - 2, y - size * 0.95, w + 4, size * 1.3); }
    if (run.code) { g.fillStyle = p.code; g.fillRect(cx - 3, y - size * 0.9, w + 6, size * 1.2); }
    g.fillStyle = run.accent ? p.accent : base.color ?? p.ink;
    g.fillText(run.text, cx, y);
    cx += w;
  }
  return y + lead;
}

async function image(app: App, link: string, from: string): Promise<HTMLImageElement | null> {
  const file = app.metadataCache.getFirstLinkpathDest(link, from);
  if (!file) return null;
  const img = new Image();
  img.src = app.vault.getResourcePath(file);
  try { await img.decode(); return img; } catch { return null; }
}

/** A note's page, at line `from` (0: from its top, with its title). */
async function drawNote(app: App, file: TFile, g: Ctx, p: Palette, from: number, terms: readonly string[]): Promise<void> {
  const markdown = await app.vault.cachedRead(file);
  const cache = app.metadataCache.getFileCache(file);
  const front: unknown = cache?.frontmatter?.title;
  const title = typeof front === "string" && front.trim() ? front : cache?.headings?.[0]?.level === 1 ? cache.headings[0].heading : file.basename;
  const W = PAGE.width - PAD * 2, bottom = PAGE.height - 18;
  let y = PAD + 4;
  let start = 0;
  if (from > 0) {   // a hit: the section it's in, from its heading (or the matched line, with what's above said)
    const heading = [...(cache?.headings ?? [])].reverse().find((h) => h.position.start.line <= from);
    start = heading && from - heading.position.start.line <= 12 ? heading.position.start.line : from;
    g.font = `500 19px ${p.text}`;
    g.fillStyle = p.muted;
    const path = [title, ...(heading && heading.heading !== title ? [heading.heading] : [])].join("  ›  ");
    g.fillText(fit(g, path, W), PAD, y + 12);
    y += 40;
  } else {
    g.font = `650 34px ${p.text}`;
    g.fillStyle = p.ink;
    for (const line of wrap(g, title, W).slice(0, 2)) { g.fillText(line, PAD, y + 26); y += 40; }
    y += 10;
  }
  const all = blocks(markdown, start);
  if (from === 0 && all[0]?.kind === "heading" && all[0].text.trim() === title.trim()) all.shift();   // (the title's own)
  for (const block of all) {
    if (y > bottom) break;
    switch (block.kind) {
      case "heading": {
        const size = block.level <= 1 ? 30 : block.level === 2 ? 27 : 24;
        y += 6;
        y = flow(g, inline(block.text, terms), PAD, y + size, W, size, size * 1.25, p, bottom, { bold: true }) - size + 8;
        break;
      }
      case "paragraph":
        y = flow(g, inline(block.text, terms), PAD, y + 22, W, 22, 31, p, bottom) - 22 + 10;
        break;
      case "item": {
        const indent = PAD + 26 + block.depth * 26;
        if (block.mark === "task") {
          g.strokeStyle = block.done ? p.accent : p.faint; g.lineWidth = 2;
          g.strokeRect(indent - 26, y + 6, 17, 17);
          if (block.done) { g.fillStyle = p.accent; g.fillRect(indent - 22, y + 10, 9, 9); }
        } else {
          g.fillStyle = p.muted;
          g.font = `400 22px ${p.text}`;
          if (block.mark === "•") { g.beginPath(); g.arc(indent - 16, y + 15, 4, 0, Math.PI * 2); g.fill(); }
          else g.fillText(block.mark, indent - 28, y + 22);
        }
        y = flow(g, inline(block.text, terms), indent, y + 22, W - (indent - PAD), 22, 31, p, bottom,
                 block.done ? { color: p.muted } : {}) - 22 + 4;
        break;
      }
      case "quote": {
        const top = y;
        y = flow(g, inline(block.text, terms), PAD + 22, y + 22, W - 22, 22, 31, p, bottom, { color: p.muted }) - 22 + 6;
        g.fillStyle = p.accent;
        g.fillRect(PAD, top, 4, y - top - 6);
        y += 6;
        break;
      }
      case "code": {
        const height = Math.min(block.lines.length, 8) * 26 + 20;
        g.fillStyle = p.code;
        roundRect(g, PAD, y, W, height, 8); g.fill();
        g.font = `400 19px ${p.mono}`;
        g.fillStyle = p.ink;
        block.lines.slice(0, 8).forEach((line, n) => g.fillText(fit(g, line.replace(/\t/g, "  "), W - 28), PAD + 14, y + 30 + n * 26));
        y += height + 12;
        break;
      }
      case "table": {
        const columns = Math.max(...block.rows.map((r) => r.length));
        const cw = W / Math.max(columns, 1);
        g.strokeStyle = p.border; g.lineWidth = 1.5;
        block.rows.slice(0, 6).forEach((row, r) => {
          if (y + 30 > bottom) return;
          g.font = `${r === 0 ? 600 : 400} 19px ${p.text}`;
          g.fillStyle = r === 0 ? p.ink : p.muted;
          row.forEach((cell, c) => g.fillText(fit(g, cell.replace(/\*\*|__|`/g, ""), cw - 14), PAD + c * cw + 6, y + 23));
          y += 32;
          g.beginPath(); g.moveTo(PAD, y - 2); g.lineTo(PAD + W, y - 2); g.stroke();
        });
        y += 10;
        break;
      }
      case "picture": {
        const img = await image(app, block.link, file.path);
        if (!img) break;
        const height = Math.min(190, bottom - y);
        if (height < 60) break;
        cover(g, img, PAD, y, W, height);
        y += height + 14;
        break;
      }
      case "rule":
        g.fillStyle = p.border; g.fillRect(PAD, y + 8, W, 2); y += 22;
        break;
    }
  }
}

// ---------------------------------------------------------------- canvases

interface CanvasNode { id: string; x: number; y: number; width: number; height: number; type: string; text?: string;
                       file?: string; url?: string; label?: string; color?: string }

const CANVAS_COLORS: Record<string, string> = { 1: "--color-red", 2: "--color-orange", 3: "--color-yellow",
                                                4: "--color-green", 5: "--color-cyan", 6: "--color-purple" };

/** A canvas as a map of itself: its cards where they stand, its arrows, on Obsidian's dotted ground. */
async function drawCanvas(app: App, file: TFile, g: Ctx, p: Palette): Promise<void> {
  let data: { nodes?: CanvasNode[]; edges?: { fromNode: string; toNode: string }[] } = {};
  try { data = JSON.parse(await app.vault.cachedRead(file)) as typeof data; } catch { /* an empty one */ }
  g.fillStyle = p.faint;
  for (let x = 12; x < PAGE.width; x += 24) for (let y = 12; y < PAGE.height; y += 24) g.fillRect(x, y, 2, 2);
  const nodes = (data.nodes ?? []).filter((n) => Number.isFinite(n.x) && Number.isFinite(n.width));
  if (!nodes.length) return;
  const left = Math.min(...nodes.map((n) => n.x)), top = Math.min(...nodes.map((n) => n.y));
  const right = Math.max(...nodes.map((n) => n.x + n.width)), lower = Math.max(...nodes.map((n) => n.y + n.height));
  const scale = Math.min((PAGE.width - 60) / (right - left || 1), (PAGE.height - 60) / (lower - top || 1), 1.2);
  const ox = (PAGE.width - (right - left) * scale) / 2, oy = (PAGE.height - (lower - top) * scale) / 2;
  const box = (n: CanvasNode) => ({ x: ox + (n.x - left) * scale, y: oy + (n.y - top) * scale, w: n.width * scale, h: n.height * scale });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const tint = (n: CanvasNode) => !n.color ? p.border : n.color.startsWith("#") ? n.color
    : cssColor(document.body, CANVAS_COLORS[n.color] ?? "--background-modifier-border", p.paper);
  g.strokeStyle = p.muted; g.lineWidth = 2;
  for (const edge of data.edges ?? []) {
    const a = byId.get(edge.fromNode), b = byId.get(edge.toNode);
    if (!a || !b) continue;
    const [ba, bb] = [box(a), box(b)];
    g.beginPath(); g.moveTo(ba.x + ba.w / 2, ba.y + ba.h / 2); g.lineTo(bb.x + bb.w / 2, bb.y + bb.h / 2); g.stroke();
  }
  for (const n of [...nodes].sort((a, b) => Number(b.type === "group") - Number(a.type === "group"))) {
    const b = box(n);
    const color = tint(n);
    if (n.type === "group") {
      g.setLineDash([8, 6]); g.strokeStyle = color; g.lineWidth = 2;
      roundRect(g, b.x, b.y, b.w, b.h, 10); g.stroke(); g.setLineDash([]);
      if (n.label) { g.font = `600 18px ${p.text}`; g.fillStyle = p.muted; g.fillText(fit(g, n.label, b.w), b.x + 4, b.y - 6); }
      continue;
    }
    g.fillStyle = p.paper; roundRect(g, b.x, b.y, b.w, b.h, 8); g.fill();
    if (n.color) { g.globalAlpha = 0.14; g.fillStyle = color; roundRect(g, b.x, b.y, b.w, b.h, 8); g.fill(); g.globalAlpha = 1; }
    g.strokeStyle = color; g.lineWidth = 2; roundRect(g, b.x, b.y, b.w, b.h, 8); g.stroke();
    const label = n.type === "text" ? (n.text ?? "").split("\n").find((l) => l.trim()) ?? ""
      : n.type === "file" ? (n.file ?? "").split("/").pop()!.replace(/\.md$/, "") : n.url ?? n.label ?? "";
    const size = Math.max(14, Math.min(22, b.h * 0.3));
    if (b.w < 30 || b.h < size + 6) continue;
    g.font = `${n.type === "file" ? 500 : 400} ${size}px ${p.text}`;
    g.fillStyle = n.type === "file" ? p.accent : p.ink;
    const lines = wrap(g, label.replace(/^#+\s*/, "").replace(/\*\*|__|`|\[\[|\]\]/g, ""), b.w - 16);
    lines.slice(0, Math.max(1, Math.floor((b.h - 10) / (size * 1.25)))).forEach((line, k) =>
      g.fillText(line, b.x + 8, b.y + 6 + size + k * size * 1.25));
  }
}

// ---------------------------------------------------------------- drawing helpers

function wrap(g: Ctx, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines.map((l) => fit(g, l, width));
}

function fit(g: Ctx, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let cut = text;
  while (cut && g.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath(); g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function cover(g: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const ratio = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / ratio, sh = h / ratio;
  g.save(); roundRect(g, x, y, w, h, 8); g.clip();
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
  g.restore();
}

/** A note's or a canvas's page, `pixels` wide, as an image's URL (the caller revokes it). `from`: a note's matched
 * line (0: its top). */
export async function drawPage(app: App, file: TFile, kind: "note" | "canvas", pixels: number, from: number,
                               terms: readonly string[]): Promise<string> {
  const scale = pixels / PAGE.width;
  const canvas = new OffscreenCanvas(Math.round(PAGE.width * scale), Math.round(PAGE.height * scale));
  const g = canvas.getContext("2d")!;
  g.scale(scale, scale);
  const p = palette();
  g.fillStyle = p.paper;
  g.fillRect(0, 0, PAGE.width, PAGE.height);
  g.textBaseline = "alphabetic";
  if (kind === "canvas") await drawCanvas(app, file, g, p);
  else await drawNote(app, file, g, p, from, terms);
  // The page goes on below: it fades into the paper rather than stopping at a cut line
  const fade = g.createLinearGradient(0, PAGE.height - 70, 0, PAGE.height);
  fade.addColorStop(0, p.paper.replace("rgb(", "rgba(").replace(")", ", 0)"));
  fade.addColorStop(1, p.paper);
  g.fillStyle = fade;
  g.fillRect(0, PAGE.height - 70, PAGE.width, 70);
  // Its edge: a page on a floor of the same colour still shows where it ends
  g.strokeStyle = p.border; g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, PAGE.width - 3, PAGE.height - 3);
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
}
