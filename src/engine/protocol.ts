// What the plugin and its model worker say to each other.

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
  | { op: "load"; id: number; dtype: Dtype; device: "auto" | "wasm"; parts: Parts; wasmBinary: ArrayBuffer; glue: string }
  | { op: "embed"; id: number; texts?: string[]; images?: Picture[]; audio?: Float32Array[] };

export type Answer =
  | { op: "done"; id: number; result: any }
  | { op: "failed"; id: number; message: string }
  | { op: "progress"; file: string; loaded: number; total: number };
