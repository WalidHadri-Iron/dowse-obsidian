import { spawn, execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(test, message, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await delay(100); }
  throw new Error(message);
}

/** A disposable real Obsidian install/profile; never attaches to the person's open vault. */
export async function native(label, prepare = async () => {}) {
  const executable = process.env.OBSIDIAN_EXECUTABLE;
  if (!executable) throw new Error("Set OBSIDIAN_EXECUTABLE to an installed Obsidian executable.");
  const root = await mkdtemp(join(tmpdir(), `dowse-${label}-`));
  const profile = join(root, "profile"), vault = join(root, "vault"), plugin = join(vault, ".obsidian/plugins/dowse");
  const artifacts = resolve(process.env.DOWSE_ARTIFACTS ?? join(repo, ".cache/release-validation", `${label}-${process.platform}`));
  await mkdir(plugin, { recursive: true }); await mkdir(profile); await mkdir(artifacts, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css"]) await copyFile(join(repo, file), join(plugin, file));
  await writeFile(join(vault, ".obsidian/community-plugins.json"), '[]');
  await writeFile(join(plugin, "data.json"), JSON.stringify({ on: false, off: [], images: false, sound: false, batteryPause: false }));
  await writeFile(join(profile, "obsidian.json"), JSON.stringify({ vaults: { dowseTest: { path: vault, ts: Date.now(), open: true } } }));
  await prepare(vault);
  const child = spawn(executable, [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-sandbox",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    ...(process.env.DOWSE_NATIVE_SOFTWARE === "1" ? ["--disable-gpu"] : [])], {
    stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32",
  });
  let stderr = "", browser;
  child.stderr?.on("data", bytes => { stderr += bytes.toString(); });
  const errors = [], consoleErrors = [];
  const close = async () => {
    browser?.disconnect();
    if (process.platform === "win32") {
      try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      await delay(500);
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
    }
    await writeFile(join(artifacts, "browser.log"), stderr);
    if (process.env.DOWSE_KEEP_PROFILE !== "1") await rm(root, { recursive: true, force: true }).catch(() => {});
  };
  try {
    let endpoint;
    await until(() => { endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1]; return !!endpoint; }, "Obsidian debugger did not start");
    browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
    let page;
    await until(async () => { page = (await browser.pages()).find(p => p.url().startsWith("app://obsidian.md")); return !!page; }, "Obsidian did not open the test vault");
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await until(() => page.evaluate(() => {
      const trust = [...document.querySelectorAll("button")].find(b => /trust author/i.test(b.textContent));
      if (trust && !window.__dowseTestTrusted) { window.__dowseTestTrusted = true; trust.click(); }
      return !!window.app?.workspace?.layoutReady && !!app.plugins?.manifests?.dowse;
    }), "The test vault did not finish startup");
    // Enabling the known production bundle after startup avoids racing Obsidian's initial plugin loader/trust UI.
    // The empty persisted plugin list also prevents an automatic load from overlapping this explicit one.
    await page.evaluate(async () => {
      if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
      await app.plugins.enablePluginAndSave("dowse");
    });
    await until(() => page.evaluate(() => !!app.plugins.plugins.dowse?.controller), "The production plugin did not load");
    await writeFile(join(artifacts, "launch.json"), JSON.stringify({ platform: process.platform, executable, root, pid: child.pid }));
    return { page, browser, root, profile, vault, artifacts, errors, consoleErrors, close };
  } catch (error) { await close(); throw error; }
}

export async function fakeIndexer(page, milliseconds = 2) {
  await page.evaluate(async ms => {
    const p = app.plugins.plugins.dowse;
    p.paused = true; await p.turnOn();
    p.engine.indexer.options.embed = async () => ({
      texts: async prompts => {
        await new Promise(resolve => setTimeout(resolve, ms));
        return prompts.map(text => { const vector = new Float32Array(768); for (let i = 0; i < text.length; i++) vector[(text.charCodeAt(i) + i) % 768] += .01; return vector; });
      }, images: async () => [], audio: async () => [],
    });
    p.engine.search.model = { ready: () => null, wake: () => {} };
    p.setPaused(false);
  }, milliseconds);
}
