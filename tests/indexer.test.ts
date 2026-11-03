import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Indexer, type Pdf, type Source, type VaultFile } from "../src/engine/indexer.ts";
import type { Parts } from "../src/engine/protocol.ts";
import { Store } from "../src/engine/store.ts";

let databases = 0;

const picture = { rgba: new ArrayBuffer(4 * 48 * 48), width: 48, height: 48, budget: 70 };

/** A vault in memory: notes by path (a PDF's pages are its text, split at "\f"; images and sound are made up). */
function vault(notes: Record<string, string>) {
  const times: Record<string, number> = {};
  const source: Source & { notes: Record<string, string>; touch(path: string): VaultFile } = {
    notes,
    list: () => Object.keys(notes).map((path) => ({ path, mtime: times[path] ?? 1, size: notes[path].length })),
    text: async (path) => notes[path],
    pdf: async (path) => {
      const pages = notes[path].split("\f");
      return { numPages: pages.length, getMetadata: async () => ({ info: {} }),
               getPage: async (n: number) => ({ getTextContent: async () => ({ items: [{ str: pages[n - 1] }] }) }) } as Pdf;
    },
    picture: async () => picture,
    page: async () => picture,
    sound: async (path) => Float32Array.from({ length: Number(notes[path]) * 16000 }, (_, i) => 0.1 * Math.sin(i / 10)),
    video: async () => null,
    touch(path: string) {
      times[path] = (times[path] ?? 1) + 1;
      return { path, mtime: times[path], size: notes[path].length };
    },
  };
  return source;
}

/** A stand-in for the model: a stable vector per prompt (any vector for a picture or a sound), answering later as
 * the model's worker does, counting what it's asked. */
function model() {
  const asked: string[] = [];
  const later = () => new Promise((resolve) => setTimeout(resolve, 0));
  const vector = (text: string) => {
    const out = new Float32Array(768);
    for (let i = 0; i < text.length; i++) out[(text.charCodeAt(i) * 31 + i) % 768] += 1;
    return out;
  };
  const embedder = {
    texts: async (prompts: string[]) => { await later(); asked.push(...prompts); return prompts.map(vector); },
    images: async (pictures: unknown[]) => { await later(); asked.push(...pictures.map(() => "<picture>")); return pictures.map(() => vector("picture")); },
    audio: async (clips: unknown[]) => { await later(); asked.push(...clips.map(() => "<sound>")); return clips.map(() => vector("sound")); },
  };
  return { asked, embed: async () => embedder };
}

async function setup(notes: Record<string, string>, active = (_: string) => true, parts: Parts = { image: false, audio: false }) {
  const store = await Store.open(`test-${++databases}`, "embeddinggemma-2/fp16");
  const source = vault(notes);
  const fake = model();
  const indexer = new Indexer(store, source, { active, embed: fake.embed, parts: () => parts });
  return { store, source, fake, indexer, parts };
}

async function readAll(indexer: Indexer) {
  const running = indexer.run();
  await indexer.settled();
  indexer.stop();
  await running;
}

test("the vault is read: each note's passages saved with their lines and vectors", async () => {
  const { store, indexer } = await setup({
    "Trips/Lisbon.md": "# Lisbon\nThe yellow tram 28 climbs to Graça.\n## Food\nPastéis de nata at Belém.",
    "Empty.md": "",
    ".obsidian/workspace.json": "{}",
  });
  assert.equal(await indexer.sync(), 2);
  await readAll(indexer);
  const segments = await store.segmentsOf("Trips/Lisbon.md");
  assert.deepEqual(segments.map((s) => [s.body, s.loc, s.locEnd]), [
    ["Lisbon\nThe yellow tram 28 climbs to Graça.", 0, 1], ["Food\nPastéis de nata at Belém.", 2, 3]]);
  assert.equal(new Float16Array(segments[0].vector!).length, 768);
  assert.deepEqual((await store.files()).map((f) => [f.path, f.state]).sort(),
                   [["Empty.md", "done"], ["Trips/Lisbon.md", "done"]]);
});

test("a changed note is read again; a deleted one leaves the index; a renamed one keeps its vectors", async () => {
  const { store, source, fake, indexer } = await setup({ "a.md": "Alpha note about tea.", "b.md": "Beta note about coffee." });
  await indexer.sync();
  await readAll(indexer);
  const before = fake.asked.length;
  source.notes["a.md"] = "Alpha note about green tea.";
  await indexer.changed(source.touch("a.md"));
  await readAll(indexer);
  assert.equal(fake.asked.length, before + 1);
  assert.equal((await store.segmentsOf("a.md"))[0].body, "Alpha note about green tea.");
  await indexer.renamed("b.md", "Drinks/b.md");
  assert.equal((await store.segmentsOf("Drinks/b.md")).length, 1);
  assert.equal(fake.asked.length, before + 1, "nothing read again for a rename");
  await indexer.removed("a.md");
  assert.deepEqual((await store.files()).map((f) => f.path), ["Drinks/b.md"]);
});

