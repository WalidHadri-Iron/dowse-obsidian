// Hybrid search: meaning (EmbeddingGemma 2's vectors) and words, ranked as Dowse ranks them (its `searcher`, measured
// on its evals: R@1 0.934 on its testbed), over a vault's index in memory.
//
// A file qualifies by standing out in meaning or by holding the query's words; its score is meaning z + a word bonus.
// Meaning is cosine similarity put on one scale for the query (every vector is scored anyway, so the distribution
// comes free; a small index measures each vector against the others, through Student's t). A file's best segment is
// read as the best of n draws (Šidák), half of each vector's similarity to everyday queries is taken off (hubs), the
// query's words must be found together (the rarest counting most), a date or a kind said plainly filters, and a hit
// counts as found only if the query describes it better than all but one everyday query does.
//
// Checked against Dowse on its testbed index (scripts/eval-search.ts, measurements/search.md, 2026-10-28): the same
// first result for 160 of 160 queries, the same top 10 for 160, R@1 0.934, MRR 0.961, 1 false alarm of 8 for both.

import { inflects, normalized, snippet, terms as termsOf, words as wordSpans } from "../searchtext.ts";
import { parse as parseDate, type Span } from "./dates.ts";
import { Keywords, pattern, token, type Pattern } from "./keywords.ts";
import { sidak, tAsZ } from "./stats.ts";

export const DIM = 768;
export const SMALL = 200;          // under this many vectors, the scale itself is uncertain (`apart`)
export const LIKE_VECTORS = 16;    // how many of an example's vectors search for what's like it

/** Kinds: a vault's (note, canvas…) and Dowse's own (doc, screenshot), so its index can be searched here too. */
export type Kind = string;
const DOC_KINDS = ["doc", "note", "canvas"];

const KIND_WORDS: Record<string, Kind[]> = {
  screenshot: ["screenshot"], screenshots: ["screenshot"], photo: ["image"], photos: ["image"], picture: ["image"],
  pictures: ["image"], image: ["image"], images: ["image"], pdf: ["pdf"], pdfs: ["pdf"], paper: ["pdf"],
  papers: ["pdf"], document: DOC_KINDS, documents: DOC_KINDS, note: DOC_KINDS, notes: DOC_KINDS, video: ["video"],
  videos: ["video"], clip: ["video"], movie: ["video"], audio: ["audio"], song: ["audio"], podcast: ["audio"],
  voice: ["audio"], recording: ["audio"],
};
// Kind words that say plainly what's wanted: these filter ("photos of snow" is only photos); the others only lean
const KIND_FILTERS: Record<string, Kind[]> = {
  screenshot: ["screenshot"], screenshots: ["screenshot"], photo: ["image"], photos: ["image"],
  picture: ["image", "screenshot"], pictures: ["image", "screenshot"], image: ["image", "screenshot"],
  images: ["image", "screenshot"], pdf: ["pdf"], pdfs: ["pdf"], video: ["video"], videos: ["video"], movie: ["video"],
  clip: ["video"], recording: ["audio"], recordings: ["audio"], podcast: ["audio"], audio: ["audio"],
};
const LEADING = new Set("a an the my our your some all any".split(" "));

export interface Ranking {
  zGate: number;          // how far a meaning match must stand out to count
  wordWeight: number;     // the word bonus at full strength
  sidak: boolean;         // best-of-n correction
  hub: number;            // how much of a vector's mean similarity to the probes is taken off
  rareWords: boolean;     // words found together, weighted by rarity
  filters: boolean;       // a date or a kind said plainly in the query filters
  spelling: boolean;      // a word found nowhere is tried as the names' nearest spelling
  clear: boolean;         // a hit counts as found only if it prefers this query to everyday ones
  outranked: number;      // how many everyday probes may describe a clear hit better than the query
  paraphrase: number;     // a probe this close to the query is the query in other words
}

