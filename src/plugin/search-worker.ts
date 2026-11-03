import source from "inline:search-worker";
import { Requests } from "../engine/requests.ts";
import type { SearchCatalog } from "../engine/search/catalog.ts";
import type { SearchOptions } from "../engine/search/searcher.ts";

// Svelte's state arrays are proxies and cannot cross postMessage. Copy all collection-valued options at the boundary.
function wire(options: SearchOptions): SearchOptions {
  return { ...options, kinds: options.kinds ? [...options.kinds] : undefined,
    within: options.within ? [...options.within] : undefined,
    exclude: options.exclude ? new Set(options.exclude) : undefined,
    example: options.example ? [...options.example] : undefined,
    dateSpan: options.dateSpan ? { ...options.dateSpan } : options.dateSpan };
}

export class SearchWorker implements SearchCatalog {
  private requests = new Requests();
  private url = URL.createObjectURL(new Blob([source()], { type: "text/javascript" }));
  private worker = new Worker(this.url, { type: "module" });
  private opened: Promise<unknown>;
  constructor(name: string) {
    this.requests.onFailure = () => { this.worker.terminate(); URL.revokeObjectURL(this.url); };
    this.worker.onmessage = e => this.requests.answer(e.data.id, e.data.result, e.data.error);
    this.worker.onerror = e => {
      console.error("Dowse search worker failed", e.message, e.filename, e.lineno);
      this.requests.fail(new Error(e.message || "The search worker stopped"));
    };
    this.worker.onmessageerror = () => this.requests.fail(new Error("The search worker's answer could not be read"));
    this.opened = this.ask("open", [name]);
    void this.opened.catch(() => {});
  }
  private ask<T>(op: string, args: unknown[]): Promise<T> {
    return this.requests.ask(id => this.worker.postMessage({ id, op, args }), 60000);
  }
  async build(...args: Parameters<SearchCatalog["build"]>): ReturnType<SearchCatalog["build"]> {
    await this.opened; return this.ask("build", args);
  }
  async search(query: string, vector: Float32Array | null, options: SearchOptions): ReturnType<SearchCatalog["search"]> {
    await this.opened; return this.ask("search", [query, vector, wire(options)]);
  }
  async similar(path: string, loc: number | null, options: SearchOptions): ReturnType<SearchCatalog["similar"]> {
    await this.opened; return this.ask("similar", [path, loc, wire(options)]);
  }
  async map(...args: Parameters<SearchCatalog["map"]>): ReturnType<SearchCatalog["map"]> {
    await this.opened; return this.ask("map", args);
  }
  close(): void { this.requests.fail(); }
}
