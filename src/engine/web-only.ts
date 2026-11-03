// Imported first by the worker, before transformers.js: Obsidian's workers can reach Node (`process`), which makes
// transformers.js take its Node path, without the WebGPU/WebAssembly runtime this worker carries. The worker needs no
// Node: it's made a plain web worker, so transformers.js takes its web path. The runtime's threads (workers of this
// worker, started from its script) are made so too, by `WEB_ONLY` put before that script: else they import Node's
// worker_threads, and fail.

function webOnly(): void {
  const scope = globalThis as { process?: unknown };
  if (typeof scope.process !== "undefined") {
    try {
      delete scope.process;
    } catch {
      // (not deletable here: hidden below instead)
    }
    if (typeof scope.process !== "undefined") Object.defineProperty(scope, "process", { value: undefined, configurable: true });
  }
}

webOnly();

export const WEB_ONLY = `(${webOnly.toString()})();\n`;
