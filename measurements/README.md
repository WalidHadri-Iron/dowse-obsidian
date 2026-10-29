# Which build of the model

EmbeddingGemma 2's ONNX builds (`onnx-community/embeddinggemma-2-ONNX`), measured 2026-10-28 against Dowse's reference
vectors (llama.cpp, Q8 GGUF; `tests/reference`), with `scripts/measure-model.mjs` (Node, processor) and inside Obsidian
(`node esbuild.config.mjs measure`, `src/dev/measure.ts`).

| Build | Download (text + images + audio) | Lowest cosine with Dowse | WebGPU in Obsidian | Processor (WebAssembly) in Obsidian |
|---|---|---|---|---|
| q4 | 174 + 109 + 189 MB | 0.977 | runs | doesn't run (no GatherBlockQuantized) |
| q4f16 | 157 + 98 + 170 MB | 0.977 | runs | — |
| quantized (8-bit) | 314 + 195 + 340 MB | 0.9994 | — | doesn't run (no GatherBlockQuantized) |
| **fp16** | 542 + 336 + 587 MB | **0.9993** | **runs** | **runs** |

Chosen: **fp16**. The only build that runs on both the GPU and the processor, so the plugin works with or without
WebGPU, and an index made on one stays valid on the other (one model, one vector space). It's as close to Dowse's
vectors as Dowse's own runtimes are to each other, so Dowse's measured search quality carries over. Every build
found each reference query's own input.

Speed, on the integrated AMD GPU Windows gives Obsidian here (seconds, second run): a query 0.09, a short passage
0.09, a ~1,800-token passage 6.4, an image at 140 tokens 3.6. On the processor: a query 0.1, a short passage 0.25,
the long passage 23, an image at 140 tokens 13. Searching is instant everywhere; reading a vault is what needs work
(batching, passage length, image budgets).

Reading a vault, on this PC's two GPUs (2026-10-29: 44 notes of Obsidian's help, 385 passages, model start included;
`dev/hooks.ts` "read"): the integrated AMD GPU (WebGPU: "amd rdna-2") 94.2 s, the RTX 4070 Ti ("nvidia lovelace")
12.4 s and 10.9 s, about 8 times faster. Settings › Dowse offers to run Obsidian on the card (`plugin/graphics.ts`).

On Windows, Chromium ignores WebGPU's "high-performance" choice: Obsidian gets the GPU Windows assigns it
(Settings › System › Display › Graphics).
