// Native regression: the declarative settings host must rerender after enabling/disabling.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { native, until } from "./lib/native.mjs";
const test = await native("settings", vault => writeFile(join(vault, "Note.md"), "# Synthetic test note\n"));
const { page, artifacts } = test;
const result = { platform: process.platform, stages: [] };
try {
  await page.evaluate(() => {
    const p = app.plugins.plugins.dowse;
    p.paused = true; // No model downloads: exercise the real engine, held by the user's pause state.
    app.setting.open(); app.setting.openTabById("dowse");
  });
  let settingsPage;
  await until(async () => {
    for (const candidate of await test.browser.pages()) {
      if (await candidate.evaluate(() => !!document.querySelector('.dowse-settings'))) { settingsPage = candidate; return true; }
    }
    return false;
  }, "Settings window did not render");
  if (settingsPage !== page) settingsPage.on("pageerror", error => test.errors.push(error.message));
  const button = async text => {
    await until(() => settingsPage.evaluate(text => [...document.querySelectorAll('.dowse-settings button')].some(b => b.textContent === text), text), `Missing settings button: ${text}`);
    await settingsPage.evaluate(text => [...document.querySelectorAll('.dowse-settings button')].find(b => b.textContent === text).click(), text);
  };
  await button("Turn on");
  await until(() => settingsPage.evaluate(() => !!document.querySelector('.dowse-settings-top')), "Settings did not rerender after turning on");
  assert.equal(await page.evaluate(() => app.plugins.plugins.dowse.settings.on), true);
  await settingsPage.evaluate(() => {
    const row = [...document.querySelectorAll('.dowse-settings .setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === "Run the model on");
    const select = row.querySelector('select'); select.value = "wasm"; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(() => page.evaluate(() => app.plugins.plugins.dowse.settings.device === "wasm"), "Processor setting not saved");
  result.stages.push("enable from settings; render live status; change processor preference without a download");
  await button("Turn off, keep the index");
  await until(() => settingsPage.evaluate(() => [...document.querySelectorAll('.dowse-settings button')].some(b => b.textContent === "Turn on")), "Settings did not rerender after turning off");
  result.stages.push("disable and return to the opt-in screen");
  result.preferences = await page.evaluate(() => {
    const c = app.plugins.plugins.dowse.controller;
    c.savePreference("dowse-layout", "wall");
    return { saved: c.loadPreference("dowse-layout", "list"), missing: c.loadPreference("dowse-settings-absent", "fallback"), hostValue: app.loadLocalStorage("dowse-layout") };
  });
  assert.deepEqual(result.preferences, { saved: "wall", missing: "fallback", hostValue: "wall" });
  result.stages.push("vault-scoped view preferences use the host storage API");
  await settingsPage.screenshot({ path: join(artifacts, "settings.png") });
  assert.deepEqual(test.errors, []);
} finally {
  result.errors = test.errors; result.consoleErrors = test.consoleErrors;
  await writeFile(join(artifacts, "results.json"), JSON.stringify(result, null, 2));
  await test.close();
}
