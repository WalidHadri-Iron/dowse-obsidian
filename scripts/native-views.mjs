// Native mixed readers, checkpoint/restart, 3D views, confidence presentation and Excalidraw integration.
// Only inference and the deliberate closest-answer presentation case use test doubles.
import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { native, until, delay } from "./lib/native.mjs";
import { mixedFixtures } from "./lib/mixed-fixtures.mjs";

const excalidraw = resolve(process.env.DOWSE_EXCALIDRAW_PLUGIN ?? ".cache/test-excalidraw");
const test = await native("views", async vault => {
  await mixedFixtures(vault);
  const dir = join(vault, ".obsidian/plugins/obsidian-excalidraw-plugin"); await mkdir(dir, { recursive: true });
  for (const name of ["main.js", "manifest.json", "styles.css"]) await copyFile(join(excalidraw, name), join(dir, name));
  await writeFile(join(dir, "data.json"), JSON.stringify({ previousRelease: "2.29.1" }));
});
const { page, artifacts } = test;
const result = { platform: process.platform, arch: process.arch, inference: "deterministic vectors; actual native readers, storage, views and players", stages: [] };
async function installEmbedder(checkpoint) {
  await page.evaluate(async checkpoint => {
    const p = app.plugins.plugins.dowse; p.paused = true; p.settings.images = true; p.settings.sound = true;
    await p.save(); await p.turnOn();
    const e = p.engine, vector = () => Float32Array.from({ length: 768 }, (_, i) => Math.sin(i) / 20);
    window.__decodePaths ??= [];
    if (!window.__realDecode) {
      window.__realDecode = OfflineAudioContext.prototype.decodeAudioData;
      OfflineAudioContext.prototype.decodeAudioData = function(...args) {
        window.__decodePaths.push(window.__soundPath); return window.__realDecode.apply(this, args);
      };
    }
    const sound = e.indexer.source.sound.bind(e.indexer.source);
    e.indexer.source.sound = async (path, ...args) => {
      window.__soundPath = path; try { return await sound(path, ...args); } finally { window.__soundPath = null; }
    };
    e.indexer.options.gpu = () => false;
    e.indexer.options.embed = async () => ({ texts: async xs => xs.map(vector), images: async xs => xs.map(vector), audio: async xs => xs.map(vector) });
    e.search.model = { ready: () => null, wake: () => {} };
    if (checkpoint) {
      const save = e.store.saveStep.bind(e.store);
      e.store.saveStep = async (row, ...args) => {
        const ok = await save(row, ...args);
        if (ok && row.path === "Audio/Long.wav" && row.next === 300) { window.__checkpoint = row.next; p.setPaused(true); }
        return ok;
      };
    }
    p.setPaused(false);
  }, checkpoint);
}
async function query(text) {
  await page.$eval('.dowse-search input', input => { input.focus(); input.select(); });
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.type(text, { delay: 2 });
  await until(() => page.evaluate(() => document.querySelector('.dowse-body')?.getAttribute('aria-busy') === 'false'), "Search did not settle");
  await delay(200);
}
try {
  result.hardware = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter().catch(() => null);
    return { webgpu: adapter ? { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, description: adapter.info?.description } : null };
  });
  await page.evaluate(async () => {
    await app.plugins.loadManifests(); await app.plugins.enablePluginAndSave("obsidian-excalidraw-plugin");
  });
  await until(() => page.evaluate(() => !!app.plugins.plugins["obsidian-excalidraw-plugin"]?.packageManager), "Excalidraw runtime did not finish startup");
  await page.evaluate(async () => {
    const plugin = app.plugins.plugins["obsidian-excalidraw-plugin"], ea = new plugin.ea.constructor(plugin);
    try {
      ea.style.fontFamily = 2; ea.style.strokeColor = "#172554"; ea.style.backgroundColor = "#dcfce7";
      ea.addRect(0, 0, 600, 240); ea.style.fontSize = 32; ea.addText(30, 80, "Recovery checkpoint");
      const path = await ea.create({ filename: "Fixture", foldername: "Drawings", silent: true, plaintext: "Synthetic recovery drawing.", frontmatterKeys: { "excalidraw-plugin": "parsed" } });
      window.__drawing = path;
    } finally { ea.destroy?.(); }
    await app.plugins.plugins.dowse.openSearch();
  });
  await installEmbedder(true);
  await until(() => page.evaluate(() => window.__checkpoint === 300 && app.plugins.plugins.dowse.engine.status.state === "paused"), "Recording never saved and paused at its first checkpoint");
  result.checkpoint = await page.evaluate(async () => (await app.plugins.plugins.dowse.engine.store.file("Audio/Long.wav")).next);
  assert.equal(result.checkpoint, 300);
  await page.evaluate(async () => { await app.plugins.plugins.dowse.turnOff(false); });
  await installEmbedder(false);
  await until(() => page.evaluate(async () => {
    const e = app.plugins.plugins.dowse.engine, rows = await e.store.files();
    return e.status.state === "idle" && rows.length >= 30 && rows.every(r => r.state === "done");
  }), "Mixed vault failed to resume and finish", 300000);
  result.readers = await page.evaluate(async () => {
    const e = app.plugins.plugins.dowse.engine, segments = await e.store.segmentsOf("Audio/Long.wav"), over = await e.store.file("Audio/Over-limit.wav");
    return { decodePaths: window.__decodePaths, rows: (await e.store.files()).length, long: { count: segments.length, starts: segments.map(s => s.loc), lastEnd: segments.at(-1)?.locEnd },
      over: { state: over.state, info: over.info, segments: (await e.store.segmentsOf(over.path)).length } };
  });
  assert.equal(new Set(result.readers.long.starts).size, result.readers.long.count, "resuming must not duplicate windows");
  assert.ok(result.readers.long.starts.includes(300) && result.readers.long.starts.includes(600));
  assert.equal(result.readers.long.lastEnd, 620);
  assert.equal(result.readers.over.segments, 0);
  assert.match(result.readers.over.info.note, /safety limits/);
  assert.ok(!result.readers.decodePaths.includes('Audio/Over-limit.wav'), "over-limit recording must be rejected before decoding");
  result.stages.push("mixed readers, 620-second checkpoint/restart and metadata rejection");
  // A held response must not restore stale results after a human clears the query.
  await page.evaluate(() => {
    const c = app.plugins.plugins.dowse.controller; window.__realSearch = c.search;
    c.search = (q, ...args) => q === "heldfixture" ? new Promise(resolve => { window.__releaseHeld = () => resolve({ query: q, hits: [], strong: 0, terms: [], meaning: false, ms: 0 }); }) : window.__realSearch(q, ...args);
  });
  await page.type('.dowse-search input', "heldfixture");
  await until(() => page.evaluate(() => !!window.__releaseHeld), "Held response not requested");
  await query(""); await page.evaluate(() => window.__releaseHeld()); await delay(300);
  assert.equal(await page.$eval('.dowse-search input', el => el.value), "");
  assert.match(await page.$eval('.dowse-summary', el => el.textContent), /files/);
  await page.evaluate(() => {
    const c = app.plugins.plugins.dowse.controller;
    c.search = (q, ...args) => q === "closestfixture" ? Promise.resolve({ query: q, hits: [{ path: "Notes/Anchor.md", kind: "note", score: .5, z: 1, cosine: .2,
      keywordRank: null, segment: "passage", segmentId: 1, loc: 0, locEnd: 1, excerpt: "Recovery anchor", mtime: Date.now(), info: {}, moments: [], clear: false, evidence: [] }], strong: 0, terms: [], meaning: true, ms: 0 }) : window.__realSearch(q, ...args);
  });
  await query("closestfixture");
  await until(() => page.evaluate(() => /Nothing clearly matches/.test(document.querySelector('.dowse-summary')?.textContent)), "List claims a match");
  await page.click('[aria-label="As a wall"]');
  await page.waitForSelector('.wall canvas');
  await until(() => page.evaluate(() => !!document.querySelector('.wall .tag[data-relevance="closest"], .tag[data-relevance="closest"]')), "Wall claims a match");
  await page.click('[aria-label="Zoom in"]'); await delay(500);
  await until(() => page.evaluate(() => [...document.querySelectorAll('.wall .tag.dowse-visible')]
    .some(tag => Number(getComputedStyle(tag).opacity) > .9)), "Wall labels remain hidden after zoom");
  await page.screenshot({ path: join(artifacts, "wall.png") });
  await page.click('[aria-label="Explore: the whole vault"]');
  await page.waitForSelector('.floor canvas');
  await until(() => page.evaluate(() => !!document.querySelector('.rank-badge[data-relevance="closest"]')), "Explore claims a match");
  await page.click('.rank-badge[data-relevance="closest"]');
  await until(() => page.evaluate(() => [...document.querySelectorAll('.floor .case-tag.dowse-visible')]
    .some(tag => Number(getComputedStyle(tag).opacity) > .9)), "Explore labels remain hidden after selection");
  await query("");
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'By folder').click());
  await until(() => page.evaluate(() => /grouped by folder/.test(document.querySelector('.dowse-summary')?.textContent)), "Folder grouping did not load");
  await page.click('[aria-label="Closer"]'); await delay(500);
  await page.screenshot({ path: join(artifacts, "explore.png") });
  result.hardware.webgl = await page.$eval('.floor canvas', canvas => {
    const gl = canvas.getContext('webgl2'); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  await page.evaluate(() => app.commands.executeCommandById('dowse:search'));
  await page.waitForSelector('.prompt-input'); await page.type('.prompt-input', 'closestfixture');
  await until(() => page.evaluate(() => /Nothing clearly matches/.test(document.querySelector('.dowse-quick-status')?.textContent)), "Quick search claims a match");
  await page.keyboard.press('Escape');
  result.stages.push("stale-response suppression; closest confidence in List, Wall, Explore and Quick; native 3D and folder grouping");
  result.drawing = await page.evaluate(async () => {
    const p = app.plugins.plugins.dowse, path = window.__drawing, file = app.vault.getFileByPath(path);
    const hashes = [], dimensions = [], ea = app.plugins.plugins['obsidian-excalidraw-plugin'].ea;
    ea.addRect(2000, 2000, 20, 20); const workbench = JSON.stringify(ea.getElements());
    for (const dark of [false, true]) {
      document.body.toggleClass('theme-dark', dark); document.body.toggleClass('theme-light', !dark);
      const url = await p.controller.picture({ path, kind: 'note', loc: 0, key: path, name: 'Fixture' }, 680);
      if (!url) throw new Error('No drawing preview');
      const blob = await (await fetch(url)).blob();
      hashes.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join(''));
      const image = await createImageBitmap(blob); dimensions.push([image.width, image.height]); image.close();
    }
    p.controller.open({ path, kind: 'note', loc: 99, locEnd: null, info: {}, excerpt: null });
    return { path, dimensions, themeSpecific: hashes[0] !== hashes[1], sharedWorkbenchPreserved: JSON.stringify(ea.getElements()) === workbench, mtime: file.stat.mtime };
  });
  assert.deepEqual(result.drawing.dimensions, [[680, 500], [680, 500]]); assert.ok(result.drawing.themeSpecific);
  assert.ok(result.drawing.sharedWorkbenchPreserved);
  await until(() => page.evaluate(() => app.workspace.activeLeaf.view.getViewType() === 'excalidraw' && app.workspace.activeLeaf.view.file?.path === window.__drawing), "Drawing opened as Markdown");
  await delay(500); await page.screenshot({ path: join(artifacts, 'drawing.png') });
  result.stages.push("Excalidraw light/dark previews, whole drawing fit and native editor opening");
  assert.deepEqual(test.errors, []);
  result.errors = test.errors; result.consoleErrors = test.consoleErrors;
  await writeFile(join(artifacts, "results.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
  await writeFile(join(artifacts, "failure.json"), JSON.stringify({ error: error.stack, result, errors: test.errors, consoleErrors: test.consoleErrors }, null, 2)); throw error;
} finally { await test.close(); }