export const RANKING: Ranking = { zGate: 2.0, wordWeight: 2.0, sidak: true, hub: 0.5, rareWords: true, filters: true,
  spelling: true, clear: true, outranked: 1, paraphrase: 0.85 };

export interface IndexFile { id: number; path: string; kind: Kind; mtime: number; info: Record<string, unknown> }

export interface IndexSegment {
  id: number;
  file: number;
  kind: string;                    // "name", "passage", "page", "chunk", "image"…
  modality: string;                // "text", "image", "audio", "none"
  loc: number | null;
  locEnd: number | null;
  name: string;                    // words matched as names (a file's name and folders, a note's tags)
  body: string;                    // words matched as content
  vector: ArrayLike<number> | null;
}

export interface Evidence { source: string; words: string[]; loc?: number | null; locEnd?: number | null }

export interface Hit {
  path: string;
  kind: Kind;
  score: number;
  z: number | null;
  cosine: number | null;
  keywordRank: number | null;
  segment: string;
  segmentId: number;
  loc: number | null;
  locEnd: number | null;
  excerpt: string | null;
  mtime: number;
  info: Record<string, unknown>;
  moments: [number, number | null][];
  clear: boolean;
  evidence: Evidence[];
}

export interface SearchOptions {
  kinds?: Kind[];
  limit?: number;
  exclude?: Set<string>;
  prefixLast?: boolean;
  zGate?: number;
  within?: string[];               // folders (vault paths)
  now?: number;
  inferDate?: boolean;
  inferKinds?: boolean;
  dateSpan?: Span | null;
  example?: Float32Array[];        // vectors standing for what's wanted (more like this)
}

/** Codes and IDs ("K7Q2LM", "TRX50") and long numbers mean nothing to an embedding but everything to keyword search:
 * such a query weighs words double and meaning half. */
export function isLookup(terms: string[]): boolean {
  return terms.length > 0 && terms.every((t) => /\d/.test(t) && (/\p{L}/u.test(t) || [...t].length >= 4));
}

export function kindHints(text: string): Set<Kind> {
  return new Set(normalized(text).toLowerCase().split(/\s+/).flatMap((w) => KIND_WORDS[w] ?? []));
}

