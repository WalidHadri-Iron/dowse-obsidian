// Keeps the vault's index in step with the vault: finds what's new, changed or gone, and reads what's waiting, a step
// at a time (a long note 40 passages at a time, a PDF 30 pages at a time), each step saved as it's read, so a stopped
// run resumes where it was. You first: between passages it waits while you're typing.

import { readCanvas } from "./reading/canvas.ts";
import { readNote } from "./reading/markdown.ts";
import { readPdfStep, type PdfLike } from "./reading/pdf.ts";
import { kindOf, READ_NOW, READERS, type Kind, type Piece } from "./reading/types.ts";
import { toHalf, type FileRow, type SegmentRow, type Store } from "./store.ts";

export interface VaultFile { path: string; mtime: number; size: number }

/** The vault, as the indexer needs it (Obsidian's vault in the plugin; a folder in the tests). */
export interface Source {
  list(): VaultFile[];
  text(path: string): Promise<string>;
  pdf(path: string): Promise<PdfLike & { destroy?(): Promise<void> | void }>;
}

/** Vectors for the model's prompts, one each. */
export type Embed = (prompts: string[]) => Promise<Float32Array[]>;

export interface Status {
  state: "idle" | "reading" | "waiting" | "stopped";
  done: number;           // files read
  total: number;          // files to read, all told
  current?: string;       // the file being read
  failed: number;
}

export const DOC_STEP = 40;   // passages a step

export interface IndexerOptions {
  active: (path: string) => boolean;      // chosen (not turned off)
  embed: () => Promise<Embed>;            // the model, loaded when there's something to read
  busy?: () => boolean;                   // the person is typing: wait
  onStatus?: (status: Status) => void;
  onSaved?: (path: string) => void;       // a step saved: search sees it
}

export class Indexer {
  status: Status = { state: "idle", done: 0, total: 0, failed: 0 };
  private wake: (() => void) | null = null;
  private settledWaiters: (() => void)[] = [];
  private running = false;
  private stopped = false;

  private store: Store;
  private source: Source;
  private options: IndexerOptions;

  constructor(store: Store, source: Source, options: IndexerOptions) {
    this.store = store;
    this.source = source;
    this.options = options;
  }

  private report(change: Partial<Status>): void {
    this.status = { ...this.status, ...change };
    this.options.onStatus?.(this.status);
  }

  private readable(path: string): Kind | null {
    const kind = kindOf(path);
    return kind && READ_NOW.has(kind) && this.options.active(path) ? kind : null;
  }

  /** The vault against the index: new, changed and unread files waiting, gone ones dropped (turned-off ones keep
   * what's read of them). Answers how many files wait. */
  async sync(): Promise<number> {
    const rows = new Map((await this.store.files()).map((row) => [row.path, row]));
    const present = new Set<string>();
    for (const file of this.source.list()) {
      present.add(file.path);
      const kind = this.readable(file.path);
      const row = rows.get(file.path);
      if (!kind) continue;
      const stale = !row || row.mtime !== file.mtime || row.size !== file.size || row.reader < READERS[kind];
      if (stale) await this.store.putFile(this.pending(file, kind, row));
    }
    for (const path of rows.keys()) if (!present.has(path)) await this.store.remove(path);
    const waiting = (await this.waiting()).length;
    this.report({ total: this.status.done + waiting });
    this.poke();
    return waiting;
  }

  private pending(file: VaultFile, kind: Kind, previous?: FileRow): FileRow {
    return { path: file.path, kind, mtime: file.mtime, size: file.size, state: "pending",
             info: previous?.info ?? {}, next: null, reader: previous?.reader ?? 0 };
  }

  /** What waits, the most recently changed first (the note you just wrote before last year's). */
  private async waiting(): Promise<FileRow[]> {
    const rows = await this.store.files();
    return rows.filter((row) => row.state === "pending" && this.options.active(row.path))
      .sort((a, b) => b.mtime - a.mtime);
  }

  /** A file was created or changed (Obsidian's event): read it again. */
  async changed(file: VaultFile): Promise<void> {
    const kind = this.readable(file.path);
    if (!kind) return;
    const row = await this.store.file(file.path);
    if (row && row.mtime === file.mtime && row.size === file.size && row.state !== "pending") return;
    await this.store.putFile(this.pending(file, kind, row));
    this.report({ total: this.status.total + 1 });
    this.poke();
  }

  async removed(path: string): Promise<void> {
    for (const row of await this.store.files()) {
      if (row.path === path || row.path.startsWith(path + "/")) await this.store.remove(row.path);
    }
    this.options.onSaved?.(path);
  }

