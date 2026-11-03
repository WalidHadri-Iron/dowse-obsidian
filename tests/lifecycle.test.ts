import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, isOn, renamed, turnOff, turnOn } from "../src/plugin/settings.ts";
import { FileEvents } from "../src/plugin/file-events.ts";
import { Requests } from "../src/engine/requests.ts";
import { Cancelled } from "../src/engine/cancel.ts";
import { Indexer, type Source } from "../src/engine/indexer.ts";
import { Store } from "../src/engine/store.ts";
import { runtimeProblem } from "../src/plugin/compat.ts";
import { mediaEvent, abortable, checkSound, SOUND_DECODED_BYTES } from "../src/plugin/media-limits.ts";

const delay = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

test("explicit and inherited exclusions follow renamed files and folders", () => {
  let s = turnOff(DEFAULTS, "Private");
  s = turnOff(s, "Private/Diary.md");
  s = renamed(s, "Private", "Archive");
  assert.equal(isOn(s, "Archive/Diary.md"), false);
  s = turnOn(s, "Archive");
  assert.equal(isOn(s, "Archive/Diary.md"), false, "a child's own suspension survives its parent");
  const moved = renamed(turnOff(DEFAULTS, "Private"), "Private/Note.md", "Public/Note.md");
  assert.equal(isOn(moved, "Public/Note.md"), false, "moving out cannot silently enable an excluded file");
  assert.equal(isOn(renamed(DEFAULTS, "Public/Note.md", "Other/Note.md"), "Other/Note.md"), true);
});

test("debounced edits are cancelled for deleted folders and resolve renamed paths afresh", async () => {
  const files = new Set(["Private/a.md", "Other/b.md"]), applied: string[] = [];
  const events = new FileEvents(async path => { if (files.has(path)) applied.push(path); }, error => assert.fail(String(error)), 5);
  events.queue("Private/a.md"); events.queue("Other/b.md"); events.cancel("Private");
  files.delete("Private/a.md");
  await delay(20);
  assert.deepEqual(applied, ["Other/b.md"]);
  events.queue("Other/b.md"); files.delete("Other/b.md"); await delay(20);
  assert.deepEqual(applied, ["Other/b.md"], "a stale object is never reused after deletion");
  await events.close();
});

test("worker cancellation rejects current and future requests and times out silent workers", async () => {
  const requests = new Requests();
  const pending = requests.ask(() => {});
  const rejected = assert.rejects(pending, Cancelled);
  requests.fail(); await rejected;
  let posted = false;
  await assert.rejects(requests.ask(() => { posted = true; }), Cancelled);
  assert.equal(posted, false);
  const silent = new Requests();
  let terminated = 0;
  silent.onFailure = () => { terminated++; };
  await assert.rejects(silent.ask(() => {}, 5), /stopped responding/);
  assert.equal(silent.closed, true);
  silent.fail(); assert.equal(terminated, 1, "failed or timed-out workers are disposed exactly once");
  const reusable = new Requests();
  await assert.rejects(reusable.ask(() => { throw new Error("uncloneable request"); }), /uncloneable/);
  let id = 0;
  const good = reusable.ask(value => { id = value; }); reusable.answer(id, "ok");
  assert.equal(await good, "ok", "a bad request does not poison a healthy worker");
});

test("stopping during an asynchronous empty scan cannot lose its wakeup", async () => {
  const store = await Store.open("stop-race", "test");
  let reading!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { reading = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const files = store.files.bind(store);
  store.files = async () => { reading(); await held; return files(); };
  const indexer = new Indexer(store, { list: () => [] } as unknown as Source, {
    active: () => true, parts: () => ({ image: false, audio: false }), embed: async () => { throw new Error("unused"); },
  });
  const run = indexer.run(); await entered; indexer.stop(); release();
  await Promise.race([run, delay(100).then(() => { throw new Error("stop hung"); })]);
  assert.equal(indexer.status.state, "stopped");
  await indexer.join(); store.close();
});

test("cancelling an in-flight embedding leaves a changed file pending and retryable", async () => {
  const store = await Store.open("embedding-cancel", "test");
  await store.putFile({ path: "Note.md", kind: "note", mtime: 1, size: 1, state: "done", info: {}, next: null, reader: 1 });
  let attempted!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { attempted = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const source = { list: () => [{ path: "Note.md", mtime: 2, size: 30 }], text: async () => "A changed note about travel." } as unknown as Source;
  const indexer = new Indexer(store, source, { active: () => true, parts: () => ({ image: false, audio: false }),
    embed: async () => ({ texts: async () => { attempted(); await held; throw new Cancelled(); }, images: async () => [], audio: async () => [] }) });
  await indexer.sync(); const run = indexer.run(); await entered; indexer.stop(); release(); await run;
  assert.equal((await store.file("Note.md"))!.state, "pending");
  assert.equal(indexer.status.failed, 0); store.close();
});

test("runtime compatibility is checked independently of the Obsidian app version", () => {
  assert.equal(runtimeProblem({ half: true, worker: true, canvas: true, storage: true }), null);
  assert.match(runtimeProblem({ half: false, worker: true, canvas: true, storage: true })!, /reinstall/);
});

test("a delayed writer cannot resurrect a deleted file or overwrite a newer file revision", async () => {
  const store = await Store.open("save-revision", "test");
  const old = { path: "Note.md", kind: "note" as const, mtime: 1, size: 10, state: "done" as const, info: {}, next: null, reader: 1 };
  await store.putFile({ ...old, mtime: 2 });
  assert.equal(await store.saveStep(old, [], true, old), false);
  assert.equal((await store.file(old.path))!.mtime, 2);
  await store.remove(old.path);
  assert.equal(await store.saveStep(old, [], true, old), false);
  assert.equal(await store.file(old.path), undefined);
  for (const path of ["Folder/a.md", "Folder/Sub/b.md", "Folder2/c.md"]) {
    await store.saveStep({ ...old, path }, [{ path, kind: "passage", modality: "none", loc: 0, locEnd: 0, body: path, vector: null }], true);
  }
  assert.equal((await store.filesWithin("Folder")).length, 2);
  await store.removeTree("Folder");
  assert.deepEqual((await store.files()).map(row => row.path), ["Folder2/c.md"]);
  assert.deepEqual((await store.segments()).map(row => row.path), ["Folder2/c.md"]);
  store.close();
});

test("browser media limits reject long recordings and waiting media can be cancelled or timed out", async () => {
  assert.equal(checkSound(1000, 10), true);
  assert.equal(checkSound(1000, 3600), false);
  assert.equal(checkSound(1000, Infinity), false);
  assert.equal(checkSound(40 * 1024 * 1024, 10), false);
  assert.equal(SOUND_DECODED_BYTES, 128 * 1024 * 1024);
  const target = new EventTarget(), abort = new AbortController();
  const waiting = mediaEvent(target, "ready", abort.signal);
  const rejected = assert.rejects(waiting, Cancelled); abort.abort(); await rejected;
  await assert.rejects(mediaEvent(target, "ready", undefined, 5), /too long/);
  const stopped = new AbortController(); stopped.abort();
  assert.throws(() => abortable(Promise.resolve(1), stopped.signal), Cancelled);
});
