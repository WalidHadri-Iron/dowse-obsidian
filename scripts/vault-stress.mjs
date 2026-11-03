// DOWSE_STRESS_FILES=10000 OBSIDIAN_EXECUTABLE=/path/to/obsidian node scripts/vault-stress.mjs
// A real vault, IndexedDB, indexer, search worker, file events and UI. Only inference is replaced to make a large,
// repeatable reliability test independent of downloads/GPU performance. Accuracy is measured separately.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { native, fakeIndexer, until, delay } from "./lib/native.mjs";

const count = Number(process.env.DOWSE_STRESS_FILES ?? 10000);
if (!Number.isInteger(count) || count < 200 || count > 50000) throw new Error("DOWSE_STRESS_FILES must be 200–50000");
const filePath = i => `Sources/Group${i % 20}/record-${String(i).padStart(5, "0")}.md`;
const started = Date.now();
const test = await native("stress", async vault => {
  for (let g = 0; g < 20; g++) await mkdir(join(vault, `Sources/Group${g}`), { recursive: true });
  const paragraph = "A researcher compares observations, records the experimental setup, checks the measurements, and describes the implications in a reproducible engineering report. ".repeat(7);
  for (let i = 0; i < count; i++) await writeFile(join(vault, filePath(i)),
    `# Record ${i}\nStabilitytoken${String(i).padStart(5, "0")}\n` + Array.from({ length: 5 }, (_, n) => `\n## Topic ${n}\n${paragraph}`).join(""));
  console.log(`Created ${count} actual Markdown files.`);
});
const { page, artifacts } = test;
const result = { platform: process.platform, count, inference: "deterministic test double; native storage/indexer/search/UI", queries: [], actions: [] };
try {
  await page.evaluate(async () => { await app.plugins.plugins.dowse.openSearch(); });
  await fakeIndexer(page);
  await page.evaluate(() => {
    const state = window.__stress = { states: [], tasks: [], gaps: [], completed: 0 };
    let last = performance.now();
    state.observer = new PerformanceObserver(list => state.tasks.push(...list.getEntries().map(e => e.duration)));
    state.observer.observe({ type: "longtask" });
    state.timer = setInterval(() => { const now = performance.now(); state.gaps.push(now - last); last = now;
      const s = app.plugins.plugins.dowse?.engine?.status; if (s) { state.states.push(s.state); state.completed = s.done; } }, 20);
  });
  // Indexing starts with the newest files; wait for an anchor independently of filesystem enumeration order.
  let anchor;
  await until(async () => { anchor = await page.evaluate(async () => {
    const row = (await app.plugins.plugins.dowse.engine.store.files()).find(f => f.state === "done" && !f.path.includes("Group7/") && Number(/record-(\d+)/.exec(f.path)?.[1]) > 60); return row?.path;
  }); return !!anchor; }, "No file indexed", 240000);
  const anchorName = /record-(\d+)/.exec(anchor)[1];
  result.anchor = anchor;
  const deadline = Date.now() + 30 * 60_000;
  for (let cycle = 0; cycle < 30 || await page.evaluate(() => app.plugins.plugins.dowse.engine.status.state !== "idle"); cycle++) {
    assert.ok(Date.now() < deadline, "indexing and search must finish within 30 minutes");
    const began = Date.now();
    const query = `${cycle % 2 ? "record " : ""}stabilitytoken${anchorName}`;
    // CDP does not dispatch macOS native edit commands for Meta+A. Select through the DOM, then exercise actual
    // keyboard deletion and typing on every platform; assert the field really cleared before entering another query.
    await page.$eval(".dowse-search input", input => { input.focus(); input.select(); });
    await page.keyboard.press("Backspace");
    assert.equal(await page.$eval(".dowse-search input", input => input.value), "", "deleting the previous query clears the field");
    await page.waitForFunction(() => document.querySelector(".dowse-body")?.getAttribute("aria-busy") === "false", { polling: 50, timeout: 60000 });
    await page.keyboard.type(query, { delay: 2 });
    await page.waitForFunction(title => document.querySelector(".dowse-body")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".dowse-result-title")?.textContent === title, { polling: 50, timeout: 60000 }, `Record ${Number(anchorName)}`);
    const state = await page.evaluate(() => ({ summary: document.querySelector(".dowse-summary").textContent,
      title: document.querySelector(".dowse-result-title")?.textContent, indexing: app.plugins.plugins.dowse.engine.status.state }));
    assert.equal(state.title, `Record ${Number(anchorName)}`, "the already indexed anchor stays searchable");
    result.queries.push({ cycle, ms: Date.now() - began, ...state });
    if (cycle === 2) {
      const changes = await page.evaluate(async paths => {
        const edited = [], deleted = [], renamed = [];
        for (let i = 0; i < paths.length; i++) {
          const f = app.vault.getFileByPath(paths[i]); if (!f) continue;
          for (let revision = 0; revision < 3; revision++) await app.vault.modify(f, `# Changed\nFinalmarker${i} revision ${revision}.`);
          if (i % 3 === 0) { await app.vault.delete(f); deleted.push(paths[i]); }
          else if (i % 3 === 1) { const to = paths[i].replace("record-", "moved-"); await app.fileManager.renameFile(f, to); renamed.push([paths[i], to, `Finalmarker${i}`]); }
          else edited.push([paths[i], `Finalmarker${i}`]);
        }
        return { edited, deleted, renamed };
      }, Array.from({ length: 60 }, (_, i) => filePath(i)).filter(p => p !== anchor));
      result.mutations = changes; result.actions.push("180 rapid edits, deletes and renames while indexing");
    }
    if (cycle === 5) {
      await page.evaluate(async () => { await app.plugins.plugins.dowse.setSearched("Sources/Group7", false); });
      result.actions.push("exclude a folder while indexing");
    }
    if (cycle === 7) {
      await page.evaluate(() => { app.plugins.plugins.dowse.setPaused(true); });
      await until(() => page.evaluate(() => ["paused", "idle"].includes(app.plugins.plugins.dowse.engine.status.state)), "Pause did not settle");
      await page.evaluate(() => { app.plugins.plugins.dowse.setPaused(false); });
      result.actions.push("pause and resume");
    }
    if (cycle === 10) {
      await page.evaluate(async () => { const p = app.plugins.plugins.dowse; p.settings.on = false; await p.save(); await app.plugins.disablePlugin("dowse"); await app.plugins.enablePlugin("dowse"); });
      await fakeIndexer(page);
      await page.evaluate(async query => { await app.plugins.plugins.dowse.openSearch(query); }, query);
      result.actions.push("disable/re-enable plugin, resume saved progress");
    }
    if (cycle % 5 === 0) console.log(JSON.stringify({ cycle, seconds: (Date.now() - started) / 1000, ...state }));
    // Keep work running long enough to exercise interleaved refreshes rather than one burst of startup work.
    await delay(cycle < 30 ? 1500 : 5000);
  }
  await until(() => page.evaluate(() => app.plugins.plugins.dowse.engine.status.state === "idle"), "Indexing did not finish", 1800000);
  await page.evaluate(() => app.plugins.plugins.dowse.engine.search.changed(true));
  result.final = await page.evaluate(async mutations => {
    const p = app.plugins.plugins.dowse; await p.fileEvents.settled();
    const d = window.__stress; clearInterval(d.timer); d.observer.disconnect();
    // Do not count this test's whole-vault verification work as application interaction time.
    const rows = await p.engine.store.files(), segments = await p.engine.store.segments();
    const byPath = new Map(rows.map(r => [r.path, r]));
    const segmentPaths = new Map();
    for (const s of segments) { const own = segmentPaths.get(s.path) ?? []; own.push(s); segmentPaths.set(s.path, own); }
    const failures = [];
    for (const path of mutations.deleted) if (byPath.has(path) || segmentPaths.has(path)) failures.push(`ghost ${path}`);
    for (const [path, marker] of mutations.edited) if (!path.includes("Group7/") && !(segmentPaths.get(path) ?? []).some(s => s.body.includes(marker) && s.body.includes("revision 2"))) failures.push(`stale edit ${path}`);
    for (const [old, path, marker] of mutations.renamed) {
      if (byPath.has(old) || segmentPaths.has(old)) failures.push(`old name ${old}`);
      if (!path.includes("Group7/") && !(segmentPaths.get(path) ?? []).some(s => s.body.includes(marker))) failures.push(`missing rename ${path}`);
    }
    const expected = app.vault.getFiles().filter(f => f.extension === "md" && !f.path.startsWith("Sources/Group7/"));
    const complete = expected.filter(f => byPath.get(f.path)?.state === "done").length;
    const hidden = await p.engine.search.search("", { within: ["Sources/Group7"] }, false);
    return { expected: expected.length, complete, rows: rows.length, vectors: segments.filter(s => s.vector).length, failed: rows.filter(r => r.state === "failed"),
      failures, excludedHits: hidden.hits.length, status: p.engine.status, maxTask: Math.max(0, ...d.tasks),
      maxGap: Math.max(0, ...d.gaps), states: [...new Set(d.states)] };
  }, result.mutations);
  assert.equal(result.final.complete, result.final.expected, "all active files indexed, including saved progress after reload");
  assert.deepEqual(result.final.failures, []);
  assert.deepEqual(result.final.failed, []);
  assert.equal(result.final.excludedHits, 0);
  assert.deepEqual(test.errors, []);
  result.seconds = (Date.now() - started) / 1000; result.errors = test.errors; result.consoleErrors = test.consoleErrors;
  await writeFile(join(artifacts, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result.final));
  console.log(`Large-vault reliability passed in ${result.seconds.toFixed(1)} seconds: ${artifacts}`);
} catch (error) {
  const state = await page.evaluate(() => ({ input: document.querySelector(".dowse-search input")?.value,
    summary: document.querySelector(".dowse-summary")?.textContent, title: document.querySelector(".dowse-result-title")?.textContent,
    busy: document.querySelector(".dowse-body")?.getAttribute("aria-busy"), status: app.plugins.plugins.dowse?.engine?.status,
    active: document.activeElement?.outerHTML })).catch(() => null);
  await writeFile(join(artifacts, "failure.json"), JSON.stringify({ error: error.stack, result, state, errors: test.errors, consoleErrors: test.consoleErrors }, null, 2));
  throw error;
} finally { await test.close(); }
