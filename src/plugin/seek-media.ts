import { cancelled, mediaEvent } from "./media-limits.ts";

/** Wait for the native player's seek to finish, including a player whose metadata is still arriving. */
export async function seekMedia(media: HTMLMediaElement, seconds: number, signal?: AbortSignal): Promise<number> {
  cancelled(signal);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid media timestamp");
  if (media.readyState < 1) await mediaEvent(media, "loadedmetadata", signal);
  cancelled(signal);
  const target = Math.min(seconds, Number.isFinite(media.duration) ? Math.max(0, media.duration - .01) : seconds);
  if (Math.abs(media.currentTime - target) > .05 || media.seeking) {
    const seeking = new AbortController(), abort = () => seeking.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const done = mediaEvent(media, "seeked", seeking.signal, 5000);
    try { media.currentTime = target; await done; }
    catch (error) { seeking.abort(); await done.catch(() => {}); throw error; }
    finally { signal?.removeEventListener("abort", abort); }
  }
  cancelled(signal);
  if (Math.abs(media.currentTime - target) > .25) throw new Error("The player did not reach the requested timestamp");
  return target;
}