/** The kinds a query asks for plainly: a kind word that leads it, follows what it's of, or says where. */
export function kindFilter(text: string): Set<Kind> {
  let words = normalized(text).toLowerCase().split(/\s+/).map((w) => w.replace(/^[.,;:!?'"]+|[.,;:!?'"]+$/g, ""));
  if (words.join(" ").includes("screen recording")) return new Set(["video"]);
  words = words.filter(Boolean);
  while (words.length && LEADING.has(words[0])) words = words.slice(1);
  const out = new Set<Kind>(words.length ? KIND_FILTERS[words[0]] ?? [] : []);
  if (words.length >= 2) for (const k of KIND_FILTERS[words[1]] ?? []) out.add(k);
  words.slice(1).forEach((word, i) => {
    const index = i + 1;
    const before = !LEADING.has(words[index - 1]) || index < 2 ? words[index - 1] : words[index - 2];
    if (KIND_FILTERS[word] && before === "in") for (const k of KIND_FILTERS[word]) out.add(k);
  });
  return out;
}

/** Edits from `a` to `b` (a letter added, dropped, changed, or two swapped), or `most` + 1 once over `most`. */
export function spellingDistance(a: string, b: string, most: number): number {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let before: number[] | null = null;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i, ...Array(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(row[j] + 1, current[j - 1] + 1, row[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], before[j - 2] + 1);
      }
    }
    if (Math.min(...current) > most) return most + 1;
    before = row;
    row = current;
  }
  return row[b.length];
}

function trigrams(word: string): Set<string> {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

const mean = (values: Float64Array) => values.reduce((a, b) => a + b, 0) / values.length;

/** Each vector's score minus its modality's average (text, image and audio vectors sit at different levels for the
 * same query), in standard deviations of all of them together; a small index measures each against the others. */
export function meaning(scores: Float64Array, modality: string[]): Float64Array<ArrayBufferLike> {
  if (!scores.length) return new Float64Array(0);
  const centered = Float64Array.from(scores);
  const overall = mean(centered);
  for (const value of new Set(modality)) {
    const rows = modality.flatMap((m, i) => (m === value ? [i] : []));
    const centre = rows.length >= 20 ? rows.reduce((a, i) => a + scores[i], 0) / rows.length : overall;
    for (const i of rows) centered[i] -= centre;
  }
  if (centered.length < SMALL) return apart(centered);
  const middle = mean(centered);
  const deviation = Math.max(Math.sqrt(centered.reduce((a, v) => a + (v - middle) ** 2, 0) / centered.length), 0.02);
  return centered.map((v) => (v - middle) / deviation);
}

/** How far each value stands from the others, on the scale of one draw from many (Dowse's `apart`). */
export function apart(values: Float64Array): Float64Array {
  const n = values.length;
  if (n < 3) return new Float64Array(n);
  const sum = values.reduce((a, b) => a + b, 0);
  const squares = values.reduce((a, b) => a + b * b, 0);
  return values.map((v) => {
    const others = (sum - v) / (n - 1);
    const spread = (squares - v * v - (n - 1) * others * others) / (n - 2);
    const deviation = Math.max(Math.sqrt(Math.max(spread, 0)), 0.02) * Math.sqrt(1 + 1 / (n - 1));
    return tAsZ((v - others) / deviation, n - 2);
  });
}

interface Words {
  rank: number;             // 1-based, by BM25
  segment: number;          // where the words are: the segment holding the most of them together
  coverage: number;
  specificity: number;
  patterns: Pattern[][];
}

function overlaps(a: [number, number | null], b: [number, number | null]): boolean {
  const aEnd = a[1] ?? a[0], bEnd = b[1] ?? b[0];
  return a[0] <= bEnd && b[0] <= aEnd && (a[1] !== null || b[1] !== null || a[0] === b[0]);
}

export function strongCount(hits: Hit[], ratio = 0.5): number {
  if (!hits.length || !hits[0].clear) return 0;
  if (hits[0].score <= 0) return hits.length;
  let count = 0;
  for (const hit of hits) {
    if (hit.score >= hits[0].score * ratio && hit.clear) count++;
    else break;
  }
  return count;
}

export class Searcher {
  readonly ranking: Ranking;
  private files = new Map<number, IndexFile>();
  private segments = new Map<number, IndexSegment>();
  private bySegmentFile = new Map<number, number[]>();   // file → its segments
  private matrix: Float32Array;
  private rowSegment: number[] = [];
  private rowFile: number[] = [];
  private rowModality: string[] = [];
  private rowHub: Float64Array;
  private fileVectors = new Map<number, number>();
  private keywords: Keywords;
  private segmentCount: number;
  private bank: Float32Array[] | null;
  private names: Map<string, Set<string>> | null = null;
  private scopes = new Map<string, Set<number>>();

  constructor(files: IndexFile[], segments: IndexSegment[], bank: Float32Array[] | null, ranking: Ranking = RANKING) {
    this.ranking = ranking;
    for (const file of files) this.files.set(file.id, file);
    const withVectors: IndexSegment[] = [];
    for (const segment of segments) {
      if (!this.files.has(segment.file)) continue;
      this.segments.set(segment.id, segment);
      let list = this.bySegmentFile.get(segment.file);
      if (!list) this.bySegmentFile.set(segment.file, (list = []));
      list.push(segment.id);
      if (segment.vector) withVectors.push(segment);
    }
    withVectors.sort((a, b) => a.id - b.id);
    this.matrix = new Float32Array(withVectors.length * DIM);
    withVectors.forEach((segment, row) => {
      for (let i = 0; i < DIM; i++) this.matrix[row * DIM + i] = segment.vector![i];
      this.rowSegment.push(segment.id);
      this.rowFile.push(segment.file);
      this.rowModality.push(segment.modality);
      this.fileVectors.set(segment.file, (this.fileVectors.get(segment.file) ?? 0) + 1);
    });
    this.segmentCount = this.segments.size;
    this.keywords = new Keywords([...this.segments.values()].filter((s) => s.name || s.body)
      .map((s) => ({ id: s.id, name: normalized(s.name), body: normalized(s.body) })));
    this.bank = bank && bank.length ? bank : null;
    this.rowHub = this.hubness();
  }

  get size(): number {
    return this.rowSegment.length;
  }

  private hubness(): Float64Array {
    if (!this.bank || !this.ranking.hub || !this.rowSegment.length) return new Float64Array(this.rowSegment.length);
    const centroid = new Float32Array(DIM);
    for (const probe of this.bank) for (let i = 0; i < DIM; i++) centroid[i] += probe[i] / this.bank.length;
    return Float64Array.from(this.scores(centroid));
  }

  scores(query: ArrayLike<number>): Float32Array {
    const rows = this.rowSegment.length;
    const out = new Float32Array(rows);
    for (let row = 0; row < rows; row++) {
      let dot = 0;
      const base = row * DIM;
      for (let i = 0; i < DIM; i++) dot += this.matrix[base + i] * query[i];
      out[row] = dot;
    }
    return out;
  }

  private under(folder: string): Set<number> {
    const key = folder.replace(/\/+$/, "").toLowerCase() + "/";
    let found = this.scopes.get(key);
    if (!found) {
      found = new Set([...this.files.values()].filter((f) => (f.path.toLowerCase() + "").startsWith(key) ||
                                                           f.path.toLowerCase() === key.slice(0, -1)).map((f) => f.id));
      this.scopes.set(key, found);
    }
    return found;
  }

  private time(file: IndexFile): number {
    const taken = file.info.taken;
    return typeof taken === "number" ? taken : file.mtime;
  }

  /** The vault searched: `vector` is the model's for the query's meaning (dates.forMeaning). */
  search(text: string, vector: ArrayLike<number> | null, options: SearchOptions = {}): Hit[] {
    const ranking = this.ranking;
    const zGate = options.zGate ?? ranking.zGate;
    const limit = options.limit ?? 20;
    const roots = options.within ?? [];
    const scope = roots.length ? new Set(roots.flatMap((root) => [...this.under(root)])) : null;
    if (scope && !scope.size) return [];
    const inferred = ranking.filters ? parseDate(text, options.now) : null;
    const span = options.dateSpan ?? ((options.inferDate ?? true) ? inferred : null);
    if (inferred) text = inferred.rest;
    let kinds = options.kinds?.length ? new Set(options.kinds) : null;
    if (!kinds && ranking.filters && (options.inferKinds ?? true)) {
      const found = kindFilter(text);
      kinds = found.size ? found : null;
    }
    const allowed = (id: number) => {
      const file = this.files.get(id);
      return Boolean(file) && (!kinds || kinds.has(file!.kind)) && (!scope || scope.has(id)) &&
        (!span || (span.start <= this.time(file!) && this.time(file!) < span.end));
    };

    // Meaning: every vector on this query's scale; each file keeps its best segment, corrected for how many
    // segments it had to choose from.
    const best = new Map<number, [number, number, number]>();   // file → [z, cosine, row]
    let rowZ: Float64Array<ArrayBufferLike> = new Float64Array(0);
    if ((vector || options.example) && this.rowSegment.length) {
      let cosine: Float32Array;
      if (options.example) {
        [cosine, rowZ] = this.likeScores(options.example);
      } else {
        cosine = this.scores(vector!);
        rowZ = meaning(Float64Array.from(cosine, (c, i) => c - ranking.hub * this.rowHub[i]), this.rowModality);
      }
      const order = [...rowZ.keys()].sort((a, b) => rowZ[b] - rowZ[a] || a - b);
      for (const row of order) {
        const file = this.rowFile[row];
        if (best.has(file) || !allowed(file)) continue;
        const z = ranking.sidak ? sidak(rowZ[row], this.fileVectors.get(file)!) : rowZ[row];
        best.set(file, [z, cosine[row], row]);
      }
    }

    const terms = termsOf(text);
    const words = this.words(terms, allowed, options.prefixLast ?? false, rowZ,
                             Boolean(kinds) || scope !== null || span !== null);

    // A file qualifies by standing out in meaning or holding half the query's words. Score: meaning z + a bonus
    // growing with how many of the words it holds together and how rare they are, + 1 for the kind asked for.
    const lookup = isLookup(terms);
    const [meaningWeight, wordsWeight] = lookup ? [0.5, ranking.wordWeight * 2] : [1.0, ranking.wordWeight];
    const hinted = kindHints(text);
    const candidates = new Set<number>();
    for (const [file, [z]] of best) if (z >= zGate) candidates.add(file);
    for (const [file, match] of words) if (match.coverage >= 0.5) candidates.add(file);
    if ((span || inferred || (!text.trim() && (kinds || scope))) && !terms.length) {
      for (const id of this.files.keys()) if (allowed(id)) candidates.add(id);
    }
    const scored = new Map<number, number>();
    for (const file of candidates) {
      const z = best.get(file)?.[0] ?? 0;
      const match = words.get(file);
      const bonus = match ? wordsWeight * match.coverage ** 1.5 * match.specificity : 0;
      let score = meaningWeight * (zGate >= 0 ? Math.max(z, 0) : z) + bonus;
      if (hinted.has(this.files.get(file)!.kind)) score += 1;
      if (span) score += this.time(this.files.get(file)!) / 1e15;   // between equals, the newest first
      scored.set(file, score);
    }

    const hits: Hit[] = [];
    for (const [file, score] of [...scored.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
      if (hits.length >= limit) break;
      const semantic = best.get(file), keyword = words.get(file);
      const useMeaning = semantic !== undefined && (semantic[0] >= zGate || keyword === undefined);
      const segmentId = useMeaning ? this.rowSegment[semantic![2]] : keyword ? keyword.segment
        : this.firstSegment(file);
      const segment = this.segments.get(segmentId);
      const info = this.files.get(file)!;
      if (!segment || options.exclude?.has(info.path)) continue;
      const hit: Hit = {
        path: info.path, kind: info.kind, score, z: semantic?.[0] ?? null, cosine: semantic?.[1] ?? null,
        keywordRank: keyword?.rank ?? null, segment: segment.kind, segmentId, loc: segment.loc, locEnd: segment.locEnd,
        excerpt: terms.length ? snippet(segment.body, terms) : null, mtime: info.mtime, info: info.info,
        moments: [], clear: true, evidence: [],
      };
      if (semantic && segment.loc !== null) {
        hit.moments = this.moments(file, rowZ, [segment.loc, segment.locEnd], options.example ? ranking.zGate : zGate);
      }
      if (options.example) hit.clear = semantic !== undefined && semantic[0] >= ranking.zGate;
      else if (ranking.clear && vector && zGate >= 0) {
        hit.clear = (keyword !== undefined && keyword.coverage >= 0.999) ||
          (semantic !== undefined && this.preferred(vector, semantic[2]));
      } else if (ranking.clear && !vector) hit.clear = keyword !== undefined && keyword.coverage >= 0.999;
      hit.evidence = this.evidence(file, hit, keyword, useMeaning);
      hits.push(hit);
    }
    return hits;
  }

  private firstSegment(file: number): number {
    const ids = [...(this.bySegmentFile.get(file) ?? [])].sort((a, b) => a - b);
    return ids.find((id) => this.segments.get(id)!.kind !== "name") ?? ids[0];
  }

  /** More like this: the files nearest to `example` (a file's vectors, a place in it), each at its place most like
   * it. Every file is a neighbour; the first stand out. */
  like(example: Float32Array[], options: SearchOptions = {}): Hit[] {
    return this.search("", null, { ...options, zGate: -Infinity, inferDate: false, inferKinds: false, example });
  }

  /** A file's vectors (`loc`: those at that place: a page, a passage), at most LIKE_VECTORS, evenly spread. */
  vectorsOf(path: string, loc: number | null = null): Float32Array[] {
    const file = [...this.files.values()].find((f) => f.path === path);
    if (!file) return [];
    let rows = this.rowFile.flatMap((f, row) => (f === file.id ? [row] : []));
    if (loc !== null) {
      const here = rows.filter((row) => {
        const segment = this.segments.get(this.rowSegment[row])!;
        return segment.loc !== null && (Math.round(segment.loc) === Math.round(loc) ||
          (segment.locEnd !== null && segment.loc <= loc && loc <= segment.locEnd));
      });
      if (here.length) rows = here;
    }
    if (rows.length > LIKE_VECTORS) {
      rows = Array.from({ length: LIKE_VECTORS }, (_, i) => rows[Math.round(i * (rows.length - 1) / (LIKE_VECTORS - 1))]);
    }
    return rows.map((row) => this.matrix.slice(row * DIM, (row + 1) * DIM));
  }

  private likeScores(example: Float32Array[]): [Float32Array, Float64Array<ArrayBufferLike>] {
    const rows = this.rowSegment.length;
    const cosine = new Float32Array(rows).fill(-Infinity);
    const z = new Float64Array(rows).fill(-Infinity);
    for (const vector of example) {
      const scores = this.scores(vector);
      const rowZ = meaning(Float64Array.from(scores, (c, i) => c - this.ranking.hub * this.rowHub[i]), this.rowModality);
      for (let row = 0; row < rows; row++) {
        if (scores[row] > cosine[row]) cosine[row] = scores[row];
        if (rowZ[row] > z[row]) z[row] = rowZ[row];
      }
    }
    return [cosine, z];
  }

  /** Whether this vector is described by the query at least as well as by all but `outranked` of the everyday
   * probes (leaving out those that are the query in other words). */
  private preferred(query: ArrayLike<number>, row: number): boolean {
    if (!this.bank) return true;
    const dot = (a: ArrayLike<number>, b: ArrayLike<number>, offset = 0) => {
      let s = 0;
      for (let i = 0; i < DIM; i++) s += a[i] * b[offset + i];
      return s;
    };
    const own = dot(query, this.matrix, row * DIM);
    let better = 0;
    for (const probe of this.bank) {
      if (dot(probe, query) >= this.ranking.paraphrase) continue;
      if (dot(probe, this.matrix, row * DIM) > own) better++;
    }
    return better <= this.ranking.outranked;
  }

  /** Other places in a long file that stand out for the query too, best first, none overlapping. */
  private moments(file: number, rowZ: Float64Array, shown: [number, number | null], zGate: number, most = 3):
      [number, number | null][] {
    const rows = this.rowFile.flatMap((f, row) => (f === file ? [row] : []));
    if (rows.length < 2) return [];
    const n = this.ranking.sidak ? rows.length : 1;
    const taken: [number, number | null][] = [shown];
    const out: [number, number | null][] = [];
    for (const row of rows.sort((a, b) => rowZ[b] - rowZ[a])) {
      if (out.length >= most || sidak(rowZ[row], n) < Math.max(zGate, 0)) break;
      const segment = this.segments.get(this.rowSegment[row])!;
      if (segment.loc === null) continue;
      const place: [number, number | null] = [segment.loc, segment.locEnd];
      if (taken.some((other) => overlaps(place, other))) continue;
      taken.push(place);
      out.push(place);
    }
    return out;
  }

  private groups(terms: string[], prefixLast: boolean): Pattern[][] {
    return terms.flatMap((term, index) => {
      const p = pattern(term, (prefixLast && index === terms.length - 1) || inflects(term));
      if (!p) return [];
      const group = [p];   // a word found nowhere: perhaps a name, misspelt
      if (this.ranking.spelling && [...term].length >= 4 && /^\p{L}+$/u.test(term) && !this.keywords.has(p)) {
        for (const spelled of this.spelled(term)) {
          const alternative = pattern(spelled, false);
          if (alternative) group.push(alternative);
        }
      }
      return [group];
    });
  }

  private matchesOf(group: Pattern[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const p of group) for (const [row, count] of this.keywords.matches(p)) out.set(row, (out.get(row) ?? 0) + count);
    return out;
  }

  /** Files holding the query's words: up to 100, ranked by BM25, with how well each holds them and where. */
  private words(terms: string[], allowed: (file: number) => boolean, prefixLast: boolean, rowZ: Float64Array,
                filtered: boolean): Map<number, Words> {
    const groups = this.groups(terms, prefixLast);
    const out = new Map<number, Words>();
    if (!groups.length) return out;
    let seen = 0;
    for (const row of this.keywords.ranked(groups.flat())) {
      if (out.size >= 100 || (!filtered && ++seen > 1000)) break;
      const file = this.segments.get(row)?.file;
      if (file !== undefined && !out.has(file) && allowed(file)) {
        out.set(file, { rank: out.size + 1, segment: row, coverage: 0, specificity: 1, patterns: groups });
      }
    }
    if (!out.size) return out;

    // Which words each segment of these files holds (a file's name counts as part of every one of its segments)
    const held = new Map<number, Map<number, Set<number>>>([...out.keys()].map((f) => [f, new Map()]));
    const names = new Map<number, Set<number>>([...out.keys()].map((f) => [f, new Set()]));
    const matched = groups.map((group) => this.matchesOf(group));
    matched.forEach((rows, index) => {
      for (const row of rows.keys()) {
        const segment = this.segments.get(row)!;
        if (!out.has(segment.file)) continue;
        if (segment.kind === "name") names.get(segment.file)!.add(index);
        else {
          const places = held.get(segment.file)!;
          if (!places.has(row)) places.set(row, new Set());
          places.get(row)!.add(index);
        }
      }
    });
    const rarity = this.ranking.rareWords ? matched.map((rows) => this.rarity(rows)) : groups.map(() => 1);
    const total = rarity.reduce((a, b) => a + b, 0);
    const segmentZ = new Map<number, number>();
    if (rowZ.length) this.rowSegment.forEach((segment, row) => { if (out.has(this.rowFile[row])) segmentZ.set(segment, rowZ[row]); });
    for (const [file, match] of out) {
      const places = held.get(file)!;
      if (places.size) {
        const weight = (indexes: Set<number>) => [...indexes].reduce((a, i) => a + rarity[i], 0);
        match.segment = [...places.keys()].reduce((a, b) => {
          const [wa, wb] = [weight(places.get(a)!), weight(places.get(b)!)];
          if (wa !== wb) return wa > wb ? a : b;
          const [za, zb] = [segmentZ.get(a) ?? -Infinity, segmentZ.get(b) ?? -Infinity];
          return zb > za ? b : a;
        });
      }
      const found = this.ranking.rareWords
        ? new Set([...(places.get(match.segment) ?? []), ...names.get(file)!])
        : new Set([...names.get(file)!, ...[...places.values()].flatMap((s) => [...s])]);
      const sum = [...found].reduce((a, i) => a + rarity[i], 0);
      match.coverage = total ? sum / total : 0;
      match.specificity = found.size && this.ranking.rareWords ? sum / found.size : 1;
    }
    return out;
  }

  /** How rare a word is in the index, from 1 (in one segment) to ~0 (in all of them). */
  private rarity(rows: Map<number, number>): number {
    const segments = Math.max(this.segmentCount, 2);
    const found = [...rows.keys()].filter((row) => this.segments.has(row)).length;
    return Math.min(Math.max(Math.log(segments / Math.max(found, 1)) / Math.log(segments), 0.05), 1);
  }

  /** Words of file and folder names a letter or two from `term`: the closest, three at most. */
  private spelled(term: string): string[] {
    if (!this.names) {
      this.names = new Map();
      for (const segment of this.segments.values()) {
        if (segment.kind !== "name") continue;
        const folded = normalized(segment.name).toLowerCase();
        for (const [start, end] of wordSpans(folded)) {
          const word = folded.slice(start, end);
          if ([...word].length >= 3 && /^\p{L}+$/u.test(word)) {
            for (const gram of trigrams(word)) {
              if (!this.names.has(gram)) this.names.set(gram, new Set());
              this.names.get(gram)!.add(word);
            }
          }
        }
      }
    }
    const most = [...term].length <= 6 ? 1 : 2;
    const nearby = new Set<string>();
    for (const gram of trigrams(term)) for (const word of this.names.get(gram) ?? []) nearby.add(word);
    const close = [...nearby].filter((w) => w !== term).map((w) => [spellingDistance(term, w, most), w] as const)
      .filter(([d]) => d <= most).sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
    return close.length ? close.filter(([d]) => d === close[0][0]).slice(0, 3).map(([, w]) => w) : [];
  }

  /** The words found, as written, and where (never generated reasons). */
  private evidence(file: number, hit: Hit, keyword: Words | undefined, semantic: boolean): Evidence[] {
    const out: Evidence[] = [];
    if (keyword) {
      const wanted = keyword.patterns.flat();
      const written = (text: string) => {
        const found: string[] = [];
        const normal = normalized(text);
        for (const [start, end] of wordSpans(normal)) {
          const word = normal.slice(start, end);
          const t = token(word);
          if (wanted.some((p) => (p.prefix ? t.startsWith(p.word) : t === p.word)) && !found.includes(word)) found.push(word);
        }
        return found;
      };
      for (const id of this.bySegmentFile.get(file) ?? []) {
        const segment = this.segments.get(id)!;
        if (segment.kind === "name") {
          const stem = normalized((hit.path.split("/").pop() ?? "").replace(/\.[^.]+$/, "").replace(/[_-]/g, " ")).toLowerCase();
          const stemWords = new Set(wordSpans(stem).map(([a, b]) => stem.slice(a, b)));
          const labels = new Set([...(hit.info.tags as string[] ?? []), ...(hit.info.aliases as string[] ?? [])]
            .flatMap((label) => { const l = normalized(label).toLowerCase(); return wordSpans(l).map(([x, y]) => l.slice(x, y)); }));
          const names = written(segment.name);
          const filename = names.filter((w) => stemWords.has(w.toLowerCase()));
          const tags = names.filter((w) => !stemWords.has(w.toLowerCase()) && labels.has(w.toLowerCase()));
          const folder = names.filter((w) => !stemWords.has(w.toLowerCase()) && !labels.has(w.toLowerCase()));
          if (filename.length) out.push({ source: "filename", words: filename, loc: null });
          if (tags.length) out.push({ source: "tag", words: tags, loc: null });
          if (folder.length) out.push({ source: "folder", words: folder, loc: null });
        } else if (id === hit.segmentId || id === keyword.segment && hit.segment === "image") {
          const words = written(segment.body);
          if (words.length) out.push({ source: segment.kind === "ocr" ? "ocr" : "text", words, loc: segment.loc, locEnd: segment.locEnd });
        }
      }
    }
    if (semantic) out.push({ source: "semantic", words: [], loc: hit.loc, locEnd: hit.locEnd });
    return out;
  }
}

