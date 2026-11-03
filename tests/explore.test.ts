// Explore's map as Dowse makes it (tests/fixtures/explore.json, from Dowse's own `_build_snapshot` on a synthetic
// index: scripts/explore-fixture.py). The groups are given there (numpy seeds k-means its own way); the plugin's
// k-means is checked to find the same groups by itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arrange, buildFolderMap, buildMap, fileVectors, grouped, type MapFile } from "../src/engine/search/explore.ts";

const fixture = JSON.parse(readFileSync(new URL("fixtures/explore.json", import.meta.url), "utf8"));
const bytes = (b64: string) => { const b = Buffer.from(b64, "base64"); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const files: MapFile[] = fixture.files.map((f: any) => ({
  path: f.path, kind: f.kind,
  vectors: f.vectors.map((v: any) => ({ modality: v.modality, vector: new Float16Array(bytes(v.vector)) })),
}));
const all = new Float32Array(bytes(fixture.words));
const words = fixture.vocabulary.map((_: string, i: number) => all.slice(i * 768, (i + 1) * 768));
const close = (a: number, b: number, tolerance = 1e-4) => Math.abs(a - b) <= tolerance;

test("a file is the mean of its vectors, each modality centred on its own mean", () => {
  const { vectors } = fileVectors(files);
  fixture.fileVectors.forEach((expected: number[], i: number) => {
    expected.forEach((value, j) => assert.ok(close(vectors.row(i)[j], value, 1e-5), `file ${i}, ${j}: ${vectors.row(i)[j]} ≠ ${value}`));
  });
});

test("the same groups give Dowse's map: what's set apart, the names, the places, the spirals", () => {
  const { files: kept, vectors } = fileVectors(files);
  const map = arrange(kept, vectors, fixture.labels, fixture.k, words, fixture.vocabulary);
  const expected = fixture.map;
  assert.deepEqual(map.aisles.map((a) => [a.label, a.count, a.id, a.about]),
                   expected.aisles.map((a: any) => [a.label, a.count, a.id, a.about]));
  assert.deepEqual(map.membership, expected.membership);
  // The principal axes' signs are arbitrary (numpy's and these may differ): the map may be mirrored, never otherwise
  const sign = (axis: "x" | "y") => {
    const i = expected.aisles.findIndex((a: any) => Math.abs(a[axis]) > 0.5);
    return Math.sign(map.aisles[i][axis]) === Math.sign(expected.aisles[i][axis]) ? 1 : -1;
  };
  const [sx, sy] = [sign("x"), sign("y")];
  map.aisles.forEach((a, i) => {
    const e = expected.aisles[i];
    assert.ok(close(a.x * sx, e.x, 1e-3) && close(a.y * sy, e.y, 1e-3) && close(a.radius, e.radius), `${a.label}: (${a.x}, ${a.y}) ≠ (${e.x}, ${e.y})`);
  });
  map.pieces.forEach((p, i) => {
    const e = expected.pieces[i];
    assert.equal(p.path, e.path);
    assert.equal(p.aisle, e.aisle);
    const mirrored = (value: number, centre: number, s: number) => s * centre + (value - centre);   // the spiral keeps its turn
    assert.ok(close(mirrored(p.x, map.aisles[p.aisle].x, sx), e.x, 1e-3) && close(mirrored(p.y, map.aisles[p.aisle].y, sy), e.y, 1e-3),
              `${p.path}: (${p.x}, ${p.y}) ≠ (${e.x}, ${e.y})`);
  });
});

test("k-means finds the themes by itself, and the same map every time", async () => {
  const { vectors } = fileVectors(files);
  const labels = await grouped(vectors, fixture.k);
  const pairs = (l: ArrayLike<number>) => Array.from({ length: l.length }, (_, i) => i)
    .flatMap((i) => Array.from({ length: i }, (_, j) => (l[i] === l[j] ? 1 : 0)));
  const themed = fixture.labels.map((_: number, i: number) => (files[i].path.startsWith("odd/") ? -1 - i : fixture.labels[i]));
  const ours = Array.from(labels, (l, i) => (files[i].path.startsWith("odd/") ? -1 - i : l));
  assert.deepEqual(pairs(ours), pairs(themed), "the same files together");
  const first = await buildMap(files, null);
  const again = await buildMap(files, null);
  assert.deepEqual(first.pieces.map((p) => [p.path, p.x, p.y]), again.pieces.map((p) => [p.path, p.x, p.y]));
  for (const aisle of first.aisles.filter((a) => a.id !== "rest")) {   // (more aisles than themes: a theme may split)
    const themes = new Set(first.membership[aisle.id].map((p) => p.split("/")[0]));
    assert.equal(themes.size, 1, `${aisle.label} mixes ${[...themes].join(", ")}`);
  }
});

test("a vault with few files, or files without vectors", async () => {
  assert.deepEqual(await buildMap([], null), { aisles: [], pieces: [], total: 0, membership: {} });
  const few = await buildMap(files.slice(0, 4).concat({ path: "name only.png", kind: "image", vectors: [] }), null);
  assert.equal(few.total, 4);
  assert.ok(few.aisles.length >= 1 && few.pieces.length === 4);
});

test("folder mode preserves exact parent paths, root files, and files without embeddings", () => {
  const files = ["Root.md", "Trips/Plan.md", "Trips/Europe/Plan.md", "Work/Europe/Plan.md", "Trips/unread.png"]
    .map(path => ({ path, kind: path.endsWith(".png") ? "image" : "note", vectors: [] }));
  const map = buildFolderMap(files);
  assert.equal(map.total, files.length);
  assert.equal(map.aisles.length, 4);
  assert.deepEqual(map.membership["folder:"], ["Root.md"]);
  assert.equal(map.aisles.find(a => a.id === "folder:")?.label, "Vault root files");
  assert.deepEqual(map.membership["folder:Trips"], ["Trips/Plan.md", "Trips/unread.png"]);
  assert.deepEqual(map.membership["folder:Trips/Europe"], ["Trips/Europe/Plan.md"]);
  assert.deepEqual(map.membership["folder:Work/Europe"], ["Work/Europe/Plan.md"]);
  assert.deepEqual(map, buildFolderMap([...files].reverse()), "stable regardless of indexing order");
  assert.equal(new Set(map.pieces.map(p => p.path)).size, files.length);
  for (const p of map.pieces) {
    const group = map.aisles[p.aisle];
    assert.ok(map.membership[group.id].includes(p.path));
    assert.ok(Math.hypot(p.x - group.x, p.y - group.y) < group.radius);
  }
  for (const a of map.aisles) for (const b of map.aisles) if (a.index < b.index)
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.radius + b.radius, "folder groups do not overlap");
  assert.deepEqual(buildFolderMap([]), { aisles: [], pieces: [], total: 0, membership: {} });
});

test("large folder maps retain full counts with bounded representative previews", () => {
  const files = Array.from({ length: 10000 }, (_, i) => ({ path: `Folder${i % 10}/${i}.md`, kind: "note" }));
  const map = buildFolderMap(files);
  assert.equal(map.total, 10000);
  assert.equal(map.pieces.length, 1200);
  assert.equal(map.aisles.reduce((n, a) => n + a.count, 0), 10000);
  assert.equal(Object.values(map.membership).flat().length, 10000);
  assert.ok(map.pieces.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});
