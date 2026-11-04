# Third-party software and model notices

Dowse's own code is MIT-licensed. The following software is included in the
production plugin bundle. Its original terms and copyright notices remain in
[`licenses/`](licenses/), which is included with release packages.

| Component | Version | License / notice |
| --- | --- | --- |
| Transformers.js | 4.3.1 | [Apache 2.0](licenses/transformers-Apache-2.0.txt) |
| Hugging Face Tokenizers | 0.2.0 | [Apache 2.0](licenses/tokenizers-Apache-2.0.txt); included through Transformers.js |
| Hugging Face Jinja | 0.5.11 | [MIT](licenses/jinja-MIT.txt); included through Transformers.js |
| ONNX Runtime Web | 1.31.0-dev.20260914-8d85527a0 | [MIT](licenses/onnxruntime-MIT.txt), [third-party notices](licenses/onnxruntime-ThirdPartyNotices.txt) for the embedded runtime |
| ONNX Runtime Common | 1.30.0 / 1.31.0-dev.20260911-2a43ec07e | [MIT](licenses/onnxruntime-MIT.txt) |
| Svelte runtime | 5.57.2 | [MIT](licenses/svelte-MIT.txt) |
| esm-env | 1.2.2 | [MIT](licenses/esm-env-MIT.txt) |
| clsx | 2.1.1 | [MIT](licenses/clsx-MIT.txt) |
| Three.js | 0.186.1 | [MIT](licenses/three-MIT.txt) |
| stemmer | 2.0.1 | [MIT](licenses/stemmer-MIT.txt) |
| xz-decompress | 0.2.3 | [MIT and embedded-component notices](licenses/xz-decompress-NOTICE.txt) |
| walloc (inside xz-decompress) | upstream bundled version | [MIT](licenses/walloc-MIT.txt) |
| XZ Embedded (inside xz-decompress) | upstream bundled version | Public domain, as identified in the upstream bundled [notice](licenses/xz-decompress-NOTICE.txt) |

The build saves its resolved module inventory in `.cache/bundle-inputs.json` so
this list can be checked when dependencies change. Build tools and Obsidian's own
application are separate from the plugin distribution.

## Downloaded model data

Model weights are not part of the release archive. When enabled, Dowse downloads
selected parts of `onnx-community/embeddinggemma-2-ONNX` at revision
`daa72c51243991dfcaf9f9137d2c573d8f7790c0`. The conversion repository and its
upstream `google/embeddinggemma-2` model identify their license as Apache 2.0:

- [Pinned ONNX model card](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX/blob/daa72c51243991dfcaf9f9137d2c573d8f7790c0/README.md)
- [Upstream Google model card](https://huggingface.co/google/embeddinggemma-2)

## Demonstrations and fixtures

Current README GIFs use an original-content demonstration vault; see
[`docs/media/README.md`](docs/media/README.md). Reference-test pictures are drawn
synthetic fixtures and speech was generated locally; see
[`tests/reference/README.md`](tests/reference/README.md). Model data, user vaults
and local test profiles are not shipped in the plugin archive.
