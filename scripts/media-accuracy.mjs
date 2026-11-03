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
if (process.env.DOWSE_MEDIA_KINDS) {
  const kinds = process.env.DOWSE_MEDIA_KINDS.split(",");
  assert.ok(kinds.every(k => ["audio", "video"].includes(k)), "DOWSE_MEDIA_KINDS must be audio, video or audio,video");
  truth.files = truth.files.filter(f => kinds.includes(f.kind)); truth.queries = truth.queries.filter(q => kinds.includes(q.kind));
}
const parts = { image: truth.files.some(f => f.kind === "video"), audio: truth.files.some(f => f.kind === "audio" || f.kind === "video") };
const test = await native("media", async vault => {
  for (const f of truth.files) { const target = join(vault, f.path); await mkdir(dirname(target), { recursive: true }); await copyFile(join(corpus, "vault", f.path), target); }
}, { protocolTimeout: 30 * 60_000 });
test.page.on("console", message => { if (message.text().startsWith("MEDIA ")) console.log(message.text()); });
let report;
try {
  const cache = await seedModelCache(test.page, parts.image ? "all" : "audio");
  console.log("Verified model data ready; using real inference.");
  const results = await test.page.evaluate(async ({ truth, device, parts }) => {
    const p = app.plugins.plugins.dowse;
    p.paused = true; p.settings.images = parts.image; p.settings.sound = parts.audio; p.settings.device = device;
    await p.save(); await p.turnOn();
    const model = await p.engine.use(); await p.engine.search.ensureProbes(model);
    const out = { model: p.engine.model, baseline: null, short: null };
    const active = new Set(truth.files.map(f => f.path));
    for (const variant of ["baseline", "short"]) {
      const store = await p.engine.store.constructor.open(`dowse-media-quality-${variant}`, "quality-current-pinned-model");
      await store.clear();
      const indexer = new p.engine.indexer.constructor(store, p.engine.indexer.source, {
        active: path => active.has(path), parts: () => parts,
        embed: () => p.engine.use(), gpu: () => p.engine.model.device !== "wasm",
        onSaved: path => console.log(`MEDIA ${variant} indexed ${path}`),
      });
      if (variant === "baseline") {
        const media = indexer.media.bind(indexer);
        indexer.media = () => ({ ...media(), window: 30, hop: 25,
          frameInterval: p.engine.model.device === "wasm" ? 10 : 3 });
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
      out[variant] = { seconds: (performance.now() - began) / 1000, media: indexer.media(), answers,
        files: files.map(f => ({ path: f.path, state: f.state, detail: f.detail, info: f.info })),
        segments: segments.map(s => ({ path: s.path, kind: s.kind, modality: s.modality, loc: s.loc, locEnd: s.locEnd })) };
      search.close(); await store.clear(); store.close();
    }
    return out;
  }, { truth, parts, device: process.env.DOWSE_MEDIA_DEVICE === "wasm" ? "wasm" : "auto" });
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
  report = { conditions: truth.conditions ?? { mode: "clean" }, model: results.model, cache, baseline: { audio: metrics(results.baseline, "audio"), video: metrics(results.baseline, "video") },
    short: { audio: metrics(results.short, "audio"), video: metrics(results.short, "video") }, errors: test.errors, consoleErrors: test.consoleErrors };
  report.regressions = truth.queries.filter((q, i) => q.expect.length && results.baseline.answers[i].hits.some(h => q.expect.some(e => e.path === h.path)) &&
    !results.short.answers[i].hits.some(h => q.expect.some(e => e.path === h.path))).map(q => q.q);
  report.lostFiles = truth.queries.flatMap((q, i) => q.expect.filter(e =>
    results.baseline.answers[i].hits.some(h => h.path === e.path) && !results.short.answers[i].hits.some(h => h.path === e.path)
  ).map(e => ({ q: q.q, path: e.path })));
  report.seeks = [];
  await writeFile(join(test.artifacts, "raw.json"), JSON.stringify(results, null, 2));
  if (process.env.DOWSE_MEDIA_SEEK === "1") {
    const seen = new Set();
    for (const answer of results.short.answers) {
      const hit = answer.hits[0];
      if (!hit || hit.loc === null || seen.has(`${hit.path}#${hit.loc}`)) continue;
      seen.add(`${hit.path}#${hit.loc}`);
      await test.page.evaluate(hit => app.plugins.plugins.dowse.controller.open({ ...hit, kind: hit.path.startsWith("Video/") ? "video" : "audio", info: {} }), hit);
      await test.page.waitForFunction(hit => {
        const view = app.workspace.activeLeaf?.view, media = view?.containerEl.querySelector("audio, video");
        return view?.file?.path === hit.path && media?.readyState >= 1 && !media.seeking && Math.abs(media.currentTime - hit.loc) < .3;
      }, { timeout: 10000 }, hit);
      report.seeks.push(await test.page.evaluate(hit => {
        const m = app.workspace.activeLeaf.view.containerEl.querySelector("audio, video");
        return { path: hit.path, expected: hit.loc, actual: m.currentTime, duration: m.duration };
      }, hit));
    }
  }
  await writeFile(join(test.artifacts, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  assert.ok(results.short.files.every(f => f.state === "done"), "every fixture was indexed");
  assert.deepEqual(test.errors, []);
  if (process.env.DOWSE_ALLOW_QUALITY_REGRESSIONS !== "1") {
    assert.deepEqual(report.regressions, [], "short windows lost baseline file retrieval; review before release");
    assert.deepEqual(report.lostFiles, [], "short windows lost a relevant file previously in the top five");
  }
} catch (error) {
  const state = await test.page.evaluate(() => {
    const v = app.workspace.activeLeaf?.view, m = v?.containerEl.querySelector("audio, video");
    return { view: v?.getViewType(), file: v?.file?.path, media: m ? { time: m.currentTime, duration: m.duration, ready: m.readyState, error: m.error?.message } : null };
  }).catch(() => null);
  if (report) await writeFile(join(test.artifacts, "results.json"), JSON.stringify(report, null, 2));
  await writeFile(join(test.artifacts, "failure.json"), JSON.stringify({ error: error.stack, state, errors: test.errors, consoleErrors: test.consoleErrors }, null, 2));
  throw error;
} finally { await test.close(); }
