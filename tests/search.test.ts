// Searching the vault's index: what's turned off isn't found, nor on Explore's floor (its index is kept); what the views
// show is made again in the background while one is open, and only then.
import "fake-indexeddb/auto";
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { Store, toHalf, type FileRow } from "../src/engine/store.ts";
import { FOLLOW_MS, MAP_REFRESH_MS, REFRESH_MS, VaultSearch } from "../src/plugin/search.ts";

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
  search.changed(true);   // a selection change bypasses the ordinary indexing throttle
  assert.ok(!(await found()).some((p) => p.startsWith("Private/")));
  assert.ok(!(await mapped()).some((p) => p.startsWith("Private/")));
  assert.equal((await search.recent()).filter((s) => s.path.startsWith("Private/")).length, 0);
  assert.equal((await store.files()).length, notes.length, "its index is kept");
  off = [];
  search.changed(true);
  assert.ok((await found()).includes("Private/Budget ideas.md"));
  store.close();
});

test("while a view is open, the files and the map are made again after reading changed something, the map at most every 30 s", async () => {
  const store = await Store.open("follow-test", "test-model");
  const add = async (i: number) => {
    const path = `Note ${i}.md`;
    const row: FileRow = { path, kind: "note", mtime: i + 1, size: 10, state: "done", info: {}, next: null, reader: 1 };
    await store.saveStep(row, [{ path, kind: "passage", modality: "text", loc: 0, locEnd: 1, body: `note ${i}`,
                                 vector: toHalf(vector(i)) }], true);
  };
  for (let i = 0; i < 6; i++) await add(i);
  const search = new VaultSearch(store, { ready: () => null, wake: () => {} }, () => true);
  let open = false, made = 0;
  search.follow({ wanted: () => open, made: () => made++ });
  const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve)); };
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  try {
    assert.equal((await search.explore()).total, 6);
    made = 0;
    await add(6);
    search.changed();   // no view open: nothing is made
    mock.timers.tick(FOLLOW_MS);
    await settle();
    assert.equal(made, 0);

    open = true;
    search.changed();
    mock.timers.tick(FOLLOW_MS);
    await settle();
    assert.equal(made, 1, "the files, made again");
    assert.equal((await search.recent()).length, 7);
    assert.equal((await search.explore()).total, 6, "the map waits its 30 s (the last one is shown meanwhile)");
    mock.timers.tick(MAP_REFRESH_MS);
    await settle();
    assert.equal(made, 2, "then the map");
    assert.equal((await search.explore()).total, 7);
    mock.timers.tick(MAP_REFRESH_MS * 3);
    await settle();
    assert.equal(made, 2, "nothing changed: nothing made, nothing polled");
  } finally {
    mock.timers.reset();
    search.close();
    store.close();
  }
});
