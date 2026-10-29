// Searching the vault's index: what's turned off isn't found, nor on Explore's floor (its index is kept).
import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, toHalf, type FileRow } from "../src/engine/store.ts";
import { VaultSearch } from "../src/plugin/search.ts";

const vector = (seed: number) => Array.from({ length: 768 }, (_, i) => Math.sin(seed * 31 + i * 0.7));

test("a folder turned off is searched no more and leaves the map at once; turned back on, it's found again", async () => {
  const store = await Store.open("search-test", "test-model");
  const notes = ["Money/Budget.md", "Money/Taxes.md", "Private/Diary.md", "Private/Budget ideas.md", "Trips/Lisbon.md", "Trips/Kyoto.md"];
  for (const [i, path] of notes.entries()) {
    const row: FileRow = { path, kind: "note", mtime: i + 1, size: 10, state: "done", info: {}, next: null, reader: 1 };
    await store.saveStep(row, [{ path, kind: "passage", modality: "text", loc: 0, locEnd: 1,
                                body: `${path} budget notes`, vector: toHalf(vector(i)) }], true);
  }
  let off: string[] = [];
  const search = new VaultSearch(store, { ready: () => null, wake: () => {} },
                                 (path) => !off.some((o) => path === o || path.startsWith(o + "/")));
  const found = async () => (await search.search("budget", {}, false)).hits.map((h) => h.path).sort();
  const mapped = async () => (await search.explore()).pieces.map((p) => p.path).sort();

  assert.ok((await found()).includes("Private/Budget ideas.md"));
  assert.equal((await mapped()).length, notes.length);
  off = ["Private"];
  search.changed();
  await new Promise((resolve) => setTimeout(resolve, 3100));   // (a searcher is rebuilt at most every few seconds)
  assert.ok(!(await found()).some((p) => p.startsWith("Private/")));
  assert.ok(!(await mapped()).some((p) => p.startsWith("Private/")));
  assert.equal((await search.recent()).filter((s) => s.path.startsWith("Private/")).length, 0);
  assert.equal((await store.files()).length, notes.length, "its index is kept");
  off = [];
  search.changed();
  await new Promise((resolve) => setTimeout(resolve, 3100));
  assert.ok((await found()).includes("Private/Budget ideas.md"));
  store.close();
});