test("what's turned off isn't read, and keeps what was read of it", async () => {
  let off = new Set<string>();
  const { store, indexer } = await setup({ "Work/plan.md": "Quarterly plan.", "Home/list.md": "Groceries." },
    (path) => ![...off].some((p) => path === p || path.startsWith(p + "/")));
  off = new Set(["Work"]);
  await indexer.sync();
  await readAll(indexer);
  assert.deepEqual((await store.files()).map((f) => f.path), ["Home/list.md"]);
  off = new Set();
  await indexer.sync();
  await readAll(indexer);
  off = new Set(["Home"]);
  await indexer.sync();
  assert.equal((await store.files()).length, 2, "turned off: kept, not dropped");
});

test("a long note stopped halfway resumes from its last saved step", async () => {
  const long = Array.from({ length: 50 }, (_, i) => `## Part ${i}\n` + `Paragraph ${i} of the long note. `.repeat(8)).join("\n");
  const { store, fake, indexer } = await setup({ "Long.md": long });
  await indexer.sync();
  const running = indexer.run();
  while (fake.asked.length < 45) await new Promise((r) => setTimeout(r, 1));
  indexer.stop();
  await running;
  const saved = await store.file("Long.md");
  assert.deepEqual([saved!.state, saved!.next], ["pending", 40]);
  assert.equal((await store.segmentsOf("Long.md")).length, 40);
  const asked = fake.asked.length;
  await readAll(indexer);
  assert.equal((await store.segmentsOf("Long.md")).length, 50);
  assert.equal(fake.asked.length - asked, 10, "only what wasn't saved is read again");
  assert.equal((await store.file("Long.md"))!.state, "done");
});

test("an index of another model's vectors is cleared", async () => {
  const first = await Store.open("model-change", "embeddinggemma-2/fp16");
  await first.putFile({ path: "x.md", kind: "note", mtime: 1, size: 1, state: "done", info: {}, next: null, reader: 1 });
  first.close();
  const other = await Store.open("model-change", "another-model");
  assert.deepEqual(await other.files(), []);
});

test("an image is searched by name until images are on, then read; a PDF's scans are added without its text read again", async () => {
  const page = "The quarterly report shows the revenue of the shop growing every month this year, with more visitors. ".repeat(3);
  const { store, fake, indexer, parts } = await setup({ "Attachments/tram.jpg": "", "Report.pdf": `${page}\fScan\f${page}` });
  await indexer.sync();
  await readAll(indexer);
  assert.deepEqual((await store.file("Attachments/tram.jpg"))!.info, { waitingFor: ["image"] });
  assert.deepEqual((await store.file("Report.pdf"))!.info.waitingFor, ["image"]);
  assert.equal(fake.asked.filter((a) => a !== "<picture>").length, 2, "the PDF's two pages of text");
  parts.image = true;
  assert.equal(await indexer.sync(), 2, "both wait again");
  await readAll(indexer);
  assert.deepEqual((await store.segmentsOf("Attachments/tram.jpg")).map((s) => [s.kind, s.modality]), [["image", "image"]]);
  assert.deepEqual((await store.segmentsOf("Report.pdf")).map((s) => [s.kind, s.modality, s.loc]),
                   [["page", "text", 1], ["page", "none", 2], ["page", "text", 3], ["page", "image", 2]]);
  assert.equal(fake.asked.filter((a) => a !== "<picture>").length, 2, "the PDF's text wasn't read again");
  assert.equal((await store.file("Report.pdf"))!.info.waitingFor, undefined);
});

test("a recording is read in Dowse's windows once sound is on", async () => {
  const { store, indexer } = await setup({ "Memos/standup.m4a": "70" }, undefined, { image: false, audio: true });
  await indexer.sync();
  await readAll(indexer);
  const segments = await store.segmentsOf("Memos/standup.m4a");
  assert.equal(segments.length, 17);
  assert.deepEqual(segments[0] && [segments[0].kind, segments[0].modality, segments[0].loc, segments[0].locEnd],
    ["audio", "audio", 0, 8]);
  assert.deepEqual(segments.at(-1) && [segments.at(-1)!.loc, segments.at(-1)!.locEnd], [64, 70]);
  assert.ok(segments.every(s => s.locEnd! - s.loc! <= 8), "timing passages are no longer thirty seconds wide");
  assert.equal((await store.file("Memos/standup.m4a"))!.info.duration, 70);
});

