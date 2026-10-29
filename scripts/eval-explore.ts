// The plugin's Explore map against Dowse's on the same index (Dowse's testbed, exported by export-dowse-index.py with
// the vocabulary's vectors from Dowse's model): how alike the groupings are (pairs of files together in both, the
// adjusted Rand index), and the aisles' names side by side. K-means is seeded differently in each, so the groups
// may differ a little; the names follow the groups.
//
//   node scripts/eval-explore.ts [.cache/dowse-testbed]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMap, type MapFile } from "../src/engine/search/explore.ts";

const folder = process.argv[2] ?? join(import.meta.dirname, "..", ".cache", "dowse-testbed");
const index = JSON.parse(readFileSync(join(folder, "index.json"), "utf8"));
const dowse = JSON.parse(readFileSync(join(folder, "explore.json"), "utf8"));
const raw = readFileSync(join(folder, "segments.f16"));
const halves = new Float16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const b = Buffer.from(dowse.words, "base64");
const all = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
const words = Array.from({ length: all.length / 768 }, (_, i) => all.slice(i * 768, (i + 1) * 768));

const byId = new Map<number, MapFile>(index.files.map((f: any) => [f.id, { path: f.path, kind: f.kind, vectors: [] }]));
for (const s of index.segments) {
  if (s.vector === null) continue;
  byId.get(s.file)?.vectors.push({ modality: s.modality, vector: halves.subarray(s.vector * 768, (s.vector + 1) * 768) });
}
const files = [...byId.entries()].sort(([a], [b]) => a - b).map(([, f]) => f);   // Dowse's order (by file id)
const started = performance.now();
const map = await buildMap(files, words);
console.log(`${map.total} files, ${map.aisles.length} aisles, in ${(performance.now() - started).toFixed(0)} ms`);

const groupOf = (membership: Record<string, string[]>) =>
  new Map(Object.entries(membership).flatMap(([id, paths]) => paths.map((p) => [p, id] as const)));
const ours = groupOf(map.membership), theirs = groupOf(dowse.membership);
const paths = [...theirs.keys()].filter((p) => ours.has(p));

// The adjusted Rand index: 1 is the same grouping, 0 what chance gives
const table = new Map<string, number>(), rows = new Map<string, number>(), columns = new Map<string, number>();
for (const p of paths) {
  const [a, b] = [ours.get(p)!, theirs.get(p)!];
  table.set(`${a}|${b}`, (table.get(`${a}|${b}`) ?? 0) + 1);
  rows.set(a, (rows.get(a) ?? 0) + 1);
  columns.set(b, (columns.get(b) ?? 0) + 1);
}
const pairs = (n: number) => (n * (n - 1)) / 2;
const sum = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + pairs(n), 0);
const index_ = sum(table), expected = (sum(rows) * sum(columns)) / pairs(paths.length);
const ari = (index_ - expected) / ((sum(rows) + sum(columns)) / 2 - expected);
console.log(`adjusted Rand index ${ari.toFixed(3)} over ${paths.length} files`);

console.log("\nDowse's aisles → the plugin's (most of their files)");
for (const aisle of dowse.aisles) {
  const members: string[] = dowse.membership[aisle.id] ?? [];
  const counts = new Map<string, number>();
  for (const p of members) counts.set(ours.get(p)!, (counts.get(ours.get(p)!) ?? 0) + 1);
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const label = map.aisles.find((a) => a.id === best)?.label ?? "—";
  console.log(`  ${aisle.label.padEnd(28)} ${String(aisle.count).padStart(3)}  →  ${label} (${n} of them)`);
}
