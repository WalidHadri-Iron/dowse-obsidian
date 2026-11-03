import { test } from "node:test";
import assert from "node:assert/strict";
import type { App, TFile } from "obsidian";
import { canOpenExcalidraw, drawExcalidraw, excalidrawRenderer, isExcalidraw } from "../src/plugin/excalidraw.ts";

const file = (path: string) => ({ path, extension: path.split(".").pop() } as TFile);
function host(mode?: string, plugin?: unknown): App {
  return { metadataCache: { getFileCache: () => ({ frontmatter: { "excalidraw-plugin": mode } }) },
    plugins: { plugins: plugin ? { "obsidian-excalidraw-plugin": plugin } : {} } } as unknown as App;
}

test("drawing detection supports native suffixes and metadata without changing ordinary notes", () => {
  assert.equal(isExcalidraw(host(), file("Garden.excalidraw.md")), true);
  assert.equal(isExcalidraw(host("parsed"), file("Drawing.md")), true);
  assert.equal(isExcalidraw(host("raw"), file("Drawing.md")), true);
  assert.equal(isExcalidraw(host(), file("Notes.md")), false);
  assert.equal(isExcalidraw(host(), file("photo.png")), false);
  assert.equal(canOpenExcalidraw(host()), false);
  assert.equal(excalidrawRenderer(host()), "unavailable");
});

test("a preview uses an isolated workbench, the current drawing, requested resolution and theme", async () => {
  const instances: FakeAutomate[] = [];
  class FakeAutomate {
    work = ["unfinished user sketch"];
    destroyed = false;
    request: unknown[] = [];
    constructor(_plugin?: unknown) { instances.push(this); }
    async getSceneFromFile(_file: TFile) { return { elements: [{ isDeleted: false }, { isDeleted: true }] }; }
    getBoundingBox(elements: unknown[]) { assert.equal(elements.length, 1); return { width: 1200, height: 800 }; }
    async createPNG(...args: unknown[]) { this.request = args; return new Blob(["drawing bytes"], { type: "image/png" }); }
    destroy() { this.destroyed = true; }
  }
  const template = new FakeAutomate(), app = host("parsed", { ea: template, manifest: { version: "test" } });
  const url = await drawExcalidraw(app, file("Garden.excalidraw.md"), 620, true);
  assert.ok(url);
  try { assert.equal(await (await fetch(url)).text(), "drawing bytes"); } finally { URL.revokeObjectURL(url); }
  assert.equal(instances.length, 2);
  assert.deepEqual(template.work, ["unfinished user sketch"]);
  assert.equal(template.destroyed, false);
  assert.equal(instances[1].destroyed, true);
  assert.deepEqual(instances[1].request, ["Garden.excalidraw.md", .5,
    { withBackground: true, withTheme: true }, undefined, "dark", 20]);
  assert.equal(excalidrawRenderer(app), "test");
});

test("missing, cancelled or failed drawing renderers release resources safely", async () => {
  assert.equal(await drawExcalidraw(host(), file("Garden.excalidraw.md"), 680, false), null);
  let destroyed = 0, created = 0;
  class BrokenAutomate {
    constructor() { created++; }
    async getSceneFromFile() { throw new Error("Drawing could not be read"); }
    getBoundingBox() { return { width: 1, height: 1 }; }
    async createPNG() { return new Blob(); }
    destroy() { destroyed++; }
  }
  const app = host("parsed", { ea: new BrokenAutomate() }), cancel = new AbortController();
  cancel.abort();
  assert.equal(await drawExcalidraw(app, file("Garden.excalidraw.md"), 680, false, cancel.signal), null);
  assert.equal(created, 1, "a queued preview cancelled on unload does not start rendering");
  await assert.rejects(drawExcalidraw(app, file("Garden.excalidraw.md"), 680, false), /could not be read/);
  assert.equal(destroyed, 1);
});
