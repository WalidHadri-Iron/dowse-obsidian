# Vendored build input

`ort-wasm-<sha256 prefix>.xz` is ONNX Runtime Web's `ort-wasm-simd-threaded.asyncify.wasm`
(from the `onnxruntime-web` package in `node_modules`, MIT, see `licenses/`), compressed with
`xz -9e` (XZ Utils 5.4). The file name holds the first 16 hex digits of the uncompressed
file's SHA-256.

It is committed so that every machine builds the same `main.js`: xz's output changes between
its versions, and Obsidian's review rebuilds the plugin and compares it with the release.
`npm run build` checks that the pack unpacks to exactly the runtime in `node_modules` and stops
if it doesn't, or if there is no pack for that runtime. After updating the runtime, run
`npm run pack-runtime` and commit the new pack (and remove the old one).
