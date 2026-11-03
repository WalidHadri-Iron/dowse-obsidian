// The search, in a worker of its own: the index's catalog (the searcher, the map) built and asked here, never on
// Obsidian's thread. Each request is answered by id (plugin/search-worker.ts asks).

import { Store } from "../store.ts";
import { LocalCatalog } from "./catalog.ts";

type Ask =
  | { id: number; op: "open"; args: [name: string] }
  | { id: number; op: "build"; args: Parameters<LocalCatalog["build"]> }
  | { id: number; op: "search"; args: Parameters<LocalCatalog["search"]> }
  | { id: number; op: "similar"; args: Parameters<LocalCatalog["similar"]> }
  | { id: number; op: "map"; args: Parameters<LocalCatalog["map"]> };

let catalog: LocalCatalog | null = null;
let queue = Promise.resolve();

async function answer(ask: Ask): Promise<unknown> {
  if (ask.op === "open") { catalog = new LocalCatalog(await Store.attach(ask.args[0])); return undefined; }
  if (!catalog) throw new Error("Search has not opened its index");
  switch (ask.op) {
    case "build": return catalog.build(...ask.args);
    case "search": return catalog.search(...ask.args);
    case "similar": return catalog.similar(...ask.args);
    case "map": return catalog.map(...ask.args);
  }
}

self.onmessage = (event: MessageEvent<Ask>) => {
  const ask = event.data;
  queue = queue.then(async () => {
    try { self.postMessage({ id: ask.id, result: await answer(ask) }); }
    catch (error) { self.postMessage({ id: ask.id, error: error instanceof Error ? error.message : String(error) }); }
  });
};
