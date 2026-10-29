// What the build puts inside main.js (esbuild.config.mjs). The engine's parts are functions answering their text: made
// only when the model loads, not each time Obsidian starts.
declare module "inline:worker" { const source: () => string; export default source; }
declare module "inline:ort-wasm" { const xzBase64: () => string; export default xzBase64; }
declare module "inline:ort-glue" { const source: () => string; export default source; }
declare module "*.png" { const base64: string; export default base64; }
declare module "*.f32" { const base64: string; export default base64; }
declare const DEV: boolean;
