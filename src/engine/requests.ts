import { after } from "./timers.ts";
import { Cancelled } from "./cancel.ts";

/** A terminated worker cannot accept work; every accepted request has a bounded lifetime. */
export class Requests {
  private next = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void;
    timer: () => void; timeout: number }>();
  closed = false;
  onFailure: ((error: Error) => void) | null = null;
  private failure: Error | null = null;

  ask<T>(send: (id: number) => void, timeout = 5 * 60_000): Promise<T> {
    if (this.closed) return Promise.reject(this.failure ?? new Cancelled());
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = after(() => this.fail(new Cancelled("The model stopped responding. Try again or choose the processor in Dowse settings.")), timeout);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer, timeout });   // (T: what the worker answers to this request)
      try { send(id); }
      catch (error) {
        timer(); this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  touch(): void {
    for (const item of this.pending.values()) {
      item.timer();
      item.timer = after(() => this.fail(new Cancelled("The model download stopped responding. Try again.")), item.timeout);
    }
  }

  answer(id: number, value: unknown, error?: string): void {
    const item = this.pending.get(id);
    if (!item) return;
    this.pending.delete(id); item.timer();
    if (error) item.reject(new Error(error)); else item.resolve(value);
  }

  fail(error: Error = new Cancelled()): void {
    const wasClosed = this.closed;
    this.failure ??= error;
    this.closed = true;
    for (const item of this.pending.values()) { item.timer(); item.reject(this.failure); }
    this.pending.clear();
    if (!wasClosed) this.onFailure?.(this.failure);
  }
}
