// Native CPU/automatic inference + actual indexing/search. May download the text model unless a verified cache is
// supplied with DOWSE_MODEL_CACHE or DOWSE_MODEL_MANIFEST. The default smoke test never downloads a model.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { native, until } from "./lib/native.mjs";
import { seedModelCache } from "./lib/model-cache.mjs";
const test = await native("model", async vault => {
  for (const [path, text] of Object.entries({
    "Travel/Lisbon.md": "# Weekend in Lisbon\nWe rode the yellow tram through Alfama and walked beside the Tagus river. We stopped in Belem for custard pastries.",
    "Kitchen/Soup.md": "# Lentil soup\nCook red lentils, carrots, celery and cumin in vegetable stock. Add lemon juice before serving.",
    "Engineering/Recovery.md": "# Recovery\nLogin failed because the authentication certificate expired. Rotate the certificate, verify login and automate renewal.",
  })) { await mkdir(dirname(join(vault, path)), { recursive: true }); await writeFile(join(vault, path), text); }
});
try {
  const cache = await seedModelCache(test.page);
  console.log("Model cache:", cache.mode);
  await test.page.evaluate(async device => {
    const p = app.plugins.plugins.dowse; p.settings.device = device; await p.save(); await p.turnOn();
  }, process.env.DOWSE_MODEL_DEVICE === "auto" ? "auto" : "wasm");
  await until(() => test.page.evaluate(() => {
    const e = app.plugins.plugins.dowse.engine;
    if (e.model.state === "failed") throw new Error(e.model.error);
    return e.model.state === "ready" && e.status.state === "idle";
  }), "Real model did not finish indexing", 900000);
  const result = await test.page.evaluate(async () => {
    const p = app.plugins.plugins.dowse;
    const queries = [];
    for (const q of ["Portuguese tram and pastries", "cooking lentils with vegetables", "expired login certificate"]) {
      const answer = await p.engine.search.search(q); queries.push({ q, strong: answer.strong, paths: answer.hits.map(h => h.path) });
    }
    return { platform: navigator.platform, model: p.engine.model, status: p.engine.status, queries };
  });
  assert.equal(result.status.failed, 0);
  assert.equal(result.status.done, 3);
  assert.ok(result.queries.every(q => q.strong > 0), "real inference returns clear matches");
  for (const [i, path] of ["Travel/Lisbon.md", "Kitchen/Soup.md", "Engineering/Recovery.md"].entries()) assert.equal(result.queries[i].paths[0], path);
  assert.deepEqual(test.errors, []);
  await writeFile(join(test.artifacts, "results.json"), JSON.stringify({ ...result, cache, errors: test.errors }, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  const state = await test.page.evaluate(() => {
    const e = app.plugins.plugins.dowse?.engine;
    return { model: e?.model, status: e?.status };
  }).catch(() => null);
  await writeFile(join(test.artifacts, "failure.json"), JSON.stringify({ error: error.stack, state,
    errors: test.errors, consoleErrors: test.consoleErrors }, null, 2));
  throw error;
} finally { await test.close(); }
