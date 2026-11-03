// Runs Obsidian (the one installed) with a profile and a vault of its own, never the user's, with the plugin in it:
// answers "trust this vault's plugins", waits for a file the plugin writes, keeps the console, takes screenshots, and
// closes Obsidian. For development on a Windows PC (a portable Node with puppeteer-core); CI uses scripts/smoke.mjs.
//
//   node obsidian-run.mjs --obsidian <Obsidian.exe> --profile <dir> --vault <dir> --wait <file in the vault>
//       [--timeout 600] [--shots <dir>] [--port 9333] [--every 60] [--eval <script>] [--drag <selector>] [--detach 1]
//
// `--eval`: a script run once in Obsidian's page when the plugin has loaded (the body of an async function, `app` at
// hand), for what the plugin can't measure of itself, such as how long Obsidian takes to load it.
//
// `--detach`: the debugger let go once the vault is trusted (nothing attached while the plugin works; no screenshots).
// `--steps <file>`: a tour, once the plugin has loaded (instead of waiting for a file): a JSON list of steps, each
// {"js": "…" (run in the page, `app` and `p` = the plugin at hand), "size": [w, h] (the window), "wait": ms,
// "shot": "name" (the main window), "settingsShot": "name" (Settings' own window)}.
// `--offline`: Obsidian without the internet (a proxy that isn't there): the model can't be downloaded.
// `--plain`: Obsidian started as a person starts it (no debugging port: the profile must trust the vault already).
//
// `--drag`: once the plugin's done, the mouse (real input) finds a case in the view `selector` (where the view shows a
// hand), clicks it, and drags it: what the drag carries is written to drag.json beside the screenshots.

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) =>
  value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []));
const port = Number(args.port ?? 9333);
const timeout = Number(args.timeout ?? 600) * 1000;
const shots = args.shots ?? join(args.vault, "..", "shots");
mkdirSync(args.profile, { recursive: true });
mkdirSync(shots, { recursive: true });
const log = join(shots, "console.log");
writeFileSync(log, "");

// The profile knows one vault, open
writeFileSync(join(args.profile, "obsidian.json"), JSON.stringify({
  vaults: { dowsetest0000001: { path: args.vault, ts: Date.now(), open: true } },
}));

const obsidian = spawn(args.obsidian, [`--user-data-dir=${args.profile}`, ...(args.plain ? [] : [`--remote-debugging-port=${port}`]),
                                       ...(args.offline ? ["--proxy-server=http://127.0.0.1:9"] : [])],
                       { detached: false, stdio: "ignore" });
const stop = () => { try { execSync(`taskkill /PID ${obsidian.pid} /T /F`, { stdio: "ignore" }); } catch {} };
process.on("exit", stop);
if (args.plain) {
  const waitFor = join(args.vault, args.wait), started = Date.now();
  while (Date.now() - started < timeout && !existsSync(waitFor)) await new Promise((r) => setTimeout(r, 1000));
  await new Promise((r) => setTimeout(r, 1000));
  console.log(existsSync(waitFor) ? readFileSync(waitFor, "utf8") : "timed out: no " + args.wait);
  stop();
  process.exit(0);
}

async function connect() {
  for (let i = 0; i < 120; i++) {
    try { return await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }); }
    catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error("Obsidian's debugging port never answered");
}

const browser = await connect();
let page = null;
for (let i = 0; i < 120 && !page; i++) {
  page = (await browser.pages()).find((p) => p.url().startsWith("app://obsidian.md")) ?? null;
  if (!page) await new Promise((r) => setTimeout(r, 500));
}
if (!page) throw new Error("no Obsidian window");
page.on("console", (message) => appendFileSync(log, `[${message.type()}] ${message.text()}\n`));
page.on("pageerror", (error) => appendFileSync(log, `[pageerror] ${error.message}\n`));

