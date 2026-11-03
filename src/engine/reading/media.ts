// Pictures and sound as Dowse reads them (its `embedder.target_size`, `rules.is_screenshot`, `reading.Options`,
// `media.sound`, `media.average_hash`): an image sized to fill its token budget, a screenshot given more of them, sound
// cut into overlapping short windows on a fixed grid (silence skipped), a video's frames kept one per shot.

export const RATE = 16000;   // the model's audio: mono, 16 kHz
const SILENCE = 0.003;       // RMS ≈ −50 dBFS: silence isn't worth a vector

/** How files are read: a GPU gets bigger pictures and more frames; a processor (~15× slower) fewer, smaller ones. */
export interface MediaOptions {
  photo: number;          // vision token budgets
  screenshot: number;
  page: number;
  frame: number;
  minSide: number;        // a smaller image is searched by name
  frameInterval: number;  // seconds between video frames at least
  maxFrames: number;      // a video's frames at most (longer ones space them out)
  window: number;         // the model hears at most 30 s of one input
  hop: number;
  step: number;           // seconds of a recording or video read per step (a multiple of `hop`)
}

export function mediaOptions(gpu: boolean): MediaOptions {
  return gpu
    ? { photo: 140, screenshot: 280, page: 280, frame: 70, minSide: 256, frameInterval: 3, maxFrames: 1200, window: 8, hop: 4, step: 600 }
    : { photo: 70, screenshot: 140, page: 140, frame: 70, minSide: 256, frameInterval: 3, maxFrames: 400, window: 12, hop: 6, step: 300 };
}

const SCREENSHOT_PREFIXES = ["screenshot", "screen shot", "capture", "snip", "cleanshot", "scr-", "sharex",
  "bildschirmfoto", "captura de", "schermata", "schermafbeelding", "skärmavbild", "zrzut ekranu", "ekran resmi",
  "снимок экрана", "スクリーンショット", "스크린샷", "截屏", "屏幕快照", "螢幕截圖"];
const SCREENSHOT_FOLDERS = new Set(["screenshots", "screen captures"]);

export function isScreenshot(path: string): boolean {
  const parts = path.split("/");
  const name = (parts.pop() ?? "").toLowerCase();
  return SCREENSHOT_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
    SCREENSHOT_FOLDERS.has((parts.pop() ?? "").toLowerCase());
}

/** Fill `budget` soft tokens (each 3 × 3 patches of 16 px) keeping the aspect ratio, each side rounded down to a
 * multiple of 48 px; null when the image is too thin to hold a single token. [height, width]. */
export function targetSize(height: number, width: number, budget: number): [number, number] | null {
  const patch = 16, pooling = 3;
  const maxPatches = budget * pooling * pooling;
  const factor = Math.sqrt((maxPatches * patch * patch) / (height * width));
  const side = pooling * patch;
  let h = Math.floor((factor * height) / side) * side;
  let w = Math.floor((factor * width) / side) * side;
  if (h === 0 && w === 0) return null;
  const maxSide = Math.floor(maxPatches / (pooling * pooling)) * side;
  if (h === 0) [h, w] = [side, Math.min(Math.floor(width / height) * side, maxSide)];
  else if (w === 0) [w, h] = [side, Math.min(Math.floor(height / width) * side, maxSide)];
  return [h, w];
}

function silent(samples: Float32Array): boolean {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / Math.max(samples.length, 1)) <= SILENCE;
}

export interface Window { start: number; end: number; samples: Float32Array }

/** `samples` (the whole recording, mono 16 kHz) from `start` to `until` seconds as windows on the fixed grid
 * (k × hop, so a resumed read gives the same windows), silent ones skipped; the tail, if it's at least `minimum`
 * seconds past the last window's overlap (or all of a recording shorter than a window). */
export function windows(samples: Float32Array, start: number, until: number, window = 30, hop = 25, minimum = 2): Window[] {
  const windowN = window * RATE, hopN = hop * RATE;
  const out: Window[] = [];
  let offset = Math.round(start * RATE);
  const stop = Math.min(Math.round(until * RATE), samples.length);
  while (offset + windowN <= samples.length && offset < stop) {
    const piece = samples.subarray(offset, offset + windowN);
    if (!silent(piece)) out.push({ start: offset / RATE, end: (offset + windowN) / RATE, samples: piece.slice() });
    offset += hopN;
  }
  if (offset < stop && offset < samples.length) {   // the tail
    const tail = samples.subarray(offset);
    const covered = offset === 0 ? 0 : windowN - hopN;
    if (tail.length - covered >= minimum * RATE && !silent(tail)) {
      out.push({ start: offset / RATE, end: samples.length / RATE, samples: tail.slice() });
    }
  }
  return out;
}

/** 8×8 average hash of a picture's grey levels (64 values, row by row): frames of one shot differ in a few bits. */
export function averageHash(grey: ArrayLike<number>): bigint {
  let mean = 0;
  for (let i = 0; i < 64; i++) mean += grey[i] / 64;
  let hash = 0n;
  for (let i = 0; i < 64; i++) if (grey[i] > mean) hash |= 1n << BigInt(i);
  return hash;
}

export function sameShot(a: bigint | null, b: bigint): boolean {
  if (a === null) return false;
  let x = a ^ b, bits = 0;
  while (x) { bits += Number(x & 1n); x >>= 1n; }
  return bits <= 4;
}

/** When a video's frames are looked at: every `interval` seconds, spaced out so there are at most `most`. */
export function frameTimes(duration: number, interval: number, most: number, from = 0, until = duration): number[] {
  const spacing = Math.max(interval, duration / most);
  const out: number[] = [];
  for (let t = Math.ceil(from / spacing) * spacing; t < Math.min(until, duration); t += spacing) out.push(Math.round(t * 1000) / 1000);
  return out;
}
