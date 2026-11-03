// Evaluate actual model/reader output for both 30s baseline and current short passages. Fixtures and ground truth
// are separate from the vault, so transcripts and query phrases cannot be found as text/filenames.
// OBSIDIAN_EXECUTABLE=... DOWSE_MEDIA_CORPUS=... [DOWSE_MODEL_MANIFEST=...] node scripts/media-accuracy.mjs
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { native } from "./lib/native.mjs";
import { seedModelCache } from "./lib/model-cache.mjs";

const corpus = resolve(process.env.DOWSE_MEDIA_CORPUS ?? ".cache/release-validation/media-corpus");
const truth = JSON.parse(await readFile(join(corpus, "truth.json"), "utf8"));
const test = await native("media", async vault => {
  for (const f of truth.files) { const target = join(vault, f.path); await mkdir(dirname(target), { recursive: true }); await copyFile(join(corpus, "vault", f.path), target); }
});
test.page.on("console", message => { if (message.text().startsWith("MEDIA ")) console.log(message.text()); });
try {
  const cache = await seedModelCache(test.page, "all");
  console.log("Verified model data ready; using real inference.");
  const results = await test.page.evaluate(async ({ truth, device }) => {
    const p = app.plugins.plugins.dowse;
    p.paused = true; p.settings.images = true; p.settings.sound = true; p.settings.device = device;
    await p.save(); await p.turnOn();
    const model = await p.engine.use(); await p.engine.search.ensureProbes(model);
    const out = { model: p.engine.model, baseline: null, short: null };
    const active = new Set(truth.files.map(f => f.path));
    for (const variant of ["baseline", "short"]) {
      const store = await p.engine.store.constructor.open(`dowse-media-quality-${variant}`, "quality-current-pinned-model");
      await store.clear();
      const indexer = new p.engine.indexer.constructor(store, p.engine.indexer.source, {
        active: path => active.has(path), parts: () => ({ image: true, audio: true }),
        embed: () => p.engine.use(), gpu: () => p.engine.model.device !== "wasm",
        onSaved: path => console.log(`MEDIA ${variant} indexed ${path}`),
      });
      if (variant === "baseline") {
        const media = indexer.media.bind(indexer);
        indexer.media = () => ({ ...media(), window: 30, hop: 25 });
      }
      const began = performance.now();
      await indexer.sync(); const running = indexer.run(); await indexer.settled(); indexer.stop(); await running;
      const search = new p.engine.search.constructor(store, { ready: () => p.engine.loaded, wake: () => {} }, path => active.has(path),
        new p.engine.search.catalog.constructor(store.name));
      search.bank = p.engine.search.bank;
      const answers = [];
      for (const q of truth.queries) {
        const answer = await search.search(q.q, { kinds: [q.kind] });
        answers.push({ q: q.q, kind: q.kind, strong: answer.strong, hits: answer.hits.slice(0, 5).map(h => ({ path: h.path, loc: h.loc, locEnd: h.locEnd, moments: h.moments })) });
      }
      const files = await store.files(), segments = await store.segments();
      out[variant] = { seconds: (performance.now() - began) / 1000, answers,
        files: files.map(f => ({ path: f.path, state: f.state, detail: f.detail, info: f.info })),
        segments: segments.map(s => ({ path: s.path, kind: s.kind, modality: s.modality, loc: s.loc, locEnd: s.locEnd })) };
      search.close(); await store.clear(); store.close();
    }
    return out;
  }, { truth, device: process.env.DOWSE_MEDIA_DEVICE === "wasm" ? "wasm" : "auto" });
  function metrics(variant, kind) {
    const rows = truth.queries.map((q, i) => ({ q, a: variant.answers[i] })).filter(({ q }) => q.kind === kind);
    const positive = rows.filter(({ q }) => q.expect.length), negative = rows.filter(({ q }) => !q.expect.length);
    let r1 = 0, r5 = 0, moment = 0; const errors = [], span = [], missed = [];
    for (const { q, a } of positive) {
      const rank = a.hits.findIndex(h => q.expect.some(e => e.path === h.path));
      if (rank === 0) r1++; if (rank >= 0) r5++; else missed.push(q.q);
      const hit = a.hits.find(h => q.expect.some(e => e.path === h.path));
      if (!hit || hit.loc === null) continue;
      const expected = q.expect.filter(e => e.path === hit.path);
      const error = Math.min(...expected.map(e => Math.abs(hit.loc - e.start)));
      errors.push(error); span.push((hit.locEnd ?? hit.loc) - hit.loc);
      if (expected.some(e => hit.loc < e.end && (hit.locEnd === null ? hit.loc >= e.start : hit.locEnd > e.start))) moment++;
    }
    const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
    return { queries: positive.length, fileR1: r1 / positive.length, fileR5: r5 / positive.length,
      primaryMomentRecall: moment / positive.length, medianStartErrorSeconds: median(errors), medianPassageSeconds: median(span),
      absent: negative.length, falseAlarms: negative.filter(({ a }) => a.strong > 0).length, missed };
  }
  const report = { model: results.model, cache, baseline: { audio: metrics(results.baseline, "audio"), video: metrics(results.baseline, "video") },
    short: { audio: metrics(results.short, "audio"), video: metrics(results.short, "video") }, errors: test.errors, consoleErrors: test.consoleErrors };
  report.regressions = truth.queries.filter((q, i) => q.expect.length && results.baseline.answers[i].hits.some(h => q.expect.some(e => e.path === h.path)) &&
    !results.short.answers[i].hits.some(h => q.expect.some(e => e.path === h.path))).map(q => q.q);
  await writeFile(join(test.artifacts, "raw.json"), JSON.stringify(results, null, 2));
  await writeFile(join(test.artifacts, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.ok(results.short.files.every(f => f.state === "done"), "every fixture was indexed");
  assert.deepEqual(test.errors, []);
  if (process.env.DOWSE_ALLOW_QUALITY_REGRESSIONS !== "1") assert.deepEqual(report.regressions, [], "short windows lost baseline file retrieval; review before release");
} finally { await test.close(); }
