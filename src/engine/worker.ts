// The engine's model, in a worker of its own so Obsidian never waits on it: EmbeddingGemma 2 (transformers.js), on the
// GPU through WebGPU where there is one, else on the processor through WebAssembly. Messages in: load, embed; out: the
// answer to each (by id), and download progress.

import "./web-only.ts";   // first: a plain web worker, before transformers.js looks at where it is
import { AutoConfig, AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";
import * as ort from "onnxruntime-web/webgpu";   // the same runtime transformers.js uses: its settings are these
import type { Answer, Picture, Request } from "./protocol.ts";

const MODEL = "onnx-community/embeddinggemma-2-ONNX";

let processor: any = null;
let model: any = null;

function send(message: Answer, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

async function load(request: Extract<Request, { op: "load" }>): Promise<{ device: string; gpu: string | null }> {
  // The runtime comes from main.js (no code is fetched): its WebAssembly, and the script that loads it as a blob URL
  env.allowLocalModels = false;
  env.useWasmCache = false;
  ort.env.wasm.wasmBinary = request.wasmBinary;
  ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([request.glue], { type: "text/javascript" })) } as any;
  ort.env.wasm.numThreads = 1;   // threads need cross-origin isolation, which Obsidian's window doesn't have
  ort.env.webgpu.powerPreference = "high-performance";   // a laptop's graphics card, not its integrated GPU
  const gpu = request.device !== "wasm" && "gpu" in navigator &&
    await (navigator as any).gpu.requestAdapter({ powerPreference: "high-performance" });
  const device = gpu ? "webgpu" : "wasm";
  const progress = (event: any) => {
    if (event.status === "progress") send({ op: "progress", file: event.file, loaded: event.loaded, total: event.total });
  };
  processor = await AutoProcessor.from_pretrained(MODEL, { progress_callback: progress });
  // Only the parts asked for are downloaded and loaded (the model card's way: their configs taken out)
  const config: any = await AutoConfig.from_pretrained(MODEL, { progress_callback: progress });
  if (!request.parts.image) config.vision_config = null;
  if (!request.parts.audio) config.audio_config = null;
  model = await AutoModel.from_pretrained(MODEL, { config, device, dtype: request.dtype as any, progress_callback: progress });
  const adapter = device === "webgpu" ? (await (ort.env.webgpu as any).adapter) ?? gpu : null;   // (the runtime's own, or ours)
  const info = adapter?.info;
  return { device, gpu: info ? [info.vendor, info.architecture, info.description].filter(Boolean).join(" ") : null };
}

async function vectors(...inputs: unknown[]): Promise<Float32Array> {
  const output = await model(await processor(...inputs));
  return output.sentence_embedding.data as Float32Array;
}

async function embed(request: Extract<Request, { op: "embed" }>): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  if (request.texts?.length) {
    const flat = await vectors(request.texts);
    for (let i = 0; i < request.texts.length; i++) out.push(flat.slice(i * 768, (i + 1) * 768));
  }
  for (const picture of request.images ?? []) out.push(await image(picture));
  for (const sound of request.audio ?? []) out.push(await vectors(null, null, [[sound]]));
  return out;
}

async function image(picture: Picture): Promise<Float32Array> {
  processor.image_processor.max_soft_tokens = picture.budget;   // sized for it already: no resize
  const raw = new RawImage(new Uint8ClampedArray(picture.rgba), picture.width, picture.height, 4).rgb();
  return vectors(null, [[raw]]);
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    if (request.op === "load") {
      send({ op: "done", id: request.id, result: await load(request) });
    } else if (request.op === "embed") {
      const result = await embed(request);
      send({ op: "done", id: request.id, result }, result.map((v) => v.buffer));
    }
  } catch (error) {
    send({ op: "failed", id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
};