test("a model that can't start leaves the files waiting, not failed; tried again, they're read", async () => {
  const store = await Store.open(`test-${++databases}`, "embeddinggemma-2/fp16");
  const fake = model();
  let online = false;
  const indexer = new Indexer(store, vault({ "A.md": "# A\nThe first note.", "B.md": "# B\nThe second note." }), {
    active: () => true, parts: () => ({ image: false, audio: false }),
    embed: async () => { if (!online) throw new Error("no connection"); return fake.embed(); },
  });
  await indexer.sync();
  const running = indexer.run();
  while (indexer.status.state !== "paused") await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(indexer.status.held, "the model couldn't start");
  assert.equal(indexer.status.failed, 0);
  assert.deepEqual((await store.files()).map((f) => f.state), ["pending", "pending"]);
  online = true;
  indexer.resume();   // (as "Try again" does; else in RETRY_MS)
  await indexer.settled();
  indexer.stop();
  await running;
  assert.deepEqual((await store.files()).map((f) => f.state), ["done", "done"]);
  assert.equal(indexer.status.held, undefined, "no longer said to wait for the model");
});

test("paused, nothing is read until it's resumed", async () => {
  const store = await Store.open(`test-${++databases}`, "embeddinggemma-2/fp16");
  const fake = model();
  let held: string | null = "paused";
  const indexer = new Indexer(store, vault({ "A.md": "# A\nA note." }), {
    active: () => true, parts: () => ({ image: false, audio: false }), embed: fake.embed, held: () => held,
  });
  await indexer.sync();
  const running = indexer.run();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(indexer.status.state, "paused");
  assert.equal(fake.asked.length, 0);
  held = null;
  indexer.resume();
  await indexer.settled();
  indexer.stop();
  await running;
  assert.equal((await store.file("A.md"))!.state, "done");
});

test("the time left, from the speed of each kind so far", async () => {
  const { indexer } = await setup({});
  const row = (path: string, kind: string, size: number) =>
    ({ path, kind, size, mtime: 1, state: "pending", info: {}, next: null, reader: 0 }) as any;
  const learn = (indexer as any).learn.bind(indexer);
  learn(row("a.md", "note", 1000), 1);
  learn(row("b.md", "note", 3000), 3);
  assert.equal(indexer.estimate([row("c.md", "note", 2000)]), null, "too little read to tell");
  learn(row("c.png", "image", 50), 2);
  learn(row("d.png", "image", 5_000_000), 2);
  assert.equal(indexer.estimate([row("e.md", "note", 2000)]), 2, "a note: its size at the notes' speed");
  assert.equal(indexer.estimate([row("f.png", "image", 1)]), 2, "an image: an image's time, whatever its size");
  assert.equal(indexer.estimate([row("g.pdf", "pdf", 10)]), 2, "a kind not read yet: the files' mean");
});

test("adding PDF scans renders and saves one page at a time, then resumes without duplicating saved pages", async () => {
  const { store, source, indexer, parts } = await setup({ "Scans.pdf": Array.from({ length: 75 }, () => "scan").join("\f") });
  await indexer.sync(); await readAll(indexer);
  let rendered = 0;
  source.page = async () => {
    rendered++;
    const saved = (await store.segmentsOf("Scans.pdf")).filter(s => s.modality === "image").length;
    assert.equal(rendered - saved, 1, "the previous page must be saved before drawing another");
    return picture;
  };
  (indexer as any).options.onSaved = () => { if (rendered === 3) indexer.stop(); };
  parts.image = true; await indexer.sync(); await indexer.run();
  assert.equal((await store.file("Scans.pdf"))!.info.pictureNext, 3);
  (indexer as any).options.onSaved = undefined;
  await indexer.sync(); await readAll(indexer);
  const images = (await store.segmentsOf("Scans.pdf")).filter(s => s.modality === "image");
  assert.equal(images.length, 75);
  assert.equal(new Set(images.map(s => s.loc)).size, 75);
  assert.equal((await store.file("Scans.pdf"))!.info.waitingFor, undefined);
  store.close();
});

