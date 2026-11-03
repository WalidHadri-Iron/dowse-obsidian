// Builds main.js, the one file Obsidian loads: the plugin, with its engine's worker and the ONNX runtime's WebAssembly
// inside it. Nothing that runs is fetched at run time (Obsidian's plugin policy); only the model's weights are
// downloaded, once.
//
//   node esbuild.config.mjs [production] [dev]
//
// `dev` adds the development hooks (src/dev): the reference measurement (Dowse's reference inputs and vectors, checked
// inside Obsidian) and a test vault's requests (scripts/obsidian-run.mjs).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";
import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";

const production = process.argv.includes("production");
const dev = process.argv.includes("dev");

// The ONNX runtime transformers.js was built against (its own copy if it has one): its WebAssembly and the script
// that loads it, the build transformers.js asks for (asyncify: WebGPU and the processor in one). The WebAssembly is
// packed with xz (the `xz` command): 3.7 MB against gzip's 6.6, and Obsidian reads all of main.js at every start
// (measurements/README.md)
const transformers = join("node_modules", "@huggingface", "transformers");
const ort = [join(transformers, "node_modules", "onnxruntime-web", "dist"), join("node_modules", "onnxruntime-web", "dist")]
  .find((folder) => existsSync(join(folder, "ort-wasm-simd-threaded.asyncify.wasm")));
const runtime = readFileSync(join(ort, "ort-wasm-simd-threaded.asyncify.wasm"));
const packed = join(".cache", `ort-wasm-${createHash("sha256").update(runtime).digest("hex").slice(0, 16)}.xz`);   // (9 s)
if (!existsSync(packed)) {
  mkdirSync(".cache", { recursive: true });
  writeFileSync(packed, execFileSync("xz", ["-9e", "--stdout"], { input: runtime, maxBuffer: 1 << 30 }));
}
const wasm = readFileSync(packed).toString("base64");
const glue = readFileSync(join(ort, "ort-wasm-simd-threaded.asyncify.mjs"), "utf8");

const worker = await esbuild.build({
  entryPoints: ["src/engine/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: production,
  write: false,
  logLevel: "warning",
});
const searchWorker = await esbuild.build({
  entryPoints: ["src/engine/search/worker.ts"], bundle: true, format: "esm", platform: "browser", target: "es2022",
  minify: production, write: false, logLevel: "warning",
});

const inlined = {
  name: "inlined",
  setup(build) {
    const sources = {
      "inline:worker": worker.outputFiles[0].text,
      "inline:search-worker": searchWorker.outputFiles[0].text,
      "inline:ort-wasm": wasm,
      "inline:ort-glue": glue,
    };
    build.onResolve({ filter: /^inline:/ }, (args) => ({ path: args.path, namespace: "inline" }));
    build.onLoad({ filter: /.*/, namespace: "inline" }, (args) => ({
      // a function: V8 only skims a function's body until it's called, so Obsidian's start doesn't pay for the text
      contents: `export default function() { return ${JSON.stringify(sources[args.path])}; }`, loader: "js",
    }));
  },
};

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  define: { DEV: JSON.stringify(dev) },
  loader: { ".png": "base64", ".f32": "base64" },
  plugins: [inlined, sveltePlugin({ compilerOptions: { css: "external", dev: !production } })],
  mainFields: ["svelte", "browser", "module", "main"],
  conditions: ["svelte", "browser"],
  minify: production,
  sourcemap: production ? false : "inline",
  outfile: "main.js",
  logLevel: "info",
});

// styles.css, the one stylesheet Obsidian loads: the tokens and layout (src/styles.css), then the components' own
writeFileSync("styles.css", readFileSync("src/styles.css", "utf8") +
  (existsSync("main.css") ? "\n/* The components' styles */\n" + readFileSync("main.css", "utf8") : ""));
rmSync("main.css", { force: true });
