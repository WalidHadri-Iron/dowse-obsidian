// The room Dowse takes on this computer: the model's files, downloaded once into Obsidian's cache (where transformers.js
// keeps them, shared by every vault) and kept there until removed, even when the plugin is: Settings › Dowse shows them
// and can remove them.

import { MODEL_REPO } from "../engine/protocol.ts";

const CACHES = ["transformers-cache", "experimental_transformers-hash-cache"];

function ours(request: Request): boolean {
  return request.url.includes(`/${MODEL_REPO}/`);
}

async function each(visit: (cache: Cache, request: Request) => Promise<void>): Promise<void> {
  if (typeof caches === "undefined") return;
  for (const name of CACHES) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) if (ours(request)) await visit(cache, request);
  }
}

/** The model's files on this computer, in bytes. */
export async function modelBytes(): Promise<number> {
  let bytes = 0;
  await each(async (cache, request) => {
    const response = await cache.match(request);
    const length = Number(response?.headers.get("content-length"));
    bytes += Number.isFinite(length) && length > 0 ? length : (await response?.blob())?.size ?? 0;
  });
  return bytes;
}

/** Removes the model's files from this computer (only the model's: not other plugins' caches); answers the bytes. */
export async function removeModel(): Promise<number> {
  const bytes = await modelBytes();
  await each(async (cache, request) => { await cache.delete(request); });
  return bytes;
}

/** "542 MB", "1.4 GB". */
export function sizeText(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
