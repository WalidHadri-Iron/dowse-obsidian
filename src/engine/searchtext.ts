// Text the way keyword search keeps and matches it, and the way documents are cut into passages. Dowse's
// `searchtext` (the same rules, so search behaves the same).

const DROP = new Set([0x00ad, 0x061c, 0xfeff, 0x0640, 0x0670, ...range(0x200c, 0x2010), ...range(0x202a, 0x202f),
  ...range(0x2060, 0x2065), ...range(0x2066, 0x206a), ...range(0x064b, 0x0660)]);
const ALEF = new Set([0x0622, 0x0623, 0x0625, 0x0671]);

function range(low: number, high: number): number[] {
  return Array.from({ length: high - low }, (_, i) => low + i);
}

/** NFKC (ligatures and full-width forms become plain letters), invisible formatting characters dropped (joiners,
 * direction marks, soft hyphens), and Arabic as people type it: no tatweel, no short-vowel marks, one alef. */
export function normalized(text: string): string {
  let out = "";
  for (const char of text.normalize("NFKC")) {
    const code = char.codePointAt(0)!;
    if (code === 0x200b) out += " ";
    else if (ALEF.has(code)) out += "ا";
    else if (!DROP.has(code)) out += char;
  }
  return out;
}

const INFLECTING = /[ऀ-෿؀-ۿ]/u;

/** Words of scripts that attach endings (Bengali, Hindi, Arabic) are matched as prefixes. */
export function inflects(word: string): boolean {
  return INFLECTING.test(word);
}

const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const SPACE = /\s/u;

/** At least a fifth of what isn't space is letters (marks count). A table of numbers gets keyword search only: a
 * meaning vector of digits matches nothing anyone would describe. */
export function hasWords(text: string): boolean {
  let letters = 0, others = 0;
  for (const char of text) {
    if (SPACE.test(char)) continue;
    if (LETTER_OR_MARK.test(char)) letters++;
    else others++;
  }
  return letters > 0 && letters * 4 >= others;
}

export const STOPWORDS = new Set(`
a an the of in on at to for with and or my me that this these those from about where what which who when is was are
were be been being it its some any find show file files photo photos picture pictures image images screenshot
screenshots video videos pdf pdfs document documents recording he she him her his hers they them their we us our you
your i not no but as by if so than then there has have had do does did can will would should could may might must
into out up down over under very just also how why all each both more most other such only own same too
`.split(/\s+/).filter(Boolean));

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** The [start, end) of each word in `text`: letters, numbers and marks, so a Bengali vowel sign or an Arabic haraka
 * stays inside its word. (Indices are the string's own, UTF-16.) */
export function words(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = -1;
  let index = 0;
  for (const char of text) {
    if (WORD_CHAR.test(char)) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      spans.push([start, index]);
      start = -1;
    }
    index += char.length;
  }
  if (start >= 0) spans.push([start, text.length]);
  return spans;
}

/** A query's content words, normalized as keyword search keeps its text: kind words ("screenshot") and stopwords
 * dropped, words of two letters or more, each once. */
export function terms(text: string): string[] {
  const folded = normalized(text).toLowerCase();
  const seen = new Set<string>();
  for (const [start, end] of words(folded)) {
    const word = folded.slice(start, end);
    if ([...word].length >= 2 && !STOPWORDS.has(word)) seen.add(word);
  }
  return [...seen];
}

/** ~`size`-character passages (~450 tokens) overlapping a little, cut at whitespace. */
export function chunks(text: string, size = 1800, overlap = 200, limit = 5000): string[] {
  return chunkSpans(text, size, overlap, limit).map(([piece]) => piece);
}

export function clean(text: string): string {
  return text.replace(/[ \t\u00a0]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

/** The same passages, each with where it starts in `clean(text)` (so a reader can tell the line it's on). */
export function chunkSpans(text: string, size = 1800, overlap = 200, limit = 5000): [string, number][] {
  const cleaned = clean(text);
  const out: [string, number][] = [];
  let start = 0;
  while (start < cleaned.length && out.length < limit) {
    let end = Math.min(start + size, cleaned.length);
    if (end < cleaned.length) {
      const space = Math.max(cleaned.lastIndexOf(" ", end - 1), cleaned.lastIndexOf("\n", end - 1));
      if (space >= start && space - start > Math.floor(size / 2)) end = space;
    }
    const raw = cleaned.slice(start, end);
    const piece = raw.trim();
    if (piece) out.push([piece, start + (raw.length - raw.trimStart().length)]);
    if (end >= cleaned.length) break;
    let following = Math.max(end - overlap, start);
    if (following <= start) following = end;
    while (following < end && !SPACE.test(cleaned[following])) following++;
    start = following < end ? following : end;
  }
  return out;
}

function matches(word: string, termList: string[]): boolean {
  const lower = word.toLowerCase();
  return termList.some((term) => lower === term || (inflects(term) && lower.startsWith(term)));
}

/** `text` with every word of `terms` marked « », as written. */
export function mark(text: string, termList: string[]): string {
  const normal = normalized(text);
  let out = "", cursor = 0;
  for (const [start, end] of words(normal)) {
    if (matches(normal.slice(start, end), termList)) {
      out += normal.slice(cursor, start) + "«" + normal.slice(start, end) + "»";
      cursor = end;
    }
  }
  return out + normal.slice(cursor);
}

/** A line of `text` around the first of `terms` it holds, those words marked « » as written, or null. */
export function snippet(text: string, termList: string[], width = 12): string | null {
  if (!termList.length) return null;
  const normal = normalized(text);
  const spans = words(normal);
  const marked = spans.flatMap(([start, end], index) => (matches(normal.slice(start, end), termList) ? [index] : []));
  if (!marked.length) return null;
  const first = marked[0];
  const begin = Math.max(first - Math.floor(width / 3), 0);
  const end = Math.min(first + width - Math.floor(width / 3), spans.length);
  let out = "", cursor = spans[begin][0];
  for (const index of marked) {
    if (index >= begin && index < end) {
      const [start, stop] = spans[index];
      out += normal.slice(cursor, start) + "«" + normal.slice(start, stop) + "»";
      cursor = stop;
    }
  }
  out += end === spans.length ? normal.slice(cursor) : normal.slice(cursor, spans[end - 1][1]);
  const piece = out.replace(/\s+/g, " ").trim();
  return (begin > 0 ? "…" : "") + piece + (end < spans.length ? "…" : "");
}
