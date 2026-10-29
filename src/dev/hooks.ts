// Development builds only (`node esbuild.config.mjs dev`): a test vault asks for things by the notes it holds, and the
// plugin answers in files beside them, for scripts/obsidian-run.mjs to read.
//
//   dowse-measure.json  → the model measured against Dowse's reference (dowse-measure-result.json)
//   dowse-dev.json      → Dowse turned on without asking; once the vault is read, dowse-dev-result.json: what's in
//                         the index, how long reading took, where the model ran. It may ask for more:
//                         {"searches": ["…"], "view": "a query" (the Dowse tab opened on it), "layout": "wall" | "list" | "map",
//                          "similar": "path of a note" (the sidebar opened on it), "quick": "a query" (Quick search,
//                          typed into), "images": true, "sound": true (the model's parts turned on first),
//                          "graphics": true | false (Windows' graphics card preference for Obsidian set, at the end),
//                          "settings": true (Settings › Dowse opened), "settingsFirst": true (opened before reading),
//                          "settingsBottom": true (scrolled to its end)}
//                         The result also has reading's status every 2 s while the vault was read (`timeline`: how
//                         far, and the time left it told), and the model's size in the cache.
//   dowse-first.json     → Dowse left off, its tab opened (the first screen); dowse-dev-result.json once drawn

import type DowsePlugin from "../main.ts";
import { measureIfAsked } from "./measure.ts";
import { QuickSearch } from "../plugin/views.ts";
import { prefer, preferred, situation } from "../plugin/graphics.ts";
import { modelBytes } from "../plugin/disk.ts";

export async function run(plugin: DowsePlugin): Promise<void> {
  const { adapter } = plugin.app.vault;
  await measureIfAsked(plugin.app);
  if (await adapter.exists("dowse-first.json")) {
    await plugin.openSearch();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await adapter.write("dowse-dev-result.json", JSON.stringify({ done: true, on: plugin.settings.on }));
    return;
  }
  if (!(await adapter.exists("dowse-dev.json"))) return;
  const started = performance.now();
  const timeline: { t: number; state: string; done: number; total: number; left: number | null }[] = [];
  const sample = window.setInterval(() => {
    const status = plugin.engine?.status;
    if (status) timeline.push({ t: Math.round((performance.now() - started) / 100) / 10, state: status.state,
                                done: status.done, total: status.total, left: status.left ?? null });
  }, 2000);
  const wanted = JSON.parse(await adapter.read("dowse-dev.json") || "{}") as { images?: boolean; sound?: boolean };
  if (wanted.images !== undefined || wanted.sound !== undefined) await plugin.setParts({ images: wanted.images, sound: wanted.sound });
  const early = wanted as { view?: string; layout?: string };
  if (early.layout) localStorage.setItem("dowse-layout", early.layout);   // (before the tab is open)
  if (early.view !== undefined) await plugin.openSearch(early.view);   // (open while the vault is read)
  if ((wanted as { settingsFirst?: boolean }).settingsFirst) plugin.openSettings();   // (open while the vault is read)
  if (!plugin.settings.on) await plugin.turnOn();
  const engine = plugin.engine!;
  await engine.indexer.settled();
  window.clearInterval(sample);
  const read = (performance.now() - started) / 1000;
  const asked = JSON.parse(await adapter.read("dowse-dev.json") || "{}") as
    { searches?: string[]; view?: string; layout?: string; similar?: string; quick?: string; graphics?: boolean; settings?: boolean;
      settingsBottom?: boolean };
  await engine.search.search("warm up");   // the model (and the probes) ready before what's timed
  const searches = [];
  for (const query of asked.searches ?? []) {
    const answer = await engine.search.search(query);
    searches.push({ query, ms: answer.ms, meaning: answer.meaning, strong: answer.strong,
                    hits: answer.hits.slice(0, 5).map((h) => ({ path: h.path, loc: h.loc, z: h.z, clear: h.clear,
                                                                excerpt: h.excerpt, evidence: h.evidence })) });
  }
  if (asked.layout) localStorage.setItem("dowse-layout", asked.layout);
  if (asked.similar) {
    const file = plugin.app.vault.getFileByPath(asked.similar);
    if (file) await plugin.app.workspace.getLeaf(false).openFile(file);
    await plugin.openSimilar();
  }
  if (asked.view !== undefined) await plugin.openSearch(asked.view);
  if (asked.settings) plugin.openSettings();
  if (asked.settingsBottom) window.setTimeout(() => {   // (Settings › Dowse scrolled to its end, for its screenshot)
    const tab = (plugin.app as any).setting?.activeTab;
    for (let el = tab?.containerEl as HTMLElement | null; el; el = el.parentElement) el.scrollTop = el.scrollHeight;
  }, 1500);
  if (asked.quick !== undefined) {
    const modal = new QuickSearch(plugin.app, plugin.controller);
    modal.open();
    modal.inputEl.value = asked.quick;
    modal.inputEl.dispatchEvent(new Event("input"));
  }
  await new Promise((resolve) => setTimeout(resolve, 4000));   // the views draw (the wall loads its pictures)
  const files = await engine.store.files();
  const segments = await engine.store.segments();
  const graphics = { ...(await situation(engine.model.gpu)), preferred: await preferred(), set: asked.graphics };
  if (asked.graphics !== undefined) await prefer(asked.graphics);
  await adapter.write("dowse-dev-result.json", JSON.stringify({
    done: true,
    seconds: (performance.now() - started) / 1000,
    read,
    timeline,
    modelBytes: await modelBytes(),
    index: await engine.store.size(),
    vectors: segments.filter((s) => s.vector).length,
    graphics,
    model: engine.model,
    status: engine.status,
    searches,
    files: files.map((f) => ({ path: f.path, state: f.state, detail: f.detail, info: f.info })),
    segments: segments.map((s) => ({ path: s.path, kind: s.kind, loc: s.loc, locEnd: s.locEnd,
                                     vector: s.vector ? s.vector.byteLength : null, body: s.body.slice(0, 80) })),
  }, null, 1));
}
