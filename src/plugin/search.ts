// Searching the vault: the searcher built from the vault's index (and rebuilt as reading adds to it, at most every
// few seconds, as Dowse does), the query asked of the model, and the answer. A search never waits for the model:
// while it's asleep or loading, words alone (and it's woken; the view searches again once it's ready).

import { forMeaning } from "../engine/search/dates.ts";
import { wordVectors, type ExploreGrouping, type ExploreMap } from "../engine/search/explore.ts";
import { LocalCatalog, type SearchCatalog } from "../engine/search/catalog.ts";
import { probes } from "../engine/search/probes.ts";
import { strongCount, type Hit, type SearchOptions } from "../engine/search/searcher.ts";
import { Prompts } from "../engine/reading/types.ts";
import { terms as termsOf } from "../engine/searchtext.ts";
import type { Store } from "../engine/store.ts";
import type { Model } from "../engine/model.ts";
import type { Shown } from "../ui/results.ts";
import { filtersFor, type Filters } from "./filters.ts";

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
  filters?: Filters;
}

export { clip, nameWords } from "../engine/search/catalog.ts";

/** Who's shown the index: whether a view is open, and how to tell them something new was made. */
export interface Follower {
  wanted: () => boolean;
  made: () => void;
}

export class VaultSearch {
  private store: Store;
  private model: { ready: () => Model | null; wake: () => void };
  private active: (path: string) => boolean;
  private catalog: SearchCatalog;
  private built = false;
  private building: Promise<void> | null = null;
  private closed = false;
  private stale = true;
  private builtAt = 0;
  private revision = 0;
  private forced = 0;
  private builtForced = 0;
  private buildId = 0;
  private bank: Float32Array[] | null = null;
  private probing: Promise<void> | null = null;
  private latest: Shown[] = [];   // the vault's files, most recently changed first (the wall's rack)
  private map: { made: ExploreMap; of: number; at: number; named: boolean } | null = null;
  private mapping: Promise<ExploreMap> | null = null;
  private folderMap: { made: ExploreMap; of: number } | null = null;
  private folderMapping: Promise<ExploreMap> | null = null;
  private words: Float32Array[] | null = null;
  private follower: Follower | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private urgent: ReturnType<typeof setTimeout> | null = null;

  /** `active`: whether a file is searched (not turned off: what's turned off keeps its index, and isn't found). */
  constructor(store: Store, model: { ready: () => Model | null; wake: () => void }, active: (path: string) => boolean,
              catalog: SearchCatalog = new LocalCatalog(store)) {
    this.store = store;
    this.model = model;
    this.active = active;
    this.catalog = catalog;
  }

  /** The index changed: the next search (or the background, while a view is open) builds a fresh searcher. */
  changed(immediate = false): void {
    if (this.closed) return;
    this.stale = true;
    this.revision++;
    if (immediate) {
      this.forced++;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (!this.urgent && this.follower?.wanted()) this.urgent = setTimeout(() => {
        this.urgent = null;
        if (!this.closed) { this.follower?.made(); this.schedule(); }
      }, 50);
      return;
    }
    this.schedule();
  }

