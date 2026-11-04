// Work done a few at a time, the most wanted first. Pictures that take work (a PDF's page, a note's page, a video's
// still) go through one: the wall asks for a picture of every file at once (789 in the demo vault, 271 of them PDFs),
// and started together they held Obsidian's main thread for 15 s, a note opened meanwhile included, while the search's
// own matches waited behind them. Larger pictures are asked for what's looked at (a match, a file close up), so they go
// first; among equals, the first asked.

interface Job {
  priority: number;
  order: number;
  start: () => void;
  cancel: (error: Error) => void;
}

export class Lane {
  private readonly width: number;
  private running = 0;
  private order = 0;
  private waiting: Job[] = [];

  /** `width`: how many run at once. */
  constructor(width: number) {
    this.width = width;
  }

  /** Runs `work` when its turn comes: the highest `priority` waiting first, then the first asked. */
  run<T>(priority: number, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running++;
        let done: Promise<T>;
        try { done = work(); } catch (error) { done = Promise.reject(error instanceof Error ? error : new Error(String(error))); }
        void done.then(resolve, reject).finally(() => { this.running--; this.next(); });
      };
      this.waiting.push({ priority, order: this.order++, start, cancel: reject });
      this.next();
    });
  }

  /** What hasn't started is dropped (rejected); what runs finishes. */
  clear(): void {
    for (const job of this.waiting.splice(0)) job.cancel(new Error("cancelled"));
  }

  get pending(): number {
    return this.waiting.length;
  }

  private next(): void {
    while (this.running < this.width && this.waiting.length) {
      let best = 0;
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i], b = this.waiting[best];
        if (a.priority > b.priority || (a.priority === b.priority && a.order < b.order)) best = i;
      }
      const [job] = this.waiting.splice(best, 1);
      job.start();
    }
  }
}
