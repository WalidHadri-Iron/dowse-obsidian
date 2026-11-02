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

## Obsidian's start

Obsidian reads and evaluates all of main.js at every start, in every vault, Dowse on or off. Measured 2026-10-29 in
Obsidian 1.14.5 (`app.plugins.enablePlugin`, the median of 9, `scripts/obsidian-run.mjs --eval`): an empty plugin
1 ms; the plugin without the ONNX runtime's WebAssembly 9–11 ms; with it gzipped (10.2 MB main.js) 45–50 ms; the
same with the engine's parts inside functions V8 only skims 44 ms (no gain: reading and scanning the text is the
cost); with the WebAssembly packed with xz (6.4 MB main.js) **26 ms**. Unpacking xz when the model loads takes
0.26 s against gzip's 0.10 (Node), once per model start, which takes seconds anyway.

## The processor, faster

The q4 build for PCs without WebGPU (asked again, 2026-10-29, Obsidian 1.14.5): still "Could not find an
implementation for GatherBlockQuantized(1) node with name 'node_embedding_Quant'" (only the word embeddings use it),
and its vectors would be another space than an index read on a GPU. What makes the processor faster is threads:
Obsidian has SharedArrayBuffer (though not cross-origin isolation), and the runtime's threads only needed to be kept
from Node (`WEB_ONLY`, put before the runtime's script). fp16, long passages (1,827 characters) a second, 24 cores:

| Threads | 1 | 4 | 8 | 12 | 16 |
|---|---|---|---|---|---|
| Passages a second | 0.29 | 1.03 | 1.61 | 1.82 | 2.16 |

On 8 threads the vectors are as close to Dowse's as on one (lowest cosine 0.99936). The plugin takes half the cores,
at most 8 (`worker.ts` THREADS): the other half is left to you.

## The time left

Told from how fast this computer has read each kind of file so far (`Indexer.estimate`). Reading Obsidian's help and
the test notes (280 files, 1,741 passages) on the RTX 4070 Ti, 2026-10-29: first told after 8.6 s, 54 s left
(31 s were); then 33 s for 25, 19 s for 17, 7 s for 9. High at first (the first files include the model's warm-up),
right within seconds after; shown rounded ("less than a minute left", "about 6 min left").

## Pictures and sound

Dowse's own queries on its testbed's photos, video and recordings (evals/testbed.json and hard.json, the 48 whose
answers are all pictures or sound: images, the video's moments, the podcast's segments, a voice memo; paraphrases and
other languages), read by the plugin in Obsidian (RTX 4070 Ti), 2026-11-02. Alone (19 files): the right file first for
47 of 48; the miss ("video with animals") found nothing at all, as z is told against too few files. Among Obsidian's
help and the test notes (299 files): the right file first for 44 and among the first five for all 48; first instead:
"Sleep log" for "where they talk about sleep", "Slides" for "slideshow with a zebra", a note with the word "dog" for
"a dog" (z 4.0 against the photo's 5.1: Dowse's ranking, the same here), the 1968 demo's recording for "narrator
introducing a wildlife show". With the model's image and sound parts off (the default before), none of them is read:
they're found by their names only.