test("batch indexing does not rescan the whole vault per file, including after an unreadable note", async () => {
  const { store, source, indexer } = await setup(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`${i}.md`, `Note ${i}.`])));
  const files = store.files.bind(store); let scans = 0;
  store.files = async () => { scans++; return files(); };
  const text = source.text.bind(source);
  source.text = async path => { if (path === "10.md") throw new Error("unreadable"); return text(path); };
  await indexer.sync(); await readAll(indexer);
  assert.ok(scans < 10, `indexing 200 files made ${scans} full-vault reads`);
  const rows = await files();
  assert.equal(rows.filter(row => row.state === "done").length, 199);
  assert.equal(rows.filter(row => row.state === "failed").length, 1);
  store.close();
});

test("the pending queue follows edits, additions, deletes and renames during an in-flight read", async () => {
  const { store, source, indexer, fake } = await setup({ "a.md": "Alpha.", "b.md": "Old beta.", "c.md": "Gone.", "d.md": "Delta." });
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const text = source.text.bind(source);
  source.text = async path => { if (path === "a.md") { entered(); await hold; } return text(path); };
  await indexer.sync(); const run = indexer.run(); await reading;
  source.notes["b.md"] = "Latest beta."; await indexer.changed(source.touch("b.md"));
  source.notes["new.md"] = "New arrival."; await indexer.changed(source.touch("new.md"));
  delete source.notes["c.md"]; await indexer.removed("c.md");
  source.notes["Moved/d.md"] = source.notes["d.md"]; delete source.notes["d.md"];
  await indexer.renamed("d.md", "Moved/d.md");
  release(); await indexer.settled(); indexer.stop(); await run;
  assert.deepEqual((await store.files()).map(row => [row.path, row.state]),
    [["Moved/d.md", "done"], ["a.md", "done"], ["b.md", "done"], ["new.md", "done"]]);
  assert.equal((await store.segmentsOf("b.md"))[0].body, "Latest beta.");
  assert.equal((await store.segmentsOf("Moved/d.md"))[0].body, "Delta.");
  assert.equal(fake.asked.length, 4);
  store.close();
});

test("a read failure from an obsolete revision cannot fail the edited file", async () => {
  const { store, source, indexer } = await setup({ "a.md": "Old text." });
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  source.text = async path => {
    if (first) { first = false; entered(); await hold; throw new Error("obsolete read failed"); }
    return source.notes[path];
  };
  await indexer.sync(); const run = indexer.run(); await reading;
  source.notes["a.md"] = "Corrected text."; await indexer.changed(source.touch("a.md"));
  release(); await indexer.settled(); indexer.stop(); await run;
  assert.equal((await store.file("a.md"))!.state, "done");
  assert.equal((await store.segmentsOf("a.md"))[0].body, "Corrected text.");
  assert.equal(indexer.status.failed, 0);
  store.close();
});

test("a stale queue snapshot cannot reread a file completed by another writer", async () => {
  const { store, indexer, fake } = await setup({ "a.md": "Alpha.", "b.md": "Beta." });
  await indexer.sync();
  let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const files = store.files.bind(store); let first = true;
  store.files = async () => {
    const rows = await files();
    if (first) { first = false; entered(); await hold; }
    return rows;
  };
  const run = indexer.run(); await reading;
  const row = (await store.file("a.md"))!;
  await store.saveStep({ ...row, state: "done" }, [{ path: row.path, kind: "passage", modality: "none",
    loc: 0, locEnd: 0, body: "Saved elsewhere.", vector: null }], true);
  release(); await indexer.settled(); indexer.stop(); await run;
  assert.equal(fake.asked.length, 1);
  assert.equal((await store.segmentsOf("a.md"))[0].body, "Saved elsewhere.");
  store.close();
});

test("old video indexes are reread and include short shots in processor mode", async () => {
  const { store, source, indexer } = await setup({ "Clip.mp4": "" }, undefined, { image: true, audio: false });
  await store.saveStep({ path: "Clip.mp4", kind: "video", mtime: 1, size: 0, reader: 2, state: "done", info: {}, next: null },
    [{ path: "Clip.mp4", kind: "frame", modality: "image", loc: 10, locEnd: null, body: "old coarse sample", vector: null }], true);
  (indexer as any).options.gpu = () => false;
  source.video = async () => ({ duration: 18, frames: async times => times.map(time => ({ time, picture,
    grey: Array.from({ length: 64 }, (_, i) => time < 6 ? i * 4 : time < 12 ? 255 - i * 4 : i % 2 * 255) })), close() {} });
  assert.equal(await indexer.sync(), 1, "the old reader version must migrate automatically");
  await readAll(indexer);
  assert.deepEqual((await store.segmentsOf("Clip.mp4")).map(s => s.loc), [0, 6, 12]);
  assert.equal((await store.file("Clip.mp4"))!.reader, 3);
  store.close();
});
