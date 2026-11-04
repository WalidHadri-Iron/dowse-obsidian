import { after } from "../engine/timers.ts";
import { Cancelled } from "../engine/cancel.ts";

// Browser decoders consume a complete recording. Larger inputs remain searchable by name, never decoded blindly.
export const SOUND_FILE_BYTES = 32 * 1024 * 1024;
export const SOUND_SECONDS = 20 * 60;
export const SOUND_DECODED_BYTES = 128 * 1024 * 1024;

export function checkSound(bytes: number, seconds: number): boolean {
  return bytes <= SOUND_FILE_BYTES && seconds > 0 && Number.isFinite(seconds) && seconds <= SOUND_SECONDS;
}

export function cancelled(signal?: AbortSignal): void { if (signal?.aborted) throw new Cancelled("Reading was stopped"); }

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  cancelled(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new Cancelled("Reading was stopped")); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error instanceof Error ? error : new Error(String(error))); });
  });
}

export function mediaEvent(target: EventTarget, success: string, signal?: AbortSignal, ms = 20000): Promise<void> {
  cancelled(signal);
  return new Promise((resolve, reject) => {
    const clear = () => {
      timer?.(); target.removeEventListener(success, ready); target.removeEventListener("error", failed);
      signal?.removeEventListener("abort", abort);
    };
    const ready = () => { clear(); resolve(); };
    const failed = () => { clear(); reject(new Error("This media could not be loaded")); };
    const abort = () => { clear(); reject(new Cancelled("Reading was stopped")); };
    const timer = after(() => { clear(); reject(new Error("The media preview took too long to load")); }, ms);
    target.addEventListener(success, ready); target.addEventListener("error", failed);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
