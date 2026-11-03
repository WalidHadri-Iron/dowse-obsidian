// Keyword search over the vault's index, in memory: what Dowse asks of SQLite's full-text search (FTS5), done the same
// way. Each row is a segment's words in two columns, `name` (a file's name and folders, a note's tags and aliases)
// and `body` (a passage, a page); tokens as FTS5's "porter unicode61 remove_diacritics 2" makes them (letters, numbers
// and marks; lower case; Latin accents dropped; English words stemmed), rows ranked by FTS5's BM25 (name 3, body 1).

import { stemmer } from "stemmer";
import { normalized } from "../searchtext.ts";

const TOKEN = /[\p{L}\p{N}\p{Co}\p{M}]+/gu;
const LATIN = /^[\p{Script=Latin}\p{M}\p{N}]+$/u;
const K1 = 1.2, B = 0.75;
const WEIGHTS = { name: 3, body: 1 };

/** A word as the index keeps it. */
export function token(raw: string): string {
  let word = raw.toLowerCase();
  if (LATIN.test(word)) word = word.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");   // remove_diacritics
  return /^[a-z]{3,64}$/.test(word) ? stemmer(word) : word;   // porter: ASCII words of 3+ letters
}

export function tokens(text: string): string[] {
  return (normalized(text).match(TOKEN) ?? []).map(token);
}

/** A query word as FTS5 matches it: the word itself, or (`prefix`) any word it starts. */
export interface Pattern { word: string; prefix: boolean }

export function pattern(term: string, prefix: boolean): Pattern | null {
  const found = tokens(term);
  return found.length ? { word: found.join(" "), prefix } : null;
}

export interface Row { id: number; name: string; body: string }

export class Keywords {
  private postings = new Map<string, Map<number, [number, number]>>();   // token → row → [in name, in body]
  private lengths = new Map<number, number>();                           // row → its tokens, both columns
  private sorted: string[] = [];
  private total = 0;

  constructor(rows: Row[]) {
    for (const row of rows) this.add(row);
    this.sorted = [...this.postings.keys()].sort();
  }

  private add(row: Row): void {
    let length = 0;
    for (const [column, text] of [[0, row.name], [1, row.body]] as const) {
      for (const word of tokens(text)) {
        let rows = this.postings.get(word);
        if (!rows) this.postings.set(word, (rows = new Map<number, [number, number]>()));
        const counts = rows.get(row.id) ?? [0, 0];
        counts[column]++;
        rows.set(row.id, counts);
        length++;
      }
    }
    this.lengths.set(row.id, length);
    this.total += length;
  }

  get rows(): number {
    return this.lengths.size;
  }

  /** The words a pattern matches: the word, or every word it starts. */
  private words(p: Pattern): string[] {
    if (!p.prefix) return this.postings.has(p.word) ? [p.word] : [];
    let low = 0, high = this.sorted.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.sorted[mid] < p.word) low = mid + 1; else high = mid;
    }
    const out: string[] = [];
    for (let i = low; i < this.sorted.length && this.sorted[i].startsWith(p.word); i++) out.push(this.sorted[i]);
    return out;
  }

  /** Each row a pattern matches, with its weighted count (name × 3 + body). */
  matches(p: Pattern): Map<number, number> {
    const out = new Map<number, number>();
    for (const word of this.words(p)) {
      for (const [row, [name, body]] of this.postings.get(word)!) {
        out.set(row, (out.get(row) ?? 0) + name * WEIGHTS.name + body * WEIGHTS.body);
      }
    }
    return out;
  }

  /** Whether any row holds a pattern's word. */
  has(p: Pattern): boolean {
    return this.words(p).length > 0;
  }

  /** The rows holding any of the patterns, best first by BM25, as FTS5's bm25(fts, 3.0, 1.0) orders them. */
  ranked(patterns: Pattern[], keep: (row: number) => boolean = () => true): number[] {
    const rows = this.rows;
    const average = rows ? this.total / rows : 1;
    const scores = new Map<number, number>();
    for (const p of patterns) {
      const hits = this.matches(p);
      let idf = Math.log((rows - hits.size + 0.5) / (hits.size + 0.5));
      if (idf <= 0) idf = 1e-6;
      for (const [row, frequency] of hits) {
        if (!keep(row)) continue;
        const length = this.lengths.get(row) ?? 0;
        const part = idf * (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * length / average));
        scores.set(row, (scores.get(row) ?? 0) + part);
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([row]) => row);
  }
}
