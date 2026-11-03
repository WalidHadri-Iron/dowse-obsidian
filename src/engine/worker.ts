// The engine's model, in a worker of its own so Obsidian never waits on it: EmbeddingGemma 2 (transformers.js), on the
// GPU through WebGPU where there is one, else on the processor through WebAssembly. Messages in: load, embed; out: the
// answer to each (by id), and download progress.

import { WEB_ONLY } from "./web-only.ts";   // first: a plain web worker, before transformers.js looks at where it is
import { AutoConfig, AutoModel, AutoProcessor, RawImage, env } from "@huggingface/transformers";
import * as ort from "onnxruntime-web/webgpu";   // the same runtime transformers.js uses: its settings are these
import { MODEL_REPO as MODEL, MODEL_REVISION, type Answer, type Picture, type Request } from "./protocol.ts";

let processor: any = null;
let model: any = null;
let loaded: Extract<Request, { op: "load" }> | null = null;
let deviceNow = "wasm";

function send(message: Answer, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

// The runtime's threads are workers of this worker: what goes wrong in one is said (the ErrorEvent it throws says
// nothing of itself)
const NativeWorker = self.Worker;
if (NativeWorker) {
  (self as any).Worker = class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener("error", (event) => send({ op: "log", message:
        `a thread (${options?.name ?? "worker"}) failed: ${event.message || "(no message)"} ${event.filename ?? ""}:${event.lineno ?? ""}` }));
    }
  };
}

// On the processor, the runtime reads with threads (Obsidian has SharedArrayBuffer, though not cross-origin isolation):
// half the cores, at most 8, the other half left to you. A long passage a second: 0.29 on one thread, 1.03 on 4, 1.61
// on 8 (2.16 on 16), the vectors as close to Dowse's (measurements/README.md).
const THREADS = typeof SharedArrayBuffer === "undefined" ? 1
  : Math.max(1, Math.min(8, Math.floor((navigator.hardwareConcurrency || 2) / 2)));

async function load(request: Extract<Request, { op: "load" }>): Promise<{ device: string; gpu: string | null }> {
  // The runtime comes from main.js (no code is fetched): its WebAssembly, and the script that loads it as a blob URL
  env.allowLocalModels = false;
  env.useWasmCache = false;
  ort.env.wasm.wasmBinary = request.wasmBinary;
  ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([WEB_ONLY, request.glue], { type: "text/javascript" })) } as any;
  ort.env.webgpu.powerPreference = "high-performance";   // a laptop's graphics card, not its integrated GPU
  let gpu: any = null;
  if (request.device !== "wasm" && "gpu" in navigator) {
    try { gpu = await (navigator as any).gpu.requestAdapter({ powerPreference: "high-performance" }); }
    catch { send({ op: "log", message: "WebGPU is unavailable; using the processor." }); }
  }
  const device = gpu ? "webgpu" : "wasm";
  ort.env.wasm.numThreads = request.threads ?? (device === "wasm" ? THREADS : 1);
  const progress = (event: any) => {
    if (event.status === "progress") send({ op: "progress", file: event.file, loaded: event.loaded, total: event.total });
  };
  const options = { revision: MODEL_REVISION, progress_callback: progress };
  processor = await AutoProcessor.from_pretrained(MODEL, options);
  // Only the parts asked for are downloaded and loaded (the model card's way: their configs taken out)
  const config: any = await AutoConfig.from_pretrained(MODEL, options);
  if (!request.parts.image) config.vision_config = null;
  if (!request.parts.audio) config.audio_config = null;
  try {
    model = await AutoModel.from_pretrained(MODEL, { ...options, config, device, dtype: request.dtype as any });
  } catch (error) {
    if (device !== "webgpu") throw error;
    send({ op: "log", message: "The GPU could not start the model; using the processor." });
    return load({ ...request, device: "wasm" });
  }
  deviceNow = device;
  loaded = request;
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

// Processor settings and ONNX sessions are shared: never run two requests through them at once.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<Request>) => {
  queue = queue.then(() => handle(event.data));
};

async function handle(request: Request): Promise<void> {
  try {
    if (request.op === "load") {
      send({ op: "done", id: request.id, result: await load(request) });
    } else if (request.op === "embed") {
      let result: Float32Array[];
      try { result = await embed(request); }
      catch (error) {
        if (deviceNow !== "webgpu" || !loaded) throw error;
        send({ op: "log", message: "The GPU stopped computing; retrying on the processor." });
        await model?.dispose?.().catch(() => {});
        const where = await load({ ...loaded, device: "wasm" });
        send({ op: "device", ...where });
        result = await embed(request);
      }
      send({ op: "done", id: request.id, result }, result.map((v) => v.buffer));
    }
  } catch (error) {
    send({ op: "failed", id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}
