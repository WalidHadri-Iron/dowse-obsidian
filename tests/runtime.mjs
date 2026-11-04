// Shared engine code runs in windows and workers. Supply the worker timer surface
// in Node tests, keeping DOM-specific paths disabled. Getters preserve Node's mock timers.
Object.defineProperty(globalThis, "self", {
  value: { get setTimeout() { return globalThis.setTimeout; }, get clearTimeout() { return globalThis.clearTimeout; } },
  configurable: true,
});
