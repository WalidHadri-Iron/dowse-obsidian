/** Debounce by path, never by a stale TFile object. Mutations are ordered, including folder renames/deletions. */
import { after } from "../engine/timers.ts";

export class FileEvents {
  private timers = new Map<string, () => void>();
  private tail = Promise.resolve();
  private closed = false;
  private apply: (path: string) => Promise<void>;
  private report: (error: unknown) => void;
  private ms: number;
  constructor(apply: (path: string) => Promise<void>, report: (error: unknown) => void, ms = 2000) {
    this.apply = apply; this.report = report; this.ms = ms;
  }

  queue(path: string): void {
    if (this.closed) return;
    this.cancel(path, false);
    this.timers.set(path, after(() => {
      this.timers.delete(path);
      void this.order(() => this.apply(path));
    }, this.ms));
  }

  cancel(path: string, recursive = true): void {
    this.timers.get(path)?.(); this.timers.delete(path);
    if (!recursive) return;
    for (const [key, timer] of this.timers) if (key === path || key.startsWith(path + "/")) {
      timer(); this.timers.delete(key);
    }
  }

  order(change: () => Promise<void>): Promise<void> {
    this.tail = this.tail.then(async () => { if (!this.closed) await change(); }).catch(this.report);
    return this.tail;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clear();
    await this.tail;
  }

  clear(): void {
    for (const timer of this.timers.values()) timer();
    this.timers.clear();
  }
  async settled(): Promise<void> { await this.tail; }
}
