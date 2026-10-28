// What the build puts inside main.js (esbuild.config.mjs).
declare module "inline:worker" { const source: string; export default source; }
declare module "inline:ort-wasm" { const gzippedBase64: string; export default gzippedBase64; }
declare module "inline:ort-glue" { const source: string; export default source; }
declare module "*.png" { const base64: string; export default base64; }
declare module "*.f32" { const base64: string; export default base64; }
declare const DEV: boolean;
