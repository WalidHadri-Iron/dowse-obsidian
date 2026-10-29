// The model worker, from the plugin's side: started from the code inside main.js, given the ONNX runtime that's
// inside it too (its WebAssembly, unpacked here), then asked for vectors.

import workerSource from "inline:worker";
import wasmPacked from "inline:ort-wasm";
import glue from "inline:ort-glue";
import { XzReadableStream } from "xz-decompress";
import type { Answer, Dtype, Parts, Picture, Request } from "./protocol.ts";

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };
type Ask<T> = T extends unknown ? Omit<T, "id"> : never;

async function unpack(base64: string): Promise<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Response(new XzReadableStream(new Blob([bytes]).stream())).arrayBuffer();   // (a quarter second)
}

export class Model {
  private worker: Worker;
  private url: string;
  private next = 1;
  private pending = new Map<number, Pending>();
  device: string | null = null;   // where the model runs: "webgpu" or "wasm" (the processor)
  gpu: string | null = null;      // which graphics card, when it's the GPU
  parts: Parts = { image: false, audio: false };   // the parts loaded besides text

  private onProgress: (file: string, loaded: number, total: number) => void;

  constructor(onProgress: (file: string, loaded: number, total: number) => void = () => {}) {
    this.onProgress = onProgress;
    this.url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
    this.worker = new Worker(this.url, { type: "module" });
    this.worker.onmessage = (event: MessageEvent<Answer>) => this.answer(event.data);
    this.worker.onerror = (event) => this.failAll(new Error(event.message || "the model's worker stopped"));
  }

  private answer(message: Answer): void {
    if (message.op === "progress") return this.onProgress(message.file, message.loaded, message.total);
    if (message.op === "log") return console.log("Dowse's model:", message.message);
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.op === "done") pending.resolve(message.result);
    else pending.reject(new Error(message.message));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private ask<T>(request: Ask<Request>, transfer: Transferable[] = []): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
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
    this.failAll(new Error("the model was closed"));
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}
