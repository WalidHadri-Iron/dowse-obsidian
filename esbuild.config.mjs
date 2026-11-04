// Builds main.js, the one file Obsidian loads: the plugin, with its engine's worker and the ONNX runtime's WebAssembly
// inside it. Nothing that runs is fetched at run time (Obsidian's plugin policy); only the model's weights are
// downloaded, once.
//
//   node esbuild.config.mjs [production] [dev]
//
// `dev` adds the development hooks (src/dev): the reference measurement (Dowse's reference inputs and vectors, checked
// inside Obsidian) and a test vault's requests (scripts/obsidian-run.mjs).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  // Python's standard-library lzma uses the same XZ format/preset on Windows, where xz is not normally on PATH.
  const command = process.platform === "win32" ? "python" : "xz";
  const args = process.platform === "win32" ? ["-c", "import lzma,sys; sys.stdout.buffer.write(lzma.compress(sys.stdin.buffer.read(), preset=9 | lzma.PRESET_EXTREME))"] : ["-9e", "--stdout"];
  writeFileSync(packed, execFileSync(command, args, { input: runtime, maxBuffer: 1 << 30 }));
}
const wasm = readFileSync(packed).toString("base64");
// The runtime's loader also runs under Node, where it loads fs, path, url, util, os and worker_threads. In Obsidian its
// Node test is false (web-only.ts takes `process` away), so those branches never run; they're taken out here, and the
// test made false outright, so the plugin holds no file or system access it doesn't use (Obsidian's review reported
// "Direct Filesystem Access" for them). Each is checked to be there once: a runtime that changes them stops the build.
const NODE_ONLY = [
  ['m=globalThis.process?.versions?.node&&"renderer"!=globalThis.process?.type', "m=!1"],
  ['var isNode=globalThis.process?.versions?.node&&globalThis.process?.type!="renderer"', "var isNode=!1"],
  ['const {createRequire:a}=await import("module");var require=a(import.meta.url),ca=require("worker_threads");', "var ca={};"],
  ['(await import("worker_threads")).workerData', "(void 0)"],
  ...["fs", "path", "url", "util", "os"].map((name) => [`require("${name}")`, "(void 0)"]),
];
let glue = readFileSync(join(ort, "ort-wasm-simd-threaded.asyncify.mjs"), "utf8");
for (const [node, web] of NODE_ONLY) {
  const count = glue.split(node).length - 1;
  if (count !== 1) throw new Error(`the ONNX runtime's loader has ${count} of ${node}, not 1: check NODE_ONLY against it`);
  glue = glue.replace(node, web);
}

const worker = await esbuild.build({
  entryPoints: ["src/engine/worker.ts"],
  metafile: true,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: production,
  write: false,
  logLevel: "warning",
});
const searchWorker = await esbuild.build({
  entryPoints: ["src/engine/search/worker.ts"], metafile: true, bundle: true, format: "esm", platform: "browser", target: "es2022",
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

const noticeFiles = ["LICENSE", "THIRD_PARTY_NOTICES.md", ...readdirSync("licenses").sort().map(name => `licenses/${name}`)];
const notices = noticeFiles.map(name => `===== ${name} =====\n${readFileSync(name, "utf8")}`).join("\n\n");
const licenseBanner = `/*! Dowse and bundled software licenses\n${notices.replaceAll("*/", "* /")}\n*/`;

const main = await esbuild.build({
  banner: { js: licenseBanner },
  metafile: true,
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

// No Node module the plugin doesn't use: Obsidian's own (obsidian, electron) and child_process (the Windows graphics
// preference, graphics.ts) only
const built = readFileSync("main.js", "utf8");
const unused = [...built.matchAll(/require\("(fs|path|url|util|os|worker_threads|module)"\)|import\("(module|worker_threads)"\)/g)];
if (unused.length) throw new Error(`main.js still loads ${[...new Set(unused.map((m) => m[0]))].join(", ")}`);

// styles.css, the one stylesheet Obsidian loads: the tokens and layout (src/styles.css), then the components' own
writeFileSync("styles.css", readFileSync("src/styles.css", "utf8") +
  (existsSync("main.css") ? "\n/* The components' styles */\n" + readFileSync("main.css", "utf8") : ""));
rmSync("main.css", { force: true });

// Retain the exact module inventory for third-party notice generation (not shipped as runtime code).
mkdirSync(".cache", { recursive: true });
writeFileSync(".cache/bundle-inputs.json", JSON.stringify([...new Set([worker, searchWorker, main].flatMap(build => Object.keys(build.metafile.inputs)))], null, 2));
