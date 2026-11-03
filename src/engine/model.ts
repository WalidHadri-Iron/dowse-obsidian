// The model worker, from the plugin's side: started from the code inside main.js, given the ONNX runtime that's
// inside it too (its WebAssembly, unpacked here), then asked for vectors.

import workerSource from "inline:worker";
import wasmPacked from "inline:ort-wasm";
import glue from "inline:ort-glue";
import { XzReadableStream } from "xz-decompress";
import { Requests } from "./requests.ts";
import { Cancelled } from "./cancel.ts";
import type { Answer, Dtype, Parts, Picture, Request } from "./protocol.ts";

type Ask<T> = T extends unknown ? Omit<T, "id"> : never;

async function unpack(base64: string): Promise<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Response(new XzReadableStream(new Blob([bytes]).stream())).arrayBuffer();   // (a quarter second)
}

export class Model {
  private worker: Worker;
  private url: string;
  private requests = new Requests();
  get closed(): boolean { return this.requests.closed; }
  device: string | null = null;   // where the model runs: "webgpu" or "wasm" (the processor)
  gpu: string | null = null;      // which graphics card, when it's the GPU
  parts: Parts = { image: false, audio: false };   // the parts loaded besides text

  private onProgress: (file: string, loaded: number, total: number) => void;
  private onDevice: (device: string, gpu: string | null) => void;

  constructor(onProgress: (file: string, loaded: number, total: number) => void = () => {},
              onDevice: (device: string, gpu: string | null) => void = () => {}) {
    this.onProgress = onProgress;
    this.onDevice = onDevice;
    this.url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
    this.worker = new Worker(this.url, { type: "module" });
    this.requests.onFailure = () => { this.worker.terminate(); URL.revokeObjectURL(this.url); };
    this.worker.onmessage = (event: MessageEvent<Answer>) => this.answer(event.data);
    this.worker.onerror = (event) => { this.requests.fail(new Cancelled(event.message || "The model's worker stopped")); this.close(); };
    this.worker.onmessageerror = () => { this.requests.fail(new Cancelled("The model's answer could not be read")); this.close(); };
  }

  private answer(message: Answer): void {
    if (message.op === "progress") { this.requests.touch(); return this.onProgress(message.file, message.loaded, message.total); }
    if (message.op === "device") { this.device = message.device; this.gpu = message.gpu; this.onDevice(message.device, message.gpu); return; }
    if (message.op === "log") return console.log("Dowse's model:", message.message);
    this.requests.answer(message.id, message.op === "done" ? message.result : undefined,
      message.op === "failed" ? message.message : undefined);
  }

  private ask<T>(request: Ask<Request>, transfer: Transferable[] = []): Promise<T> {
    return this.requests.ask<T>((id) => this.worker.postMessage({ ...request, id }, transfer),
      request.op === "load" ? 30 * 60_000 : 5 * 60_000);
  }

  /** Loads the model (downloaded the first time); answers where it runs: "webgpu" or "wasm" (the processor). */
  async load(dtype: Dtype, device: "auto" | "wasm" = "auto", parts: Parts = { image: true, audio: true },
             threads?: number): Promise<string> {
    const wasmBinary = await unpack(wasmPacked());
    const answer = await this.ask<{ device: string; gpu: string | null }>(
      { op: "load", dtype, device, parts, wasmBinary, glue: glue(), threads }, [wasmBinary]);
    this.parts = parts;
    this.device = answer.device;
    this.gpu = answer.gpu;
    return answer.device;
  }

  texts(texts: string[]): Promise<Float32Array[]> {
    return this.ask({ op: "embed", texts });
  }

  images(images: Picture[]): Promise<Float32Array[]> {
    return this.ask({ op: "embed", images }, images.map((p) => p.rgba));
  }

  audio(clips: Float32Array[]): Promise<Float32Array[]> {
    return this.ask({ op: "embed", audio: clips });
  }

  close(): void {
    this.requests.fail();
  }
}
