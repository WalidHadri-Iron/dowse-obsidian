import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { MODEL_REPO, MODEL_REVISION } from "../../src/engine/protocol.ts";

/** Seed only verified public model data into this disposable browser profile. No user CacheStorage is copied. */
export async function seedModelCache(page, parts = "text") {
  if (!process.env.DOWSE_MODEL_CACHE && !process.env.DOWSE_MODEL_MANIFEST) return { mode: "normal model download" };
  const metadata = await (await fetch(`https://huggingface.co/api/models/${MODEL_REPO}/revision/${MODEL_REVISION}?blobs=true`)).json();
  const manifest = process.env.DOWSE_MODEL_MANIFEST ? JSON.parse(await readFile(process.env.DOWSE_MODEL_MANIFEST, "utf8")) : null;
  const names = ["config.json", "config_sentence_transformers.json", "chat_template.jinja", "preprocessor_config.json",
    "processor_config.json", "tokenizer_config.json", "tokenizer.json", "onnx/model_fp16.onnx", "onnx/model_fp16.onnx_data"];
  if (parts === "all") names.push("onnx/audio_encoder_fp16.onnx", "onnx/audio_encoder_fp16.onnx_data", "onnx/vision_encoder_fp16.onnx", "onnx/vision_encoder_fp16.onnx_data");
  const files = [];
  for (const name of names) {
    let path = process.env.DOWSE_MODEL_CACHE ? join(process.env.DOWSE_MODEL_CACHE, name) : manifest.find(f => f.name === name)?.path;
    if (!path) throw new Error(`Local model file missing: ${name}`);
    if (process.platform !== "win32" && path.startsWith("\\\\wsl.localhost\\Ubuntu\\")) path = "/" + path.slice("\\\\wsl.localhost\\Ubuntu\\".length).replaceAll("\\", "/");
    const entry = metadata.siblings.find(f => f.rfilename === name);
    if (!entry) throw new Error(`File is not part of the pinned model revision: ${name}`);
    const size = (await stat(path)).size, sha = entry.lfs?.sha256;
    const hash = createHash(sha ? "sha256" : "sha1");
    if (!sha) hash.update(`blob ${size}\0`);
    for await (const part of createReadStream(path)) hash.update(part);
    if (hash.digest("hex") !== (sha ?? entry.blobId)) throw new Error(`Model data failed revision verification: ${name}`);
    files.push({ name, path, size, url: `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${name}` });
  }
  const server = createServer((request, response) => {
    const match = /^\/data\/(\d+)$/.exec(request.url), file = match ? files[Number(match[1])] : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": file.name.endsWith(".json") ? "application/json" : "application/octet-stream",
      "Content-Length": file.size, "Access-Control-Allow-Origin": "*" });
    createReadStream(file.path).on("error", error => response.destroy(error)).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await page.evaluate(async ({ port, files }) => {
      const cache = await caches.open("transformers-cache");
      for (const [i, file] of files.entries()) {
        if (await cache.match(file.url)) continue;
        const response = await fetch(`http://127.0.0.1:${port}/data/${i}`);
        if (!response.ok) throw new Error(`Local model cache failed: ${file.name}`);
        await cache.put(file.url, response);
      }
    }, { port: server.address().port, files: files.map(({ name, url }) => ({ name, url })) });
  } finally { server.close(); }
  return { mode: "verified local model data", revision: MODEL_REVISION, files: files.map(f => ({ name: f.name, bytes: f.size })) };
}
