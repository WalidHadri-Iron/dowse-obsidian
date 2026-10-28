// Runs Obsidian (the one installed) with a profile and a vault of its own, never the user's, with the plugin in it:
// answers "trust this vault's plugins", waits for a file the plugin writes, keeps the console, takes screenshots, and
// closes Obsidian. For development on a Windows PC (a portable Node with puppeteer-core); CI uses wdio-obsidian-service.
//
//   node obsidian-run.mjs --obsidian <Obsidian.exe> --profile <dir> --vault <dir> --wait <file in the vault>
//       [--timeout 600] [--shots <dir>] [--port 9333]

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

const obsidian = spawn(args.obsidian, [`--user-data-dir=${args.profile}`, `--remote-debugging-port=${port}`],
                       { detached: false, stdio: "ignore" });
const stop = () => { try { execSync(`taskkill /PID ${obsidian.pid} /T /F`, { stdio: "ignore" }); } catch {} };
process.on("exit", stop);

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

const started = Date.now();
const waitFor = join(args.vault, args.wait);
let trusted = false, shot = 0;
while (Date.now() - started < timeout) {
  if (!trusted) {   // "Do you trust the author of this vault?": yes (it's ours)
    trusted = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) => /trust author/i.test(b.textContent ?? ""));
      if (button) button.click();
      return Boolean(button);
    }).catch(() => false);
  }
  if (existsSync(waitFor)) {
    try { if (JSON.parse(readFileSync(waitFor, "utf8")).done) break; } catch {}
  }
  if ((Date.now() - started) / 60000 > shot) {   // a screenshot a minute, to see where it is
    await page.screenshot({ path: join(shots, `progress-${shot}.png`) }).catch(() => {});
    shot++;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await page.screenshot({ path: join(shots, "final.png") }).catch(() => {});
console.log(existsSync(waitFor) ? readFileSync(waitFor, "utf8") : "timed out: no " + args.wait);
browser.disconnect();
stop();
process.exit(0);
