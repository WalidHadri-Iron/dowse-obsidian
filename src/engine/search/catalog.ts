// The expensive index and its queries live together, in the search worker in the app (in-process in unit tests).
import { buildFolderMap, buildMap, type ExploreGrouping, type ExploreMap, type MapFile } from "./explore.ts";
import { Searcher, type Hit, type IndexFile, type IndexSegment, type SearchOptions } from "./searcher.ts";
import type { Store } from "../store.ts";
import type { Shown } from "../../ui/results.ts";

export function clip(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length), space = cut.lastIndexOf(" ");
  return `${(space > length * .6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/, "")}…`;
}

export function nameWords(path: string, info: Record<string, unknown>): string {
  const parts = path.split("/"), name = parts.pop() ?? "";
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return [stem, ...parts.slice(-3), ...((info.tags as string[]) ?? []), ...((info.aliases as string[]) ?? [])]
    .join(" ").replace(/[_-]/g, " ");
}

export interface SearchCatalog {
  build(paths: string[], bank: Float32Array[] | null): Promise<Shown[]>;
  search(query: string, vector: Float32Array | null, options: SearchOptions): Promise<Hit[]>;
  similar(path: string, loc: number | null, options: SearchOptions): Promise<Hit[]>;
  map(words: Float32Array[] | null, grouping?: ExploreGrouping): Promise<ExploreMap>;
  close(): void;
}

export class LocalCatalog implements SearchCatalog {
  private searcher: Searcher | null = null;
  private files: MapFile[] = [];
  private store: Store;
  constructor(store: Store) { this.store = store; }

  async build(paths: string[], bank: Float32Array[] | null): Promise<Shown[]> {
    const allowed = new Set(paths);
    const rows = (await this.store.files()).filter(row => allowed.has(row.path));
    const ids = new Map(rows.map((row, i) => [row.path, i + 1]));
    const files: IndexFile[] = rows.map((row, i) => ({ id: i + 1, path: row.path, kind: row.kind, mtime: row.mtime, info: row.info }));
    const segments: IndexSegment[] = files.map(file => ({ id: -file.id, file: file.id, kind: "name", modality: "none",
      loc: null, locEnd: null, name: nameWords(file.path, file.info), body: "", vector: null }));
    const first = new Map<string, string>();
    const mapped = new Map<string, MapFile>(rows.map(row => [row.path, { path: row.path, kind: row.kind, vectors: [] }]));
    for (const segment of await this.store.segments()) {
      const file = ids.get(segment.path);
      if (file === undefined) continue;
      const vector = segment.vector ? new Float16Array(segment.vector) : null;
      if (vector) mapped.get(segment.path)!.vectors.push({ modality: segment.modality, vector });
      if (!first.has(segment.path) && segment.body) first.set(segment.path, clip(segment.body, 220));
      segments.push({ id: segment.id!, file, kind: segment.kind, modality: segment.modality ?? (vector ? "text" : "none"),
        loc: segment.loc, locEnd: segment.locEnd, name: "", body: segment.body, vector });
    }
    // Publish only a complete replacement. Requests queued during the build cannot observe half an index.
    this.searcher = new Searcher(files, segments, bank);
    this.files = [...mapped.values()].sort((a, b) => a.path < b.path ? -1 : 1);
    return [...rows].sort((a, b) => b.mtime - a.mtime).map(row => ({ path: row.path, kind: row.kind,
      loc: null, locEnd: null, excerpt: first.get(row.path) ?? null, info: row.info, mtime: row.mtime }));
  }

  async search(query: string, vector: Float32Array | null, options: SearchOptions): Promise<Hit[]> {
    return this.searcher?.search(query, vector, options) ?? [];
  }

  async similar(path: string, loc: number | null, options: SearchOptions): Promise<Hit[]> {
    const vectors = this.searcher?.vectorsOf(path, loc) ?? [];
    return vectors.length ? this.searcher!.like(vectors, options) : [];
  }

  async map(words: Float32Array[] | null, grouping: ExploreGrouping = "content"): Promise<ExploreMap> {
    return grouping === "folder" ? buildFolderMap(this.files) : buildMap(this.files, words);
  }
  close(): void { this.searcher = null; this.files = []; }
}
