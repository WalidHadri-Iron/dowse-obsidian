// Run a production plugin in an isolated real Obsidian profile. No user vault or model download is used.
// OBSIDIAN_EXECUTABLE=/path/to/Obsidian npm run smoke
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.OBSIDIAN_EXECUTABLE;
if (!executable || !existsSync(executable)) throw new Error("Set OBSIDIAN_EXECUTABLE to an installed Obsidian executable.");
const root = mkdtempSync(join(tmpdir(), "dowse-smoke-"));
console.log("Temporary smoke profile:", root);
const profile = join(root, "profile"), vault = join(root, "vault"), plugin = join(vault, ".obsidian", "plugins", "dowse");
const artifacts = resolve(process.env.DOWSE_SMOKE_ARTIFACTS ?? join(repo, ".cache", "smoke"));
mkdirSync(plugin, { recursive: true }); mkdirSync(profile, { recursive: true }); mkdirSync(artifacts, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join(repo, file), join(plugin, file));
writeFileSync(join(vault, ".obsidian", "community-plugins.json"), '["dowse"]');
writeFileSync(join(plugin, "data.json"), JSON.stringify({ on: false, off: [], images: false, sound: false }));
writeFileSync(join(profile, "obsidian.json"), JSON.stringify({ vaults: { dowseSmoke: { path: vault, ts: Date.now(), open: true } } }));
for (const [path, text] of Object.entries({
  "Private/Budget.md": "# Budget\nA confidential budget for the new project.",
  "Recipes/Tea.md": "# Herbal tea\nGinger and mint in hot water.",
  "Delete.md": "# Temporary\nA temporary note for file events.",
})) {
  mkdirSync(dirname(join(vault, path)), { recursive: true }); writeFileSync(join(vault, path), text);
}
const child = spawn(executable, [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-sandbox",
  "--disable-renderer-backgrounding", "--disable-background-timer-throttling"], {
  stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32",
});
let stderr = "";
child.stderr.on("data", b => { stderr += b.toString(); });
const errors = [];
let browser;
let page;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, message, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await pause(100); }
  throw new Error(message);
}
try {
  let endpoint;
  await until(() => { endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1]; return !!endpoint; }, "No debugger endpoint");
  browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
  writeFileSync(join(artifacts, "launch.json"), JSON.stringify({ root, endpoint, pid: child.pid }));
  await until(async () => { page = (await browser.pages()).find(p => p.url().startsWith("app://obsidian.md")); return !!page; }, "No Obsidian window");
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await until(async () => page.evaluate(() => {
    const trust = [...document.querySelectorAll("button")].find(b => /trust author/i.test(b.textContent));
    if (trust && !window.__dowseTestTrusted) { window.__dowseTestTrusted = true; trust.click(); }
    return !!window.app?.plugins?.plugins?.dowse?.fileEvents;
  }), "Plugin did not load");
  await until(() => page.evaluate(() => !!window.app?.workspace?.layoutReady), "Vault layout did not become ready");
  await page.evaluate(async () => { await app.plugins.plugins.dowse.openSearch(); });
  assert.equal(await page.$eval(".dowse-off", el => !!el), true);
  // Only the embedder is replaced. IndexedDB, the search worker, event handlers and the UI are production code.
  await page.evaluate(async () => {
    const p = app.plugins.plugins.dowse;
    p.paused = true; await p.turnOn();
    p.engine.indexer.options.embed = async () => ({
      texts: async prompts => prompts.map(() => Float32Array.from({ length: 768 }, (_, i) => Math.sin(i) / 20)),
      images: async () => [], audio: async () => [],
    });
    p.engine.search.model = { ready: () => null, wake: () => {} };
    p.setPaused(false); await p.engine.indexer.settled();
  });
  console.log("Vault indexed", await page.evaluate(async () => ({ status: app.plugins.plugins.dowse.engine.status,
    direct: (await app.plugins.plugins.dowse.engine.search.search("budget", {}, false)).hits.map(h => h.path) })));
  const inputBox = await page.$eval(".dowse-search input", el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(inputBox.x, inputBox.y); await page.keyboard.type("budget", { delay: 30 });
  await until(async () => page.evaluate(() => document.querySelector(".dowse-result-title")?.textContent.includes("Budget")), "Typed search failed");
  const lifecycle = await page.evaluate(async () => {
    const p = app.plugins.plugins.dowse;
    await p.setSearched("Private", false);
    const excluded = (await p.engine.search.search("budget", {}, false)).hits.length;
    await app.fileManager.renameFile(app.vault.getAbstractFileByPath("Private"), "Archive");
    await p.fileEvents.settled();
    const renamed = (await p.engine.search.search("budget", {}, false)).hits.length;
    const f = app.vault.getFileByPath("Delete.md");
    await app.vault.modify(f, "# Edited\nDeleted immediately."); await app.vault.delete(f);
    await new Promise(r => setTimeout(r, 2300));
    const ghost = !!(await p.engine.store.file("Delete.md"));
    return { excluded, renamed, ghost, off: p.settings.off };
  });
  assert.deepEqual(lifecycle, { excluded: 0, renamed: 0, ghost: false, off: ["Archive"] });
  const responsiveness = await page.evaluate(async () => {
    const engine = app.plugins.plugins.dowse.engine;
    const store = await engine.store.constructor.open("dowse-smoke-scale", "smoke"); await store.clear();
    const vector = Float16Array.from({ length: 768 }, (_, i) => Math.sin(i) / 20).buffer;
    for (let i = 0; i < 2000; i++) {
      const path = `Scale/note-${i}.md`;
      await store.saveStep({ path, kind: "note", mtime: i, size: 50, state: "done", info: {}, next: null, reader: 1 },
        Array.from({ length: 10 }, (_, j) => ({ path, kind: "passage", modality: "text", loc: j, locEnd: j,
          body: `Project ${i}: engineering documentation and design.`, vector })), true);
    }
    const search = new engine.search.constructor(store, { ready: () => null, wake: () => {} }, () => true,
      new engine.search.catalog.constructor(store.name));
    const tasks = [];
    const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
    observer.observe({ entryTypes: ["longtask"] });
    const began = performance.now(); const files = await search.recent(); const buildMs = performance.now() - began;
    await new Promise(resolve => setTimeout(resolve, 100)); observer.disconnect(); search.close();
    await store.clear(); store.close();
    return { files: files.length, vectors: 20000, buildMs, longestMainTaskMs: Math.max(0, ...tasks) };
  });
  assert.equal(responsiveness.files, 2000);
  assert.ok(responsiveness.longestMainTaskMs < 500, `Search preparation blocked the renderer: ${JSON.stringify(responsiveness)}`);
  console.log("Search worker responsiveness:", responsiveness);
  const collection = await page.evaluate(async () => {
    const p = app.plugins.plugins.dowse, c = p.controller;
    const recent = c.recent, active = c.active;
    try {
      c.recent = async () => Array.from({ length: 2000 }, (_, i) => ({ path: `Scale/note-${i}.md`, kind: "note",
        loc: null, locEnd: null, excerpt: "A note preview", info: {} }));
      c.active = () => true;
      document.querySelector('[aria-label="As a list"]').click();
      const input = document.querySelector(".dowse-search input"); input.value = ""; input.dispatchEvent(new Event("input"));
      await new Promise(resolve => setTimeout(resolve, 300));
      for (const follow of p.followers) follow();
      await new Promise(resolve => setTimeout(resolve, 300));
      const rows = document.querySelectorAll(".dowse-result").length;
      const summary = document.querySelector(".dowse-summary").textContent;
      const body = document.querySelector(".dowse-body"); body.scrollTop = body.scrollHeight; body.dispatchEvent(new Event("scroll"));
      await new Promise(resolve => setTimeout(resolve, 200));
      return { rows, summary, lastReachable: !!document.querySelector('.dowse-result[data-index="1999"]'),
        keyboardReachable: !!document.querySelector('.dowse-result[tabindex="0"]') };
    } finally {
      c.recent = recent; c.active = active;
      for (const follow of p.followers) follow();
    }
  });
  assert.match(collection.summary, /2,000 files/);
  assert.ok(collection.rows < 100 && collection.rows > 0, "large collections must render only visible rows");
  assert.equal(collection.lastReachable, true, "every file remains reachable by scrolling");
  assert.equal(collection.keyboardReachable, true, "the scrolled window retains a keyboard entry point");
  await page.evaluate(() => {
    document.body.removeClass("theme-light"); document.body.addClass("theme-dark"); app.workspace.trigger("css-change");
  });
  await Promise.race([page.screenshot({ path: join(artifacts, "dark.png") }), pause(8000)]);
  await page.evaluate(() => {
    document.body.removeClass("theme-dark"); document.body.addClass("theme-light"); app.workspace.trigger("css-change");
  });
  await Promise.race([page.screenshot({ path: join(artifacts, "light.png") }), pause(8000)]);
  await page.evaluate(async () => {
    const p = app.plugins.plugins.dowse;
    await p.turnOff(true); await p.turnOn();
    p.setPaused(true);
    if ((await p.engine.store.files()).length > 3) throw new Error("Stale index after rebuild");
    await p.turnOff(false);
  });
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ ok: true, lifecycle, responsiveness, collection, errors, root }, null, 2));
  console.log("Production Obsidian smoke passed:", artifacts);
} catch (error) {
  const state = await page?.evaluate(async () => {
    const p = window.app?.plugins?.plugins?.dowse;
    return { input: document.querySelector(".dowse-search input")?.value, body: document.querySelector(".dowse-panel")?.textContent,
      engine: p?.engine?.status, files: await p?.engine?.store.files(),
      direct: p?.engine ? await Promise.race([p.engine.search.search("budget", {}, false).catch(e => String(e)), new Promise(r => setTimeout(() => r("timed out"), 2000))]) : null };
  }).catch(e => ({ inspectionError: String(e) }));
  await Promise.race([page?.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {}), pause(5000)]);
  writeFileSync(join(artifacts, "failure.json"), JSON.stringify({ error: String(error), errors, stderr, root, state }, null, 2));
  throw error;
} finally {
  browser?.disconnect();
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  } else { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
}
