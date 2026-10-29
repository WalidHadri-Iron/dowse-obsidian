// Searching the vault: the searcher built from the vault's index (and rebuilt as reading adds to it, at most every
// few seconds, as Dowse does), the query asked of the model, and the answer. A search never waits for the model:
// while it's asleep or loading, words alone (and it's woken; the view searches again once it's ready).

import { forMeaning } from "../engine/search/dates.ts";
import { buildMap, wordVectors, type ExploreMap, type MapFile } from "../engine/search/explore.ts";
import { probes } from "../engine/search/probes.ts";
import { Searcher, strongCount, type Hit, type IndexFile, type IndexSegment, type SearchOptions } from "../engine/search/searcher.ts";
import { Prompts } from "../engine/reading/types.ts";
import { terms as termsOf } from "../engine/searchtext.ts";
import type { Store } from "../engine/store.ts";
import type { Model } from "../engine/model.ts";
import type { Shown } from "../ui/results.ts";

export const REFRESH_MS = 3000;   // between searchers built while the index keeps changing
export const FOLLOW_MS = 10000;   // between files shown again while a view is open and the vault is being read
export const MAP_REFRESH_MS = 30000;   // between maps made while the vault is being read (as Dowse's)

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

/** Who's shown the index: whether a view is open, and how to tell them something new was made. */
export interface Follower {
  wanted: () => boolean;
  made: () => void;
}

export class VaultSearch {
  private store: Store;
  private model: { ready: () => Model | null; wake: () => void };
  private active: (path: string) => boolean;
  private searcher: Searcher | null = null;
  private building: Promise<Searcher> | null = null;
  private stale = true;
  private builtAt = 0;
  private bank: Float32Array[] | null = null;
  private latest: Shown[] = [];   // the vault's files, most recently changed first (the wall's rack)
  private mapFiles: MapFile[] = [];   // what Explore lays out (from the same read of the index)
  private map: { made: ExploreMap; of: number; at: number; named: boolean } | null = null;
  private mapping: Promise<ExploreMap> | null = null;
  private words: Float32Array[] | null = null;
  private follower: Follower | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `active`: whether a file is searched (not turned off: what's turned off keeps its index, and isn't found). */
  constructor(store: Store, model: { ready: () => Model | null; wake: () => void }, active: (path: string) => boolean) {
    this.store = store;
    this.model = model;
    this.active = active;
  }

  /** The index changed: the next search (or the background, while a view is open) builds a fresh searcher. */
  changed(): void {
    this.stale = true;
    this.schedule();
  }

  /** What the views show (the latest files, the map) is made again in the background while one is open, and
   * `made` says so: nothing is made while no view is open, nor polled while nothing changes. */
  follow(follower: Follower): void {
    this.follower = follower;
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.follower = null;
  }

  private schedule(): void {
    if (this.timer || !this.follower?.wanted()) return;
    this.timer = setTimeout(() => void this.refresh(), Math.max(0, this.builtAt + FOLLOW_MS - Date.now()));
  }

  private async refresh(): Promise<void> {
    this.timer = null;
    if (!this.follower?.wanted()) return;
    if (this.stale) {
      await this.current();
      this.follower?.made();
    }
    const map = this.map;
    if (map && map.of !== this.builtAt) {   // the map someone looked at: made again, at most every MAP_REFRESH_MS
      const wait = map.at + MAP_REFRESH_MS - Date.now();
      if (wait > 0) {
        this.timer = setTimeout(() => void this.refresh(), wait);
        return;
      }
      await this.explore();
      await this.mapping;
    }
    if (this.stale) this.schedule();
  }

  private async build(): Promise<Searcher> {
    const rows = (await this.store.files()).filter((row) => this.active(row.path));
    const ids = new Map(rows.map((row, i) => [row.path, i + 1]));
    const files: IndexFile[] = rows.map((row, i) => ({ id: i + 1, path: row.path, kind: row.kind, mtime: row.mtime, info: row.info }));
    const segments: IndexSegment[] = files.map((file) => ({
      id: -file.id, file: file.id, kind: "name", modality: "none", loc: null, locEnd: null,
      name: nameWords(file.path, file.info), body: "", vector: null,
    }));
    const first = new Map<string, string>();
    const mapped = new Map<string, MapFile>(rows.map((row) => [row.path, { path: row.path, kind: row.kind, vectors: [] }]));
    for (const segment of await this.store.segments()) {
      const file = ids.get(segment.path);
      if (file === undefined) continue;
      if (segment.vector) mapped.get(segment.path)!.vectors.push({ modality: segment.modality, vector: new Float16Array(segment.vector) });
      if (!first.has(segment.path) && segment.body) first.set(segment.path, segment.body.slice(0, 220));
      segments.push({ id: segment.id!, file, kind: segment.kind, modality: segment.modality ?? (segment.vector ? "text" : "none"),
                      loc: segment.loc, locEnd: segment.locEnd, name: "", body: segment.body,
                      vector: segment.vector ? new Float16Array(segment.vector) : null });
    }
    this.builtAt = Date.now();
    this.mapFiles = [...mapped.values()].sort((a, b) => (a.path < b.path ? -1 : 1));   // (a stable order: the same map)
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

  /** Explore's map. Remade in the background once the index has changed (at most every MAP_REFRESH_MS: the last
   * one is shown meanwhile), and once the model can name its aisles; only the first waits. */
  async explore(): Promise<ExploreMap> {
    await this.current();
    const model = this.model.ready();
    const due = !this.map || (this.map.of !== this.builtAt && Date.now() - this.map.at >= MAP_REFRESH_MS)
      || (!this.map.named && (model || this.words));
    if (due && !this.mapping) {
      this.mapping = (async () => {
        try {
          const of = this.builtAt, files = this.mapFiles;
          this.words ??= await wordVectors(this.store, model ? (prompts) => model.texts(prompts) : null).catch(() => null);
          const made = await buildMap(files, this.words);
          this.map = { made, of, at: Date.now(), named: this.words !== null };
          this.follower?.made();   // (a map made again, or named once the model came)
          return made;
        } finally {
          this.mapping = null;
        }
      })();
    }
    if (!this.map && !model) this.model.wake();   // to name the aisles
    return this.chosen(this.map?.made ?? (await this.mapping!));
  }

  /** The map without what was turned off since it was made (gone at once; the map is remade meanwhile). */
  private chosen(map: ExploreMap): ExploreMap {
    if (map.pieces.every((p) => this.active(p.path))) return map;
    const pieces = map.pieces.filter((p) => this.active(p.path));
    const membership = Object.fromEntries(Object.entries(map.membership)
      .map(([id, paths]) => [id, paths.filter((path) => this.active(path))]));
    const aisles = map.aisles.filter((a) => membership[a.id]?.length).map((a) => ({ ...a, count: membership[a.id].length }));
    return { aisles, pieces, total: Object.values(membership).reduce((n, paths) => n + paths.length, 0), membership };
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