async function tour(steps) {
  for (const step of steps) {
    if (step.size) await page.evaluate(([w, h]) => {   // (Electron has no DevTools window bounds)
      try { const win = require("@electron/remote").getCurrentWindow(); win.unmaximize(); win.setSize(w, h); return; } catch {}
      try { const win = require("electron").remote.getCurrentWindow(); win.unmaximize(); win.setSize(w, h); return; } catch {}
      window.resizeTo(w, h);
    }, step.size).catch((error) => console.log("resize failed:", error.message));
    if (step.js) await page.evaluate(`(async () => { const p = app.plugins.plugins.dowse; ${step.js} })()`)
      .catch((error) => console.log(`step failed: ${step.js.slice(0, 80)}: ${error.message}`));
    await new Promise((r) => setTimeout(r, step.wait ?? 600));
    if (step.shot) await page.screenshot({ path: join(shots, `${step.shot}.png`) });
    if (step.settingsShot) {
      const other = (await browser.pages()).find((p) => p !== page && p.url() === "about:blank");
      if (other) await other.screenshot({ path: join(shots, `${step.settingsShot}.png`) });
      else console.log("no Settings window for", step.settingsShot);
    }
  }
}

async function dragFrom(selector) {
  const box = await page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const cursor = () => page.$eval(selector, (el) => el.style.cursor);
  let spot = null;
  for (let gy = 0.25; gy <= 0.75 && !spot; gy += 0.05) {
    for (let gx = 0.15; gx <= 0.85 && !spot; gx += 0.04) {
      const at = { x: Math.round(box.x + box.w * gx), y: Math.round(box.y + box.h * gy) };
      await page.mouse.move(at.x, at.y);
      await new Promise((r) => setTimeout(r, 80));
      if ((await cursor()) === "pointer") spot = at;
    }
  }
  if (!spot) throw new Error("no case under the mouse anywhere");
  await page.mouse.click(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: join(shots, "drag-picked.png") });
  await page.setDragInterception(true);
  const data = await Promise.race([page.mouse.drag(spot, { x: spot.x + 160, y: spot.y + 60 }),
                                   new Promise((r) => setTimeout(() => r(null), 5000))]);
  await page.mouse.up().catch(() => {});
  await page.setDragInterception(false);
  writeFileSync(join(shots, "drag.json"), JSON.stringify({ spot, items: data?.items ?? null, operations: data?.dragOperationsMask ?? null }));
}

const started = Date.now();
const waitFor = join(args.vault, args.wait);
let trusted = false, shot = 0, evaluated = !args.eval;
while (Date.now() - started < timeout) {
  if (!trusted && page) {   // "Do you trust the author of this vault?": yes (it's ours)
    trusted = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) => /trust author/i.test(b.textContent ?? ""));
      if (button) button.click();
      return Boolean(button);
    }).catch(() => false);
    if (trusted && args.detach) { await browser.disconnect(); page = null; }
  }
  if (!evaluated && page && await page.evaluate(() => Boolean(window.app?.plugins?.plugins?.dowse)).catch(() => false)) {
    evaluated = true;
    const body = readFileSync(args.eval, "utf8");
    page.evaluate(`(async () => { ${body} })()`).catch((error) => appendFileSync(log, `[eval] ${error.message}\n`));
  }
  if (args.steps && evaluated !== "toured" && await page.evaluate(() => Boolean(window.app?.plugins?.plugins?.dowse)).catch(() => false)) break;
  if (existsSync(waitFor)) {
    try { if (JSON.parse(readFileSync(waitFor, "utf8")).done) break; } catch {}
  }
  if (page && (Date.now() - started) / (Number(args.every ?? 60) * 1000) > shot) {   // a screenshot every so often (a minute)
    await page.screenshot({ path: join(shots, `progress-${shot}.png`) }).catch(() => {});
    shot++;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!page) {   // (detached)
  console.log(existsSync(waitFor) ? readFileSync(waitFor, "utf8") : "timed out: no " + args.wait);
  stop();
  process.exit(0);
}
if (args.steps) await tour(JSON.parse(readFileSync(args.steps, "utf8"))).catch((error) => console.log("tour failed:", error.message));
if (args.drag) await dragFrom(args.drag).catch((error) => writeFileSync(join(shots, "drag.json"), JSON.stringify({ error: error.message })));
await page.screenshot({ path: join(shots, "final.png") }).catch(() => {});
// Obsidian's other windows (Settings opens in its own since 1.14, a note popped out: about:blank pages the main
// window draws into): one picture each
const others = (await browser.pages()).filter((p) => p !== page && /^(app:\/\/obsidian\.md|about:blank)/.test(p.url()));
for (const [i, other] of others.entries()) await other.screenshot({ path: join(shots, `window-${i}.png`) }).catch(() => {});
console.log(existsSync(waitFor) ? readFileSync(waitFor, "utf8") : "timed out: no " + args.wait);
browser.disconnect();
stop();
process.exit(0);
