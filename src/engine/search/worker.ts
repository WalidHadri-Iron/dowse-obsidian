import { Store } from "../store.ts";
import { LocalCatalog } from "./catalog.ts";

let catalog: LocalCatalog | null = null;
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent) => {
  queue = queue.then(async () => {
    const { id, op, args } = event.data;
    try {
      let result: unknown;
      if (op === "open") catalog = new LocalCatalog(await Store.attach(args[0]));
      else if (!catalog) throw new Error("Search has not opened its index");
      else if (op === "build") result = await catalog.build(args[0], args[1]);
      else if (op === "search") result = await catalog.search(args[0], args[1], args[2]);
      else if (op === "similar") result = await catalog.similar(args[0], args[1], args[2]);
      else if (op === "map") result = await catalog.map(args[0], args[1]);
      else throw new Error("Unknown search request");
      self.postMessage({ id, result });
    } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
  });
};
