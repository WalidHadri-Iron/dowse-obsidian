// What the plugin and its model worker say to each other.

/** The model's files on Hugging Face (downloaded once into Obsidian's cache, for all vaults). */
export const MODEL_REPO = "onnx-community/embeddinggemma-2-ONNX";
export const MODEL_REVISION = "daa72c51243991dfcaf9f9137d2c573d8f7790c0";

export type Dtype = "q4" | "q4f16" | "quantized" | "fp16";

/** An image already sized for its token budget (as Dowse sizes them), as RGBA pixels. */
export interface Picture {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  budget: number;
}

/** The model's parts beyond text: each is a download of its own (images 336 MB, sound 587 MB in fp16). */
export interface Parts { image: boolean; audio: boolean }

export type Request =
  | { op: "load"; id: number; dtype: Dtype; device: "auto" | "wasm"; parts: Parts; wasmBinary: ArrayBuffer; glue: string;
      threads?: number }
  | { op: "embed"; id: number; texts?: string[]; images?: Picture[]; audio?: Float32Array[] };

export type Answer =
  | { op: "device"; device: string; gpu: string | null }
  | { op: "done"; id: number; result: any }
  | { op: "failed"; id: number; message: string }
  | { op: "progress"; file: string; loaded: number; total: number }
  | { op: "log"; message: string };   // (what the worker has to say: the console's)
