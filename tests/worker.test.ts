import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { MODEL_REVISION } from "../src/engine/protocol.ts";

// Exercise the actual worker coordinator with small runtime doubles: no model download or GPU required.
const bundled = build({
  entryPoints: [fileURLToPath(new URL("../src/engine/worker.ts", import.meta.url))], bundle: true, write: false,
  platform: "browser", format: "iife", target: "es2022",
  plugins: [{ name: "runtime-double", setup(build) {
    build.onResolve({ filter: /^(@huggingface\/transformers|onnxruntime-web\/webgpu)$/ }, args => ({ path: args.path, namespace: "double" }));
    build.onLoad({ filter: /.*/, namespace: "double" }, args => ({ contents: args.path.startsWith("onnxruntime")
      ? "export const env = { wasm: {}, webgpu: {} };"
      : `export const env = {};
         const revision = o => self.revisions.push(o.revision);
         export const AutoProcessor = { from_pretrained: async (_, o) => { revision(o); return Object.assign(async texts => ({ texts }), { image_processor: {} }); } };
         export const AutoConfig = { from_pretrained: async (_, o) => { revision(o); return { vision_config: {}, audio_config: {} }; } };
         export const AutoModel = { from_pretrained: async (_, o) => {
           revision(o); self.devices.push(o.device);
           if (o.device === 'webgpu' && self.failLoad) throw new Error('driver cannot start');
           const run = async input => {
             self.active++; self.maxActive = Math.max(self.maxActive, self.active);
             try { await new Promise(r => setTimeout(r, 5));
               if (o.device === 'webgpu' && self.failCompute) throw new Error('GPU lost');
               return { sentence_embedding: { data: new Float32Array(input.texts.length * 768).fill(.1) } };
             } finally { self.active--; }
           };
           run.dispose = async () => {}; return run;
         } };
         export class RawImage {}`,
      loader: "js" }));
  } }],
}).then(result => result.outputFiles[0].text);

async function worker(options: { adapterThrows?: boolean; failLoad?: boolean; failCompute?: boolean } = {}) {
  const answers: any[] = [];
  const self: any = { active: 0, maxActive: 0, devices: [], revisions: [], ...options, postMessage: (m: unknown) => answers.push(m) };
  runInNewContext(await bundled, { self, navigator: { hardwareConcurrency: 4, gpu: { requestAdapter: async () => {
    if (options.adapterThrows) throw new Error("adapter unavailable");
    return { info: { vendor: "test", description: "test GPU" } };
  } } }, URL: { createObjectURL: () => "blob:test" }, Blob, SharedArrayBuffer, setTimeout, Float32Array, Uint8ClampedArray });
  const wait = async (id: number) => {
    for (let i = 0; i < 200; i++) {
      const answer = answers.find(m => m.id === id);
      if (answer) { assert.equal(answer.op, "done", answer.message); return answer.result; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error("worker did not answer");
  };
  const send = (data: unknown) => self.onmessage({ data });
  send({ op: "load", id: 1, dtype: "fp16", device: "auto", parts: { image: false, audio: false }, wasmBinary: new ArrayBuffer(8), glue: "" });
  const loaded = await wait(1);
  return { self, answers, send, wait, loaded };
}

test("a rejected GPU adapter and a GPU startup failure both fall back to the processor", async () => {
  for (const options of [{ adapterThrows: true }, { failLoad: true }]) {
    const { loaded, self } = await worker(options);
    assert.equal(loaded.device, "wasm");
    assert.ok(self.revisions.every((r: string) => r === MODEL_REVISION), "every model part uses the pinned revision");
  }
});

test("a lost GPU retries computation on the processor and announces the changed device", async () => {
  const { loaded, answers, send, wait } = await worker({ failCompute: true });
  assert.equal(loaded.device, "webgpu");
  send({ op: "embed", id: 2, texts: ["query"] });
  assert.equal((await wait(2))[0].length, 768);
  assert.ok(answers.some(m => m.op === "device" && m.device === "wasm"));
});

test("indexing and search cannot enter the same model session concurrently", async () => {
  const { self, send, wait } = await worker();
  send({ op: "embed", id: 2, texts: ["document"] });
  send({ op: "embed", id: 3, texts: ["query"] });
  await Promise.all([wait(2), wait(3)]);
  assert.equal(self.maxActive, 1);
});


test("worker bootstrap removes Node detection without accessing a browser window", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../src/engine/web-only.ts", import.meta.url))],
    bundle: true, write: false, format: "iife", globalName: "Bootstrap", platform: "browser" });
  const context: any = { process: { versions: { node: "test" } } };
  context.self = context;
  runInNewContext(result.outputFiles[0].text, context);
  assert.equal(context.process, undefined);
  assert.equal(context.window, undefined);
  context.process = { versions: { node: "thread" } };
  runInNewContext(context.Bootstrap.WEB_ONLY, context);
  assert.equal(context.process, undefined, "the serialized bootstrap works in runtime child workers too");
});
