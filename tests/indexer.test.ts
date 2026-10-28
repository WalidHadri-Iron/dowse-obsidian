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
  assert.deepEqual((await store.segmentsOf("Memos/standup.m4a")).map((s) => [s.kind, s.modality, s.loc, s.locEnd]),
                   [["audio", "audio", 0, 30], ["audio", "audio", 25, 55], ["audio", "audio", 50, 70]]);
  assert.equal((await store.file("Memos/standup.m4a"))!.info.duration, 70);
});
