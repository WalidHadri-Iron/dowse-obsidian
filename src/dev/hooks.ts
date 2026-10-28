// Development builds only (`node esbuild.config.mjs dev`): a test vault asks for things by the notes it holds, and the
// plugin answers in files beside them, for scripts/obsidian-run.mjs to read.
//
//   dowse-measure.json  → the model measured against Dowse's reference (dowse-measure-result.json)
//   dowse-dev.json      → Dowse turned on without asking; once the vault is read, dowse-dev-result.json: what's in
//                         the index, how long reading took, where the model ran

import type DowsePlugin from "../main.ts";
import { measureIfAsked } from "./measure.ts";

export async function run(plugin: DowsePlugin): Promise<void> {
  const { adapter } = plugin.app.vault;
  await measureIfAsked(plugin.app);
  if (!(await adapter.exists("dowse-dev.json"))) return;
  const started = performance.now();
  if (!plugin.settings.on) await plugin.turnOn();
  const engine = plugin.engine!;
  await engine.indexer.settled();
  const files = await engine.store.files();
  const segments = await engine.store.segments();
  await adapter.write("dowse-dev-result.json", JSON.stringify({
    done: true,
    seconds: (performance.now() - started) / 1000,
    model: engine.model,
    status: engine.status,
    files: files.map((f) => ({ path: f.path, state: f.state, detail: f.detail, info: f.info })),
    segments: segments.map((s) => ({ path: s.path, kind: s.kind, loc: s.loc, locEnd: s.locEnd,
                                     vector: s.vector ? s.vector.byteLength : null, body: s.body.slice(0, 80) })),
  }, null, 1));
}
