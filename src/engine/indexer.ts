// Keeps the vault's index in step with the vault: finds what's new, changed or gone, and reads what's waiting, a step
// at a time (a long note 40 passages, a PDF 30 pages, a recording or video ten minutes), each step saved as it's
// read, so a stopped run resumes where it was. You first: between pieces it waits while you're typing, and it stops
// while reading is paused (your pause, the battery) or the model can't start (no connection for its download: the
// files wait, they aren't failed).
//
// How long is left is told from how fast this computer has read each kind of file so far (time a byte; an image's
// time a file), once it has read enough to tell.
//
// Every file of a kind Dowse knows has a row, so its name is searched; what's in an image, a recording or a video is
// read once the model's part for it (images, sound) is on. Until then the row says what it waits for, and turning that
// part on reads it, a PDF's scanned pages added to what was read of its text.

import { readCanvas } from "./reading/canvas.ts";
import { readNote } from "./reading/markdown.ts";
import { averageHash, frameTimes, isScreenshot, mediaOptions, sameShot, windows, type MediaOptions } from "./reading/media.ts";
import { readPdfStep, type PdfLike } from "./reading/pdf.ts";
import { kindOf, modalityOf, NEEDS, READERS, type Kind, type Piece } from "./reading/types.ts";
import type { Parts, Picture } from "./protocol.ts";
import { toHalf, type FileRow, type SegmentRow, type Store } from "./store.ts";
import { Cancelled } from "./cancel.ts";

export interface VaultFile { path: string; mtime: number; size: number }

export type Pdf = PdfLike & { destroy?(): Promise<void> | void };

/** The vault, as the indexer needs it (Obsidian's vault in the plugin; memory in the tests). */
export interface Source {
  list(): VaultFile[];
  text(path: string): Promise<string>;
  pdf(path: string): Promise<Pdf>;
  /** An image sized for `budget` (or one tall/wide enough to hold a token), or null: too small or unreadable. */
  picture(path: string, budget: number, minSide: number): Promise<Picture | null>;
  /** A PDF page drawn and sized for `budget`. */
  page(pdf: Pdf, number: number, budget: number, signal?: AbortSignal): Promise<Picture | null>;
  /** A recording's (or a video's) sound, mono 16 kHz, or null: none, or too large to decode at once. */
  sound(path: string, signal?: AbortSignal): Promise<Float32Array | null>;
  /** A video's length in seconds, and its frames at `times`, each sized for `budget` with its 8×8 grey levels. */
  video(path: string, signal?: AbortSignal): Promise<{ duration: number; frames(times: number[], budget: number):
    Promise<{ time: number; picture: Picture; grey: number[] }[]>; close(): void } | null>;
}

/** The model, as reading needs it. */
export interface Embedder {
  texts(prompts: string[]): Promise<Float32Array[]>;
  images(pictures: Picture[]): Promise<Float32Array[]>;
  audio(clips: Float32Array[]): Promise<Float32Array[]>;
}

export interface Status {
  state: "idle" | "reading" | "waiting" | "paused" | "stopped";
  done: number;           // files read
  total: number;          // files to read, all told
  current?: string;       // the file being read
  failed: number;
  held?: string;          // why it's paused ("paused", "on battery", "the model couldn't start")
  left?: number | null;   // seconds left, about (null until enough is read to tell)
}

/** The model couldn't be had (its download, its start): reading waits for it, and the file isn't failed. */
export class ModelMissing extends Error {}

export const RETRY_MS = 2 * 60 * 1000;   // the model tried again, when it couldn't start
const PER_FILE = new Set<Kind>(["image"]);   // a picture takes as long whatever its file's size
const TELLS = { files: 3, seconds: 5 };   // read before the time left is told

export const DOC_STEP = 40;   // passages a step

export interface IndexerOptions {
  active: (path: string) => boolean;      // chosen (not turned off)
  parts: () => Parts;                     // the model's parts that are on (images, sound)
  embed: () => Promise<Embedder>;         // the model, loaded when there's something to read
  gpu?: () => boolean;                    // on a GPU (bigger pictures, more frames), as far as is known
  busy?: () => boolean;                   // the person is typing: wait
  held?: () => string | null;             // reading paused, and why (the person's pause, the battery)
  onStatus?: (status: Status) => void;
  onSaved?: (path: string) => void;       // a step saved: search sees it
}

