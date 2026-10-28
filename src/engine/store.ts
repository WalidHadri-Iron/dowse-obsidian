// The vault's index, in Obsidian's own browser storage (IndexedDB), one database per vault: never inside the vault,
// where a sync service (Obsidian Sync, iCloud, Dropbox) would upload it on every change. It can always be read again.
//
// files: each file of the vault Dowse reads, how far it's read (`next`: resumes a long PDF), what's known of it.
// segments: its pieces: a passage, a page, a card; what keyword search keeps (`body`) and its vector (fp16 bytes).
// meta: the model the vectors are of; an index of another model's vectors is cleared (one vector space, never two).

import type { Kind, Modality, Piece } from "./reading/types.ts";

export interface FileRow {
  path: string;
  kind: Kind;
  mtime: number;
  size: number;
  state: "pending" | "done" | "failed";
  detail?: string;                       // why it failed, or what's still to read
  info: Record<string, unknown>;
  next: number | null;                   // where reading resumes (a page), null when done
  reader: number;                        // the version of its kind's reader that read it
}

export interface SegmentRow {
  id?: number;
  path: string;
  kind: Piece["kind"];
  modality: Modality;
  loc: number | null;
  locEnd: number | null;
  body: string;
  vector: ArrayBuffer | null;            // 768 fp16 values; null: keyword search only
}

const VERSION = 1;

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("the index's transaction was aborted"));
  });
}

export function toHalf(vector: ArrayLike<number>): ArrayBuffer {
  return Float16Array.from(vector as ArrayLike<number>).buffer as ArrayBuffer;
}

export class Store {
  private db: IDBDatabase;
  readonly name: string;

  private constructor(db: IDBDatabase, name: string) {
    this.db = db;
    this.name = name;
  }

  /** The vault's index (`name`: one per vault), cleared if it holds another model's vectors than `model`'s. */
  static async open(name: string, model: string, factory: IDBFactory = indexedDB): Promise<Store> {
    const request = factory.open(name, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "path" });
      if (!db.objectStoreNames.contains("segments")) {
        db.createObjectStore("segments", { keyPath: "id", autoIncrement: true }).createIndex("path", "path");
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    const store = new Store(await done(request), name);
    const held = await store.meta<string>("model");
    if (held !== undefined && held !== model) await store.clear();
    if (held !== model) await store.setMeta("model", model);
    return store;
  }

  async meta<T>(key: string): Promise<T | undefined> {
    return done(this.db.transaction("meta").objectStore("meta").get(key));
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(value, key);
    await finished(tx);
  }

  files(): Promise<FileRow[]> {
    return done(this.db.transaction("files").objectStore("files").getAll());
  }

  file(path: string): Promise<FileRow | undefined> {
    return done(this.db.transaction("files").objectStore("files").get(path));
  }

  segments(): Promise<SegmentRow[]> {
    return done(this.db.transaction("segments").objectStore("segments").getAll());
  }

  segmentsOf(path: string): Promise<SegmentRow[]> {
    return done(this.db.transaction("segments").objectStore("segments").index("path").getAll(path));
  }

  async putFile(row: FileRow): Promise<void> {
    const tx = this.db.transaction("files", "readwrite");
    tx.objectStore("files").put(row);
    await finished(tx);
  }

  /** One step of a file, saved at once: its row and its new segments (`restart`: its old ones dropped first). */
  async saveStep(row: FileRow, segments: SegmentRow[], restart: boolean): Promise<void> {
    const tx = this.db.transaction(["files", "segments"], "readwrite");
    const store = tx.objectStore("segments");
    if (restart) {
      const keys = await done(store.index("path").getAllKeys(row.path));
      for (const key of keys) store.delete(key);
    }
    for (const segment of segments) store.add({ ...segment, path: row.path });
    tx.objectStore("files").put(row);
    await finished(tx);
  }

  async remove(path: string): Promise<void> {
    const tx = this.db.transaction(["files", "segments"], "readwrite");
    const store = tx.objectStore("segments");
    for (const key of await done(store.index("path").getAllKeys(path))) store.delete(key);
    tx.objectStore("files").delete(path);
    await finished(tx);
  }

  /** A file renamed or moved: the same row and vectors, under its new path. */
  async rename(from: string, to: string): Promise<void> {
    const tx = this.db.transaction(["files", "segments"], "readwrite");
    const files = tx.objectStore("files");
    const row = await done(files.get(from)) as FileRow | undefined;
    if (!row) { tx.abort(); return finished(tx).catch(() => {}); }
    files.delete(from);
    files.put({ ...row, path: to });
    const segments = tx.objectStore("segments");
    for (const segment of await done(segments.index("path").getAll(from)) as SegmentRow[]) segments.put({ ...segment, path: to });
    await finished(tx);
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(["files", "segments", "meta"], "readwrite");
    for (const name of ["files", "segments", "meta"]) tx.objectStore(name).clear();
    await finished(tx);
  }

  close(): void {
    this.db.close();
  }
}
