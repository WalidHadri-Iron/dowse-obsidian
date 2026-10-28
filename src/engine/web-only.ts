// Imported first by the worker, before transformers.js: Obsidian's workers can reach Node (`process`), which makes
// transformers.js take its Node path, without the WebGPU/WebAssembly runtime this worker carries. The worker needs no
// Node: it's made a plain web worker, so transformers.js takes its web path.

const scope = globalThis as any;
if (typeof scope.process !== "undefined") {
  try {
    delete scope.process;
  } catch {}
  if (typeof scope.process !== "undefined") Object.defineProperty(scope, "process", { value: undefined, configurable: true });
}

export {};