export class Indexer {
  status: Status = { state: "idle", done: 0, total: 0, failed: 0 };
  private wake: (() => void) | null = null;
  private settledWaiters: (() => void)[] = [];
  private running = false;
  private task: Promise<void> | null = null;
  private version = 0;
  private waitingRows: FileRow[] | null = null;
  private abort = new AbortController();
  private stopped = false;
  private waited = 0;   // ms of the file being read spent waiting (for you, for the model): not reading
  private speed = new Map<Kind, { seconds: number; bytes: number; files: number }>();

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
    return kind && this.options.active(path) ? kind : null;
  }

  /** The model's parts a file still waits for that are now on (then it's read). */
  private nowReadable(row: FileRow): boolean {
    const waiting = (row.info.waitingFor as string[] | undefined) ?? [];
    const parts = this.options.parts();
    return waiting.some((part) => parts[part as keyof Parts]);
  }

  /** The vault against the index: new, changed and unread files waiting, gone ones dropped (turned-off ones keep
   * what's read of them), and those waiting for a part of the model that's now on. Answers how many files wait. */
  async sync(): Promise<number> {
    const rows = new Map((await this.store.files()).map((row) => [row.path, row]));
    const present = new Set<string>();
    for (const file of this.source.list()) {
      present.add(file.path);
      const kind = this.readable(file.path);
      const row = rows.get(file.path);
      if (row && !kindOf(file.path)) { await this.store.remove(file.path); continue; }
      if (!kind) continue;
      const stale = !row || row.kind !== kind || row.mtime !== file.mtime || row.size !== file.size || row.reader < READERS[kind];
      if (stale) await this.store.putFile(this.pending(file, kind, row));
      else if (row.state === "done" && this.nowReadable(row)) await this.store.putFile({ ...row, state: "pending", next: null });
    }
    for (const path of rows.keys()) if (!present.has(path)) await this.store.remove(path);
    this.poke();
    const waiting = (await this.waiting()).length;
    this.report({ total: this.status.done + waiting });
    return waiting;
  }

  private pending(file: VaultFile, kind: Kind, previous?: FileRow): FileRow {
    return { path: file.path, kind, mtime: file.mtime, size: file.size, state: "pending",
             info: {}, next: null, reader: previous?.reader ?? 0 };
  }

  /** What waits, the most recently changed first (the note you just wrote before last year's). */
  private async waiting(): Promise<FileRow[]> {
    if (!this.waitingRows) {
      const version = this.version;
      const rows = await this.store.files();
      // A mutation can finish while IndexedDB returns an older snapshot. Never publish that snapshot as current.
      if (version !== this.version) return this.waiting();
      this.waitingRows = rows.filter((row) => row.state === "pending" && this.options.active(row.path))
        .sort((a, b) => b.mtime - a.mtime);
    }
    // Saves update the queued row in place. Reuse the remaining work instead of cloning the whole vault per file.
    const queued = this.waitingRows;
    while (queued.length) {
      const next = queued[0];
      if (next.state === "pending" && this.options.active(next.path)) {
        const version = this.version;
        const current = await this.store.file(next.path);
        if (version !== this.version || queued !== this.waitingRows) return this.waiting();
        // A concurrent sync may have captured this file just before its previous read finished. Check one row,
        // rather than reloading all rows, so it cannot be read twice or use an obsolete revision.
        if (current?.state === "pending" && this.options.active(next.path)) { Object.assign(next, current); return queued; }
      }
      queued.shift();
    }
    return queued;
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
    await this.store.removeTree(path);
    this.poke();
    this.options.onSaved?.(path);
  }

  /** Renamed or moved (a folder: everything in it): the same rows and vectors under the new paths. */
  async renamed(from: string, to: string): Promise<void> {
    for (const row of await this.store.filesWithin(from)) {
      if (row.path === from) await this.store.rename(from, to);
      else if (row.path.startsWith(from + "/")) await this.store.rename(row.path, to + row.path.slice(from.length));
    }
    this.poke();
    this.options.onSaved?.(to);
  }

  private poke(): void {
    this.version++;
    this.waitingRows = null;
    this.wake?.();
  }

  /** Reads what waits, until `stop`; sleeps when nothing does, and wakes when something comes. */
  run(): Promise<void> {
    if (this.task) return this.task;
    this.task = this.loop().finally(() => { this.task = null; });
    return this.task;
  }

  private async loop(): Promise<void> {
    this.running = true;
    this.stopped = false;
    this.waitingRows = null;
    this.abort = new AbortController();
    try {
      while (!this.stopped) {
        const version = this.version;
        const waiting = await this.waiting();
        if (this.stopped) break;
        const next = waiting[0];
        if (!next) {
          this.report({ state: "idle", current: undefined, held: undefined, left: null });
          for (const settled of this.settledWaiters.splice(0)) settled();
          await this.sleep(undefined, version);
          continue;
        }
        this.report({ state: "reading", current: next.path, left: this.estimate(waiting), held: undefined });
        await this.pause();
        if (this.stopped) break;
        const started = performance.now();
        this.waited = 0;
        try {
          await this.read(next);
        } catch (error) {
          if (this.stopped) break;
          if (error instanceof Cancelled) { await this.sleep(50); continue; }
          if (!(error instanceof ModelMissing)) throw error;
          this.report({ state: "paused", held: "the model couldn't start" });   // tried again later, or when asked
          await this.sleep(RETRY_MS);
          continue;
        }
        this.learn(next, (performance.now() - started - this.waited) / 1000);
        this.report({ done: this.status.done + 1 });
      }
    } finally {
      this.running = false;
      this.report({ state: "stopped", current: undefined });
      for (const settled of this.settledWaiters.splice(0)) settled();
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
    this.abort.abort();
    this.poke();
  }

  async join(): Promise<void> { await this.task; }

  /** Waits while reading is paused, or while you're typing. */
  private async pause(): Promise<void> {
    while (!this.stopped) {
      const held = this.options.held?.() ?? null;
      if (held) this.report({ state: "paused", held });
      else if (this.options.busy?.()) this.report({ state: "waiting", held: undefined });
      else break;
      const started = performance.now();
      await this.sleep(500);   // (or resumed)
      this.waited += performance.now() - started;
    }
    if (this.status.state === "waiting" || this.status.state === "paused") this.report({ state: "reading", held: undefined });
  }

  /** Waits `ms`, or until poked. */
  private async sleep(ms?: number, version = this.version): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>((resolve) => {
      if (this.stopped || version !== this.version) { resolve(); return; }
      this.wake = resolve;
      if (ms !== undefined) timer = setTimeout(resolve, ms);
    });
    clearTimeout(timer);
    this.wake = null;
  }

  /** Reading resumed, or the model to be tried again: looked at now. */
  resume(): void {
    this.poke();
  }

  /** How long a file of its kind took (not counting waits). */
  private learn(row: FileRow, seconds: number): void {
    const speed = this.speed.get(row.kind) ?? { seconds: 0, bytes: 0, files: 0 };
    this.speed.set(row.kind, { seconds: speed.seconds + seconds, bytes: speed.bytes + row.size, files: speed.files + 1 });
  }

  /** Seconds left for what waits, from the speeds so far: null until enough is read to tell. */
  estimate(waiting: FileRow[]): number | null {
    const all = [...this.speed.values()].reduce((a, s) => ({ seconds: a.seconds + s.seconds, files: a.files + s.files }),
                                                { seconds: 0, files: 0 });
    if (all.files < TELLS.files || all.seconds < TELLS.seconds) return null;
    let left = 0;
    for (const row of waiting) {
      const speed = this.speed.get(row.kind);
      if (!speed || speed.files < 2) left += all.seconds / all.files;   // a kind not read yet: the files' mean
      else if (PER_FILE.has(row.kind) || !speed.bytes) left += speed.seconds / speed.files;
      else left += (row.size * speed.seconds) / speed.bytes;
    }
    return left;
  }

  private media(): MediaOptions {
    return mediaOptions(this.options.gpu?.() ?? true);
  }

  /** The model's parts `kind` needs that are off: it's searched by name (and read when they're on). */
  private missing(kind: Kind): ("image" | "audio")[] {
    const parts = this.options.parts();
    return NEEDS[kind].filter((part) => !parts[part]);
  }

  private async read(row: FileRow): Promise<void> {
    try {
      if (row.kind === "pdf") await this.readPdf(row);
      else if (row.kind === "image") await this.readImage(row);
      else if (row.kind === "audio") await this.readAudio(row);
      else if (row.kind === "video") await this.readVideo(row);
      else await this.readText(row);
    } catch (error) {
      if (this.stopped || error instanceof Cancelled || error instanceof ModelMissing) throw error;
      const latest = await this.store.file(row.path);
      this.waitingRows = null;
      if (!latest || !this.options.active(row.path)) return;
      const saved = await this.store.saveStep({ ...latest, state: "failed",
        detail: error instanceof Error ? error.message : String(error) }, [], false, row);
      if (saved) this.report({ failed: this.status.failed + 1 });
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

  /** A PDF, 30 pages a step: pages with text as passages, the others (scans, slides) as pictures once images are on.
   * Read before images were on, only its pictures are read now, added to what's there. */
  private async readPdf(row: FileRow): Promise<void> {
    const pdf = await this.source.pdf(row.path);
    const media = this.media();
    try {
      const adding = (row.info.waitingFor as string[] | undefined)?.includes("image") && row.next === null &&
        this.options.parts().image && Array.isArray(row.info.pictures);
      if (adding) {
        const pages = row.info.pictures as number[];
        for (let i = Number(row.info.pictureNext ?? 0); i < pages.length && !this.stopped; i++) {
          await this.pause();
          if (this.stopped) return;
          const number = pages[i];
          const picture = await this.source.page(pdf, number, media.page, this.abort.signal);
          const segments = await this.embed(picture ? [{ kind: "page", text: null, picture, body: "", loc: number }] : []);
          if (!segments) return;
          const last = i + 1 === pages.length;
          if (!(await this.save(row, segments, { ...row.info, pictureNext: last ? undefined : i + 1,
            waitingFor: last ? undefined : ["image"] }, null, false))) return;
        }
        return;
      }
      let start: number | null = row.next ?? 0;
      let first = start === 0;
      let info = first ? {} : { ...row.info };
      while (start !== null && !this.stopped) {
        const step = await readPdfStep(row.path, pdf, start);
        const pictures = [...((info as { pictures?: number[] }).pictures ?? []), ...((step.info.pictures as number[]) ?? [])];
        if (this.options.parts().image) {   // the step's scanned pages, as pictures (their few words stay for keywords)
          for (const number of (step.info.pictures as number[]) ?? []) {
            await this.pause();
            if (this.stopped) return;
            const picture = await this.source.page(pdf, number, media.page, this.abort.signal);
            if (picture) step.pieces.push({ kind: "page", text: null, picture, body: "", loc: number });
          }
        }
        info = { ...info, ...step.info, ...(pictures.length ? { pictures } : {}),
                 waitingFor: pictures.length && !this.options.parts().image ? ["image"] : undefined };
        const segments = await this.embed(step.pieces);
        if (!segments) return;
        if (!(await this.save(row, segments, info, step.next, first))) return;
        start = step.next;
        first = false;
      }
    } finally {
      await pdf.destroy?.();
    }
  }

  /** Searched by name until the model's part for it is on. */
  private async byName(row: FileRow, missing: string[]): Promise<void> {
    await this.save(row, [], { waitingFor: missing }, null, true);
  }

  private async readImage(row: FileRow): Promise<void> {
    const missing = this.missing("image");
    if (missing.length) return this.byName(row, missing);
    const media = this.media();
    const picture = await this.source.picture(row.path, isScreenshot(row.path) ? media.screenshot : media.photo, media.minSide);
    if (!picture) {
      await this.save(row, [], { note: "too small or unreadable: searched by name" }, null, true);
      return;
    }
    const segments = await this.embed([{ kind: "image", text: null, picture, body: "", loc: null }]);
    if (segments) await this.save(row, segments, { width: picture.width, height: picture.height }, null, true);
  }

  /** A recording: its sound in windows, ten minutes a step (five on a processor). */
  private async readAudio(row: FileRow): Promise<void> {
    const missing = this.missing("audio");
    if (missing.length) return this.byName(row, missing);
    const media = this.media();
    const samples = await this.source.sound(row.path, this.abort.signal);
    if (!samples) {
      await this.save(row, [], { note: "sound unreadable or over the browser's safety limits (32 MB / 20 min / 128 MB decoded): searched by name" }, null, true);
      return;
    }
    const duration = samples.length / 16000;
    let start = row.next ?? 0;
    while (start < duration && !this.stopped) {
      const stop = start + media.step;
      const pieces: Piece[] = windows(samples, start, stop, media.window, media.hop)
        .map((w) => ({ kind: "audio", text: null, sound: w.samples, body: "", loc: w.start, locEnd: w.end }));
      const segments = await this.embed(pieces);
      if (!segments) return;
      if (!(await this.save(row, segments, { duration: Math.round(duration * 10) / 10 }, stop < duration ? stop : null, start === 0))) return;
      start = stop;
    }
  }

  /** A video: a frame every few seconds, one a shot (as Dowse keeps them), and its sound, ten minutes a step. */
  private async readVideo(row: FileRow): Promise<void> {
    const parts = this.options.parts();
    if (!parts.image && !parts.audio) return this.byName(row, ["image", "audio"]);
    const media = this.media();
    const video = await this.source.video(row.path, this.abort.signal);
    if (!video) {
      await this.save(row, [], { note: "a video Dowse can't play: searched by name" }, null, true);
      return;
    }
    try {
      const samples = parts.audio ? await this.source.sound(row.path, this.abort.signal) : null;
      const duration = video.duration;
      let start = row.next ?? 0;
      let lastHash: bigint | null = start && typeof row.info.frameHash === "string" ? BigInt(row.info.frameHash) : null;
      while (start < duration && !this.stopped) {
        const stop = start + media.step;
        const pieces: Piece[] = [];
        if (parts.image) {
          for (const frame of await video.frames(frameTimes(duration, media.frameInterval, media.maxFrames, start, stop), media.frame)) {
            const hash = averageHash(frame.grey);
            if (sameShot(lastHash, hash)) continue;   // the same shot: the frame kept before stands for it
            lastHash = hash;
            pieces.push({ kind: "frame", text: null, picture: frame.picture, body: "", loc: frame.time });
          }
        }
        if (samples) {
          for (const w of windows(samples, start, stop, media.window, media.hop)) {
            pieces.push({ kind: "audio", text: null, sound: w.samples, body: "", loc: w.start, locEnd: w.end });
          }
        }
        const segments = await this.embed(pieces);
        if (!segments) return;
        const missing = NEEDS.video.filter((part) => !parts[part]);
        const info = { duration: Math.round(duration * 10) / 10, ...(lastHash !== null ? { frameHash: lastHash.toString() } : {}),
                       ...(missing.length ? { waitingFor: missing } : {}) };
        if (!(await this.save(row, segments, info, stop < duration ? stop : null, start === 0))) return;
        start = stop;
      }
    } finally {
      video.close();
    }
  }

  /** The pieces' vectors, a piece at a time (a GPU reads no faster in batches; one at a time lets you go first). */
  private async embed(pieces: Piece[]): Promise<SegmentRow[] | null> {
    const out: SegmentRow[] = [];
    for (const piece of pieces) {
      await this.pause();
      if (this.stopped) return null;
      let vector: ArrayBuffer | null = null;
      const modality = modalityOf(piece);
      if (modality !== "none") {
        let model: Embedder;
        {
          const asked = performance.now();   // (loading the model isn't reading this file)
          try {
            model = await this.options.embed();
          } catch (error) {
            if (error instanceof Cancelled) throw error;
            throw new ModelMissing(error instanceof Error ? error.message : String(error));
          } finally {
            this.waited += performance.now() - asked;
          }
        }
        const [made] = piece.text !== null ? await model.texts([piece.text])
          : piece.picture ? await model.images([piece.picture]) : await model.audio([piece.sound!]);
        vector = toHalf(made);
      }
      out.push({ path: "", kind: piece.kind, modality, loc: piece.loc, locEnd: piece.locEnd ?? null, body: piece.body, vector });
    }
    return out;
  }

  /** Saves a step, unless the file changed meanwhile (then it's read again from the start). */
  private async save(row: FileRow, segments: SegmentRow[], info: Record<string, unknown>, next: number | null,
                     restart: boolean): Promise<boolean> {
    const latest = await this.store.file(row.path);
    if (!latest || latest.mtime !== row.mtime || latest.size !== row.size) return false;
    const kept = Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined));
    const saved: FileRow = { ...row, info: kept, next, state: next === null ? "done" : "pending", reader: READERS[row.kind] };
    delete saved.detail;
    if (!(await this.store.saveStep(saved, segments, restart, row))) return false;
    Object.assign(row, saved);
    this.options.onSaved?.(row.path);
    return true;
  }
}
