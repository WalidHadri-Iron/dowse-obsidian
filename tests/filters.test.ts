import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateRange, filtersFor, inFolders, meetsFilters } from "../src/plugin/filters.ts";
import { Store } from "../src/engine/store.ts";
import { VaultSearch } from "../src/plugin/search.ts";
import { LocalCatalog } from "../src/engine/search/catalog.ts";

test("folder and date constraints are visible, removable, and use local inclusive calendar dates", () => {
  const filters = filtersFor("photos from last month", { now: new Date(2026, 10, 2).getTime(), within: ["Trips", "Family"] });
  assert.deepEqual(filters.kinds, ["image"]);
  assert.equal(filters.inferredKinds, true); assert.equal(filters.inferredDate, true);
  assert.equal(filters.date!.from, "2026-10-01");
  assert.equal(filtersFor("photos from last month", { inferDate: false, inferKinds: false }).date, null);
  assert.deepEqual(filtersFor("photos from last month", { inferKinds: false }).kinds, []);
  const span = dateRange("2026-10-01", "2026-10-03")!;
  assert.equal(span.end, new Date(2026, 9, 4).getTime());
  assert.equal(dateRange("2026-02-30", ""), null);
  assert.equal(dateRange("2026-10-04", "2026-10-03"), null);
  assert.ok(dateRange("", "1960-01-01"), "an open-ended range includes historical dates");
  assert.equal(inFolders("Trips2/a.md", ["Trips"]), false);
  assert.equal(inFolders("Root.md", ["/"]), true);
  assert.equal(inFolders("Trips/a.md", ["/"]), false);
  assert.equal(meetsFilters({ path: "Trips/a.png", kind: "image", mtime: new Date(2026, 9, 2).getTime() }, { ...filters, date: span }), true);
});

test("screenshot queries find images recognized as screenshots without leaking other images", async () => {
  const store = await Store.open("screenshot-filter", "test");
  for (const path of ["Screenshots/budget.png", "Photos/budget.png"]) await store.putFile({ path, kind: "image", mtime: 1,
    size: 1, state: "done", next: null, reader: 1, info: {} });
  const search = new VaultSearch(store, { ready: () => null, wake: () => {} }, () => true);
  assert.deepEqual((await search.search("screenshots budget", {}, false)).hits.map(h => h.path), ["Screenshots/budget.png"]);
  assert.equal((await search.search("screenshots budget", { inferKinds: false }, false)).hits.length, 2);
  search.close(); store.close();
});

test("exclusions gate cached hits, similar results and every recent file immediately", async () => {
  const store = await Store.open("immediate-exclusion", "test");
  for (let i = 0; i < 180; i++) await store.putFile({ path: `${i % 2 ? "Public" : "Private"}/budget-${i}.md`, kind: "note",
    mtime: i, size: 1, state: "done", next: null, reader: 1, info: {} });
  let off = false;
  const search = new VaultSearch(store, { ready: () => null, wake: () => {} }, path => !off || !path.startsWith("Private/"));
  assert.equal((await search.recent()).length, 180, "the full collection, beyond the former 160-file cap");
  assert.ok((await search.search("budget", {}, false)).hits.some(h => h.path.startsWith("Private/")));
  off = true; search.changed();
  assert.ok((await search.search("budget", {}, false)).hits.every(h => !h.path.startsWith("Private/")));
  assert.equal((await search.recent()).length, 90);
  assert.equal((await search.similar("Private/budget-0.md")).hits.length, 0);
  const filtered = await search.search("", { within: ["Public"] }, false);
  assert.equal(filtered.hits.length, 90, "filter-only browsing isn't capped at 60");
  assert.equal(filtered.strong, 90, "files satisfying explicit filters are not labelled uncertain semantic candidates");
  search.close(); store.close();
});

test("an urgent change during an in-flight empty build cannot publish a stale empty collection", async () => {
  const store = await Store.open("build-invalidation", "test");
  const backend = new LocalCatalog(store), build = backend.build.bind(backend);
  let entered!: () => void, release!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  backend.build = async (...args) => { if (++calls === 1) { entered(); await gate; } return build(...args); };
  const search = new VaultSearch(store, { ready: () => null, wake: () => {} }, () => true, backend);
  const recent = search.recent(); await started;
  await store.putFile({ path: "New.md", kind: "note", mtime: 1, size: 1, state: "done", info: {}, next: null, reader: 1 });
  search.changed(true); release();
  assert.deepEqual((await recent).map(file => file.path), ["New.md"]);
  assert.equal(calls, 2);
  search.close(); store.close();
});

test("switching Explore grouping preserves search results and folder maps refresh without waking the model", async () => {
  const store = await Store.open("folder-grouping", "test");
  for (const path of ["Root.md", "Work/budget.md", "Private/budget.md"]) await store.putFile({ path, kind: "note",
    mtime: 1, size: 1, state: "done", next: null, reader: 1, info: {} });
  let wakes = 0, off = false;
  const search = new VaultSearch(store, { ready: () => null, wake: () => { wakes++; } }, path => !off || !path.startsWith("Private/"));
  const folders = await search.explore("folder");
  assert.equal(folders.total, 3);
  assert.equal(wakes, 0, "folder grouping does not need the model");
  assert.equal(await search.explore("folder"), folders, "cached independently of the content map");
  const before = await search.search("budget", {}, false);
  assert.equal((await search.explore("content")).total, 0, "content mode still requires embeddings");
  assert.equal(await search.explore("folder"), folders, "content mode cannot overwrite the folder map");
  const after = await search.search("budget", {}, false);
  assert.deepEqual(after.hits, before.hits);
  assert.equal(after.strong, before.strong);
  off = true;
  assert.equal((await search.explore("folder")).total, 2, "exclusions hide immediately from cached maps");
  await store.putFile({ path: "New/budget.md", kind: "note", mtime: 2, size: 1, state: "done", next: null, reader: 1, info: {} });
  search.changed(true);
  const updated = await search.explore("folder");
  assert.deepEqual(updated.membership["folder:New"], ["New/budget.md"]);
  assert.equal(updated.total, 3);
  search.close(); store.close();
});
