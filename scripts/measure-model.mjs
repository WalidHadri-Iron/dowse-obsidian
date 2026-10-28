// How close EmbeddingGemma 2's ONNX builds (transformers.js) come to Dowse's reference vectors, and how fast each runs
// here (Node, on the processor): the measurement that chooses the build the plugin downloads.
//
//   node scripts/measure-model.mjs [q4 q4f16 quantized fp16 ...]
//
// tests/reference holds Dowse's reference vectors (llama.cpp, its Q8 GGUF) and their inputs: the texts with their
// prompts, the images already sized for their token budgets (as Dowse sizes them), and the speech as 16 kHz samples.
// A build here is measured by each input's cosine with its reference, and by whether each query still finds its own
// input (Dowse's test: a vector can be close yet point elsewhere).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";

const MODEL = "onnx-community/embeddinggemma-2-ONNX";
const HERE = new URL("..", import.meta.url).pathname;
const REFERENCE = join(HERE, "tests", "reference");
env.cacheDir = join(HERE, ".cache", "models");

const reference = JSON.parse(readFileSync(join(REFERENCE, "vectors.json"), "utf8")).vectors;
const { texts } = JSON.parse(readFileSync(join(REFERENCE, "inputs.json"), "utf8"));
const IMAGES = { "screen-280": 280, "landscape-140": 140, "frame-70": 70 };
const speech = new Float32Array(readFileSync(join(REFERENCE, "speech-16k.f32")).buffer.slice(0));

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
};

async function measure(dtype) {
  const started = performance.now();
  const processor = await AutoProcessor.from_pretrained(MODEL);
  const model = await AutoModel.from_pretrained(MODEL, { device: "cpu", dtype });
  const loaded = performance.now() - started;
  const embed = async (...inputs) => (await model(await processor(...inputs))).sentence_embedding;
  const made = {}, seconds = {};
  for (const [name, text] of Object.entries(texts)) {
    const t = performance.now();
    made[name] = Array.from((await embed([text])).data);
    seconds[name] = (performance.now() - t) / 1000;
  }
  for (const [name, budget] of Object.entries(IMAGES)) {
    processor.image_processor.max_soft_tokens = budget;   // the image is already sized for it: no resize
    const image = await RawImage.read(join(REFERENCE, `${name}.png`));
    const t = performance.now();
    made[name] = Array.from((await embed(null, [[image]])).data);
    seconds[name] = (performance.now() - t) / 1000;
  }
  const t = performance.now();
  made.speech = Array.from((await embed(null, null, [[speech]])).data);
  seconds.speech = (performance.now() - t) / 1000;

  const agreement = Object.fromEntries(Object.keys(reference).map((n) => [n, cosine(made[n], reference[n])]));
  const best = (query) => ["screen-280", "landscape-140", "speech", "document"]
    .reduce((a, b) => (cosine(made[query], made[a]) >= cosine(made[query], made[b]) ? a : b));
  const finds = { query: best("query") === "screen-280", "query-fr": best("query-fr") === "landscape-140",
                  "query-bn": best("query-bn") === "speech" };
  return { dtype, loaded_s: loaded / 1000, agreement, finds, seconds };
}

const dtypes = process.argv.slice(2).length ? process.argv.slice(2) : ["q4", "quantized", "fp16", "q4f16"];
mkdirSync(join(HERE, "measurements"), { recursive: true });
const results = [];
for (const dtype of dtypes) {
  try {
    const result = await measure(dtype);
    results.push(result);
    const low = Math.min(...Object.values(result.agreement));
    console.log(`${dtype.padEnd(9)} loaded ${result.loaded_s.toFixed(0)} s · lowest cosine ${low.toFixed(4)} · ` +
      `queries find their input: ${Object.values(result.finds).every(Boolean) ? "yes" : JSON.stringify(result.finds)}`);
    for (const [name, value] of Object.entries(result.agreement)) {
      console.log(`  ${name.padEnd(14)} ${value.toFixed(4)}  ${result.seconds[name].toFixed(2)} s`);
    }
  } catch (error) {
    console.log(`${dtype}: ${error.message}`);
    results.push({ dtype, error: error.message });
  }
}
writeFileSync(join(HERE, "measurements", "model-cpu.json"), JSON.stringify(results, null, 1));
