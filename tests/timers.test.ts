import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = build({ entryPoints: [fileURLToPath(new URL("../src/engine/timers.ts", import.meta.url))],
  bundle: true, write: false, format: "iife", globalName: "Timers", platform: "browser" })
  .then(result => result.outputFiles[0].text);

for (const environment of ["window", "worker"]) {
  test(`timeouts use the owning ${environment} and cancel there after the active host changes`, async () => {
    const events: unknown[] = [];
    const owner = {
      setTimeout(callback: () => void, ms: number) { assert.equal(this, owner); events.push(ms); return 17; },
      clearTimeout(handle: number) { assert.equal(this, owner); events.push(handle); },
    };
    const other = { setTimeout() { throw new Error("wrong host"); }, clearTimeout() { throw new Error("wrong host"); } };
    const context: Record<string, any> = environment === "window" ? { window: owner, self: other } : { self: owner };
    runInNewContext(await bundled, context);
    const cancel = context.Timers.after(() => {}, 150);
    if (environment === "window") context.window = other; else context.self = other;
    cancel();
    assert.deepEqual(events, [150, 17]);
  });
}
