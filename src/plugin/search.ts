// Searching the vault: the searcher built from the vault's index (and rebuilt as reading adds to it, at most every
// few seconds, as Dowse does), the query asked of the model, and the answer. A search never waits for the model:
// while it's asleep or loading, words alone (and it's woken; the view searches again once it's ready).

import { forMeaning } from "../engine/search/dates.ts";
import { probes } from "../engine/search/probes.ts";
import { Searcher, strongCount, type Hit, type IndexFile, type IndexSegment, type SearchOptions } from "../engine/search/searcher.ts";
import { Prompts } from "../engine/reading/types.ts";
import { terms as termsOf } from "../engine/searchtext.ts";
import type { Store } from "../engine/store.ts";
import type { Model } from "../engine/model.ts";
import type { Shown } from "../ui/results.ts";

export const REFRESH_MS = 3000;   // between searchers built while the index keeps changing

export interface Answer {
  query: string;
  hits: Hit[];
  strong: number;
  terms: string[];
  meaning: boolean;   // the model took part (else words alone)
  ms: number;
}

/** A file's name entry: its name, its last three folders, and a note's tags and aliases. */
export function nameWords(path: string, info: Record<string, unknown>): string {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const labels = [...((info.tags as string[]) ?? []), ...((info.aliases as string[]) ?? [])];
  return [stem, ...parts.slice(-3), ...labels].join(" ").replace(/[_-]/g, " ");
}

export class VaultSearch {
  private store: Store;
  private model: { ready: () => Model | null; wake: () => void };
  private searcher: Searcher | null = null;
  private building: Promise<Searcher> | null = null;
  private stale = true;
  private builtAt = 0;
  private bank: Float32Array[] | null = null;
  private latest: Shown[] = [];   // the vault's files, most recently changed first (the wall's rack)

  constructor(store: Store, model: { ready: () => Model | null; wake: () => void }) {
    this.store = store;
    this.model = model;
  }

  /** The index changed: the next search (or the background) builds a fresh searcher. */
  changed(): void {
    this.stale = true;
  }

  private async build(): Promise<Searcher> {
    const rows = await this.store.files();
    const ids = new Map(rows.map((row, i) => [row.path, i + 1]));
    const files: IndexFile[] = rows.map((row, i) => ({ id: i + 1, path: row.path, kind: row.kind, mtime: row.mtime, info: row.info }));
    const segments: IndexSegment[] = files.map((file) => ({
      id: -file.id, file: file.id, kind: "name", modality: "none", loc: null, locEnd: null,
      name: nameWords(file.path, file.info), body: "", vector: null,
    }));
    const first = new Map<string, string>();
    for (const segment of await this.store.segments()) {
      const file = ids.get(segment.path);
      if (file === undefined) continue;
      if (!first.has(segment.path) && segment.body) first.set(segment.path, segment.body.slice(0, 220));
      segments.push({ id: segment.id!, file, kind: segment.kind, modality: segment.modality ?? (segment.vector ? "text" : "none"),
                      loc: segment.loc, locEnd: segment.locEnd, name: "", body: segment.body,
                      vector: segment.vector ? new Float16Array(segment.vector) : null });
    }
    this.builtAt = Date.now();
    this.latest = [...rows].sort((a, b) => b.mtime - a.mtime).map((row) => ({
      path: row.path, kind: row.kind, loc: null, locEnd: null, excerpt: first.get(row.path) ?? null, info: row.info,
    }));
    return new Searcher(files, segments, this.bank);
  }

  /** The searcher, rebuilt if the index changed and the last build is a few seconds old. */
  private async current(): Promise<Searcher> {
    const due = this.stale && (!this.searcher || Date.now() - this.builtAt >= REFRESH_MS);
    if (this.searcher && !due) return this.searcher;
    this.building ??= (async () => {
      this.stale = false;
      try {
        return (this.searcher = await this.build());
      } finally {
        this.building = null;
      }
    })();
    return this.building;
  }

  /** The probes' vectors, embedded once per vault with the model (then the searcher can tell hubs and plain
   * matches); a searcher built before they were is built again. */
  private async ensureProbes(model: Model): Promise<void> {
    if (this.bank) return;
    this.bank = await probes(this.store, (prompts) => model.texts(prompts));
    this.stale = true;
    this.builtAt = 0;
  }

  async search(query: string, options: SearchOptions = {}, useModel = true): Promise<Answer> {
    const started = performance.now();
    let vector: Float32Array | null = null;
    const model = this.model.ready();
    if (useModel && query.trim() && !model) this.model.wake();
    if (useModel && query.trim() && model) {
      try {
        await this.ensureProbes(model);
        [vector] = await model.texts([Prompts.query(forMeaning(query, options.now))]);
      } catch {
        vector = null;   // the model failed meanwhile: words alone
      }
    }
    const searcher = await this.current();
    const hits = searcher.search(query, vector, { prefixLast: true, limit: 60, ...options });
    return { query, hits, strong: strongCount(hits), terms: termsOf(forMeaning(query, options.now)),
             meaning: vector !== null, ms: performance.now() - started };
  }

  /** The vault's files, most recently changed first, at most `limit` (the wall's rack before a search). */
  async recent(limit = 160): Promise<Shown[]> {
    await this.current();
    return this.latest.slice(0, limit);
  }

  /** More like this: the files nearest to a file of the vault (its own vectors: the model isn't needed). */
  async similar(path: string, loc: number | null = null, options: SearchOptions = {}): Promise<Answer> {
    const started = performance.now();
    const searcher = await this.current();
    const example = searcher.vectorsOf(path, loc);
    const hits = example.length ? searcher.like(example, { limit: 30, exclude: new Set([path]), ...options }) : [];
    return { query: "", hits, strong: strongCount(hits), terms: [], meaning: true, ms: performance.now() - started };
  }
}