  /** Renamed or moved (a folder: everything in it): the same rows and vectors under the new paths. */
  async renamed(from: string, to: string): Promise<void> {
    for (const row of await this.store.files()) {
      if (row.path === from) await this.store.rename(from, to);
      else if (row.path.startsWith(from + "/")) await this.store.rename(row.path, to + row.path.slice(from.length));
    }
    this.options.onSaved?.(to);
  }

  private poke(): void {
    this.wake?.();
  }

  /** Reads what waits, until `stop`; sleeps when nothing does, and wakes when something comes. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    try {
      while (!this.stopped) {
        const next = (await this.waiting())[0];
        if (!next) {
          this.report({ state: "idle", current: undefined });
          for (const settled of this.settledWaiters.splice(0)) settled();
          await new Promise<void>((resolve) => (this.wake = resolve));
          this.wake = null;
          continue;
        }
        this.report({ state: "reading", current: next.path });
        await this.read(next);
        this.report({ done: this.status.done + 1 });
      }
    } finally {
      this.running = false;
      this.report({ state: "stopped", current: undefined });
    }
  }

  /** Resolves once everything waiting is read (the run finds nothing more to read). */
  settled(): Promise<void> {
    return new Promise((resolve) => {
      this.settledWaiters.push(resolve);
      this.poke();
    });
  }

  stop(): void {
    this.stopped = true;
    this.poke();
  }

  private async pause(): Promise<void> {
    while (this.options.busy?.() && !this.stopped) {
      this.report({ state: "waiting" });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (this.status.state === "waiting") this.report({ state: "reading" });
  }

  private async read(row: FileRow): Promise<void> {
    try {
      if (row.kind === "pdf") await this.readPdf(row);
      else await this.readText(row);
    } catch (error) {
      const latest = await this.store.file(row.path);
      if (latest && latest.mtime === row.mtime) {
        await this.store.putFile({ ...latest, state: "failed", detail: error instanceof Error ? error.message : String(error) });
        this.report({ failed: this.status.failed + 1 });
      }
    }
  }

  /** A note or a canvas: read once, embedded and saved 40 passages at a time from where it was. */
  private async readText(row: FileRow): Promise<void> {
    const source = await this.source.text(row.path);
    const reading = row.kind === "canvas" ? readCanvas(row.path, source) : readNote(row.path, source);
    const start = row.next ?? 0;
    if (!reading.pieces.length) {
      await this.save(row, [], { ...reading.info, ...(reading.note ? { note: reading.note } : {}) }, null, true);
      return;
    }
    for (let from = start; from < reading.pieces.length && !this.stopped; from += DOC_STEP) {
      const to = Math.min(from + DOC_STEP, reading.pieces.length);
      const segments = await this.embed(reading.pieces.slice(from, to));
      if (!segments) return;   // stopped: resumes from `from`
      if (!(await this.save(row, segments, reading.info, to < reading.pieces.length ? to : null, from === 0))) return;
    }
  }

  private async readPdf(row: FileRow): Promise<void> {
    const pdf = await this.source.pdf(row.path);
    try {
      let start: number | null = row.next ?? 0;
      let first = start === 0;
      while (start !== null && !this.stopped) {
        const step = await readPdfStep(row.path, pdf, start);
        const segments = await this.embed(step.pieces);
        if (!segments) return;
        if (!(await this.save(row, segments, step.info, step.next, first))) return;
        start = step.next;
        first = false;
      }
    } finally {
      await pdf.destroy?.();
    }
  }

  /** The pieces' vectors, a passage at a time (a GPU reads no faster in batches; one at a time lets you go first). */
  private async embed(pieces: Piece[]): Promise<SegmentRow[] | null> {
    const out: SegmentRow[] = [];
    let model: Embed | null = null;
    for (const piece of pieces) {
      await this.pause();
      if (this.stopped) return null;
      let vector: ArrayBuffer | null = null;
      if (piece.text !== null) {
        model ??= await this.options.embed();
        vector = toHalf((await model([piece.text]))[0]);
      }
      out.push({ path: "", kind: piece.kind, loc: piece.loc, locEnd: piece.locEnd ?? null, body: piece.body, vector });
    }
    return out;
  }

  /** Saves a step, unless the file changed meanwhile (then it's read again from the start). */
  private async save(row: FileRow, segments: SegmentRow[], info: Record<string, unknown>, next: number | null,
                     restart: boolean): Promise<boolean> {
    const latest = await this.store.file(row.path);
    if (!latest || latest.mtime !== row.mtime || latest.size !== row.size) return false;
    const saved: FileRow = { ...row, info, next, state: next === null ? "done" : "pending", reader: READERS[row.kind] };
    delete saved.detail;
    await this.store.saveStep(saved, segments, restart);
    Object.assign(row, saved);
    this.options.onSaved?.(row.path);
    return true;
  }
}
