// The plugin's search against Dowse's on the same index (Dowse's testbed, exported by export-dowse-index.py): the same
// query vectors, Dowse's answers beside the plugin's. Prints both evals (R@1, MRR, strong results, false alarms) and
// how often the two agree: the same first result, the same top 10, the same "found".
//
//   node scripts/eval-search.ts [.cache/dowse-testbed] [--model]
//
// --model: the queries' vectors from the plugin's own model build (fp16, transformers.js on the processor here), with
// its prompts and date handling, instead of Dowse's.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Searcher, strongCount, type Hit, type IndexFile, type IndexSegment } from "../src/engine/search/searcher.ts";

const folder = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(import.meta.dirname, "..", ".cache", "dowse-testbed");
const ownModel = process.argv.includes("--model");
const index = JSON.parse(readFileSync(join(folder, "index.json"), "utf8"));
const { now, queries } = JSON.parse(readFileSync(join(folder, "queries.json"), "utf8"));
const raw = readFileSync(join(folder, "segments.f16"));
const halves = new Float16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
const f32 = (b64: string) => { const b = Buffer.from(b64, "base64"); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };

const files: IndexFile[] = index.files;
const segments: IndexSegment[] = index.segments.map((s: any) => ({
  ...s, vector: s.vector === null ? null : halves.subarray(s.vector * 768, (s.vector + 1) * 768),
}));
const bankAll = index.probes ? f32(index.probes) : null;
const bank = bankAll ? Array.from({ length: bankAll.length / 768 }, (_, i) => bankAll.slice(i * 768, (i + 1) * 768)) : null;
const started = performance.now();
const searcher = new Searcher(files, segments, bank);
console.log(`${files.length} files, ${searcher.size} vectors; searcher built in ${(performance.now() - started).toFixed(0)} ms`);

const expected = (hit: { path: string; loc: number | null; locEnd?: number | null }, expect: string) => {
  const [path, moment] = expect.split("@");
  if (hit.path.toLowerCase() !== path.toLowerCase()) return false;
  if (!moment) return true;
  const [start, end] = moment.split("-").map(Number);
  return hit.loc !== null && hit.loc <= end && (hit.locEnd ?? hit.loc) >= start;
};

function score(name: string, answers: { q: any; hits: { path: string; loc: number | null; locEnd?: number | null }[]; strong: number }[]) {
  const ranks: (number | null)[] = [];
  const strong: number[] = [];
  let alarms = 0, absent = 0;
  for (const { q, hits, strong: count } of answers) {
    if (!q.expect.length) { absent++; if (count) alarms++; continue; }
    const rank = hits.findIndex((h) => q.expect.some((e: string) => expected(h, e)));
    ranks.push(rank < 0 ? null : rank + 1);
    strong.push(count);
  }
  const n = ranks.length;
  console.log(`${name.padEnd(8)} R@1 ${(ranks.filter((r) => r === 1).length / n).toFixed(3)}  ` +
    `R@5 ${(ranks.filter((r) => r !== null && r <= 5).length / n).toFixed(3)}  ` +
    `MRR ${(ranks.reduce((a: number, r) => a + (r ? 1 / r : 0), 0) / n).toFixed(3)}  ` +
    `strong ${(strong.reduce((a, b) => a + b, 0) / n).toFixed(1)}  false alarms ${alarms}/${absent}`);
}

const vectors = new Map<string, Float32Array>(queries.map((q: any) => [q.q, f32(q.vector)]));
if (ownModel) {
  const { AutoModel, AutoTokenizer, env } = await import("@huggingface/transformers");
  const { forMeaning } = await import("../src/engine/search/dates.ts");
  const { Prompts } = await import("../src/engine/reading/types.ts");
  env.cacheDir = join(import.meta.dirname, "..", ".cache", "models");
  const id = "onnx-community/embeddinggemma-2-ONNX";
  const tokenizer = await AutoTokenizer.from_pretrained(id);
  const model: any = await AutoModel.from_pretrained(id, { device: "cpu", dtype: "fp16" });
  for (const q of queries) {
    const inputs = await tokenizer([Prompts.query(forMeaning(q.q, now))], { padding: true });
    vectors.set(q.q, (await model(inputs)).sentence_embedding.data as Float32Array);
  }
  console.log("query vectors: the plugin's model (fp16)");
}

let sameFirst = 0, sameTop = 0, sameStrong = 0, maxZ = 0;
const ours: { q: any; hits: Hit[]; strong: number }[] = [];
const differences: string[] = [];
const searchStarted = performance.now();
for (const q of queries) {
  const hits = searcher.search(q.q, vectors.get(q.q)!, { limit: 10, now });
  ours.push({ q, hits, strong: strongCount(hits) });
  const mine = hits.map((h) => h.path), theirs = q.dowse.map((h: any) => h.path);
  if (mine[0] === theirs[0]) sameFirst++;
  else differences.push(`${q.q}: Dowse ${theirs[0]} · plugin ${mine[0]}`);
  if (JSON.stringify(mine) === JSON.stringify(theirs)) sameTop++;
  if (strongCount(hits) === q.strong) sameStrong++;
  for (const h of hits) {
    const other = q.dowse.find((d: any) => d.path === h.path);
    if (other && other.z !== null && h.z !== null) maxZ = Math.max(maxZ, Math.abs(other.z - h.z));
  }
}
const perQuery = (performance.now() - searchStarted) / queries.length;
score("Dowse", queries.map((q: any) => ({ q, hits: q.dowse, strong: q.strong })));
score("plugin", ours);
console.log(`agreement: same first ${sameFirst}/${queries.length}, same top 10 ${sameTop}/${queries.length}, ` +
  `same strong count ${sameStrong}/${queries.length}, largest z difference ${maxZ.toExponential(2)}; ` +
  `${perQuery.toFixed(1)} ms a search`);
for (const line of differences.slice(0, 20)) console.log("  " + line);
