// The reference measurement, inside Obsidian (development builds: `node esbuild.config.mjs measure`): Dowse's
// reference inputs embedded with each build of the model asked for, on the GPU (WebGPU) or the processor (WebAssembly),
// against Dowse's reference vectors, with the time each took. Asked for by a note `dowse-measure.json` at the vault's
// root ([{"dtype": "q4", "device": "auto"}, ...]); answered in `dowse-measure-result.json` beside it.

import type { App } from "obsidian";
import { Model } from "../engine/model";
import type { Dtype, Picture } from "../engine/protocol";
import { chunks } from "../engine/searchtext.ts";
import reference from "../../tests/reference/vectors.json";
import inputs from "../../tests/reference/inputs.json";
import screen from "../../tests/reference/screen-280.png";
import landscape from "../../tests/reference/landscape-140.png";
import frame from "../../tests/reference/frame-70.png";
import speech from "../../tests/reference/speech-16k.f32";

const IMAGES: Record<string, [string, number]> = {
  "screen-280": [screen, 280], "landscape-140": [landscape, 140], "frame-70": [frame, 70],
};

function bytes(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function picture(png: string, budget: number): Promise<Picture> {
  const bitmap = await createImageBitmap(new Blob([bytes(png)], { type: "image/png" }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return { rgba: pixels.data.buffer as ArrayBuffer, width: bitmap.width, height: bitmap.height, budget };
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

async function one(dtype: Dtype, device: "auto" | "wasm") {
  const model = new Model();
  try {
    let started = performance.now();
    const ran = await model.load(dtype, device);
    const loaded = (performance.now() - started) / 1000;
    const made: Record<string, Float32Array> = {}, seconds: Record<string, number> = {};
    for (const [name, text] of Object.entries(inputs.texts as Record<string, string>)) {
      started = performance.now();
      [made[name]] = await model.texts([text]);
      seconds[name] = (performance.now() - started) / 1000;
    }
    for (const [name, [png, budget]] of Object.entries(IMAGES)) {
      const image = await picture(png, budget);
      started = performance.now();
      [made[name]] = await model.images([image]);
      seconds[name] = (performance.now() - started) / 1000;
    }
    started = performance.now();
    [made.speech] = await model.audio([new Float32Array(bytes(speech).buffer)]);
    seconds.speech = (performance.now() - started) / 1000;
    // A second pass: the first runs include the GPU compiling its shaders
    const again: Record<string, number> = {};
    for (const [name, text] of Object.entries(inputs.texts as Record<string, string>)) {
      started = performance.now();
      await model.texts([text]);
      again[name] = (performance.now() - started) / 1000;
    }
    const vectors = reference.vectors as Record<string, number[]>;
    const agreement = Object.fromEntries(Object.keys(vectors).map((n) => [n, cosine(made[n], vectors[n])]));
    return { dtype, asked: device, device: ran, gpu: model.gpu, loaded_s: loaded, agreement, seconds, again };
  } catch (error) {
    return { dtype, asked: device, error: error instanceof Error ? error.message : String(error) };
  } finally {
    model.close();
  }
}

/** Passages a second, by batch size: real passages (Dowse's 1,800-character cut of the long reference text). */
async function throughput(dtype: Dtype, device: "auto" | "wasm", batches: number[]) {
  const model = new Model();
  try {
    const ran = await model.load(dtype, device);
    const long = (inputs.texts as Record<string, string>)["document-long"].replace(/^title: none \| text: /, "");
    const passages = chunks(long).map((p) => `title: Greenhouse log | text: ${p}`);
    while (passages.length < 32) passages.push(...passages);
    await model.texts(passages.slice(0, 2));   // warm up (shaders)
    const rates: Record<string, number> = {};
    for (const size of batches) {
      const count = Math.max(size * 2, 8);
      const started = performance.now();
      for (let i = 0; i < count; i += size) await model.texts(passages.slice(i, i + size));
      rates[size] = count / ((performance.now() - started) / 1000);
    }
    return { dtype, asked: device, device: ran, passages_per_second: rates, passage_chars: passages[0].length };
  } catch (error) {
    return { dtype, asked: device, error: error instanceof Error ? error.message : String(error) };
  } finally {
    model.close();
  }
}

export async function measureIfAsked(app: App): Promise<void> {
  const asked = "dowse-measure.json";
  if (!(await app.vault.adapter.exists(asked))) return;
  const runs = JSON.parse(await app.vault.adapter.read(asked)) as
    { dtype: Dtype; device: "auto" | "wasm"; batches?: number[] }[];
  const results = [];
  for (const run of runs) {
    results.push(run.batches ? await throughput(run.dtype, run.device, run.batches) : await one(run.dtype, run.device));
    await app.vault.adapter.write("dowse-measure-result.json", JSON.stringify({ done: false, results }, null, 1));
  }
  const gpu = (navigator as any).gpu ? await (navigator as any).gpu.requestAdapter({ powerPreference: "high-performance" }) : null;
  await app.vault.adapter.write("dowse-measure-result.json", JSON.stringify({
    done: true, userAgent: navigator.userAgent, webgpu: Boolean(gpu),
    adapter: gpu?.info ? { vendor: gpu.info.vendor, architecture: gpu.info.architecture, description: gpu.info.description } : null,
    results,
  }, null, 1));
}