  /** What the views show (the latest files, the map) is made again in the background while one is open, and
   * `made` says so: nothing is made while no view is open, nor polled while nothing changes. */
  follow(follower: Follower): void {
    this.follower = follower;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.urgent) clearTimeout(this.urgent);
    this.timer = null;
    this.follower = null;
    this.catalog.close();
  }

  private schedule(): void {
    if (this.timer || !this.follower?.wanted()) return;
    this.timer = setTimeout(() => void this.refresh().catch(error => { if (!this.closed) console.error(error); }), Math.max(0, this.builtAt + FOLLOW_MS - Date.now()));
  }

  private async refresh(): Promise<void> {
    this.timer = null;
    if (!this.follower?.wanted()) return;
    if (this.stale) {
      await this.current();
      this.follower?.made();
    }
    const map = this.map;
    if (map && map.of !== this.buildId) {   // the map someone looked at: made again, at most every MAP_REFRESH_MS
      const wait = map.at + MAP_REFRESH_MS - Date.now();
      if (wait > 0) {
        this.timer = setTimeout(() => void this.refresh().catch(error => { if (!this.closed) console.error(error); }), wait);
        return;
      }
      await this.explore();
      await this.mapping;
    }
    if (this.stale) this.schedule();
  }

  /** The searcher, rebuilt if the index changed and the last build is a few seconds old. */
  private async current(): Promise<void> {
    if (this.closed) throw new Error("Search is closed");
    const due = this.stale && (!this.built || this.forced !== this.builtForced || Date.now() - this.builtAt >= REFRESH_MS);
    if (this.built && !due) return;
    this.building ??= (async () => {
      const revision = this.revision, forced = this.forced;
      this.stale = false;
      try {
        const paths = (await this.store.files()).filter(row => this.active(row.path)).map(row => row.path);
        this.latest = await this.catalog.build(paths, this.bank);
        this.built = true;
        this.builtAt = Date.now();
        this.builtForced = forced;
        this.buildId++;
        this.stale = revision !== this.revision;
      } catch (error) {
        this.stale = true;
        throw error;
      } finally {
        this.building = null;
      }
    })();
    await this.building;
    // A selection change or completed read can arrive while an older snapshot is being built.
    // Its urgent refresh must not be lost when that build publishes its timestamp.
    if (this.forced !== this.builtForced) await this.current();
  }

  /** The probes' vectors, embedded once per vault with the model (then the searcher can tell hubs and plain
   * matches); a searcher built before they were is built again. */
  private async ensureProbes(model: Model): Promise<void> {
    if (this.bank) return;
    this.probing ??= (async () => {
      try {
        this.bank = await probes(this.store, prompts => model.texts(prompts));
        this.changed(true);
      } finally { this.probing = null; }
    })();
    await this.probing;
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
    await this.current();
    const hits = (await this.catalog.search(query, vector, { prefixLast: true, limit: query.trim() ? 60 : Number.MAX_SAFE_INTEGER, ...options })).filter(h => this.active(h.path));
    if (!query.trim()) for (const hit of hits) hit.clear = true;   // a filter-only browse: every row meets the requested constraints
    return { query, hits, strong: query.trim() ? strongCount(hits) : hits.length, terms: termsOf(forMeaning(query, options.now)),
             meaning: vector !== null, ms: performance.now() - started, filters: filtersFor(query, options) };
  }

  /** Explore's map. Remade in the background once the index has changed (at most every MAP_REFRESH_MS: the last
   * one is shown meanwhile), and once the model can name its aisles; only the first waits. */
  async explore(grouping: ExploreGrouping = "content"): Promise<ExploreMap> {
    await this.current();
    if (grouping === "folder") {
      if (this.folderMap?.of === this.buildId) return this.chosen(this.folderMap.made);
      this.folderMapping ??= (async () => {
        try {
          const of = this.buildId;
          const made = await this.catalog.map(null, "folder");
          this.folderMap = { made, of };
          return made;
        } finally { this.folderMapping = null; }
      })();
      return this.chosen(await this.folderMapping);
    }
    const model = this.model.ready();
    const due = !this.map || (this.map.of !== this.buildId && Date.now() - this.map.at >= MAP_REFRESH_MS)
      || (!this.map.named && (model || this.words));
    if (due && !this.mapping) {
      this.mapping = (async () => {
        try {
          const of = this.buildId;
          this.words ??= await wordVectors(this.store, model ? (prompts) => model.texts(prompts) : null).catch(() => null);
          const made = await this.catalog.map(this.words);
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
  async recent(limit = Infinity): Promise<Shown[]> {
    await this.current();
    return this.latest.filter(item => this.active(item.path)).slice(0, limit);
  }

  /** More like this: the files nearest to a file of the vault (its own vectors: the model isn't needed). */
  async similar(path: string, loc: number | null = null, options: SearchOptions = {}): Promise<Answer> {
    const started = performance.now();
    if (!this.active(path)) return { query: "", hits: [], strong: 0, terms: [], meaning: true, ms: 0 };
    await this.current();
    const hits = (await this.catalog.similar(path, loc, { limit: 30, exclude: new Set([path]), ...options })).filter(h => this.active(h.path));
    return { query: "", hits, strong: strongCount(hits), terms: [], meaning: true, ms: performance.now() - started };
  }
}
