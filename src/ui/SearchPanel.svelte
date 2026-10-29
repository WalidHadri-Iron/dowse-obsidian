<script lang="ts">
  // The Dowse tab: the vault searched by what's in it. Before a search, the wall holds the vault's latest files; a
  // search gathers clear matches in front of them (the fisheye wall) or lists them, with the words found. Or the whole
  // vault on Explore's floor, in aisles of files that are alike, where a search shows what it found where it stands.
  import { onMount } from "svelte";
  import Wall from "./wall/Wall.svelte";
  import Icon from "./wall/Icon.svelte";
  import ResultList from "./ResultList.svelte";
  import MapFloor, { type MapAisle, type MapPiece } from "./explore/MapFloor.svelte";
  import { rankedStep } from "./explore/explore-view.ts";
  import type { ExploreMap } from "../engine/search/explore.ts";
  import { CLOSEST_LABEL } from "./wall/search-confidence.ts";
  import { folderOf, nameOf, pieceOf, shownOf, VISUAL, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";
  import type { Answer } from "../plugin/search.ts";

  let { controller, initial = "" }: { controller: Controller; initial?: string } = $props();

  const KINDS: [string, string, string[]][] = [
    ["all", "All", []], ["note", "Notes", ["note"]], ["pdf", "PDFs", ["pdf"]], ["canvas", "Canvases", ["canvas"]],
    ["image", "Images", ["image"]], ["audio", "Recordings", ["audio"]], ["video", "Videos", ["video"]],
  ];
  const stored = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };

  // svelte-ignore state_referenced_locally
  let query = $state(initial);   // (the tab's first query: read once)
  let kind = $state("all");
  const LAYOUTS = ["wall", "list", "map"];
  let layout = $state(LAYOUTS.includes(stored("dowse-layout", "wall")) ? stored("dowse-layout", "wall") : "wall");
  let answer = $state<Answer | null>(null);
  let recent = $state<Shown[]>([]);
  let selected = $state(0);
  let busy = $state(false);
  // svelte-ignore state_referenced_locally
  let on = $state(controller.on());   // (the controller stays the same; these follow it by subscription)
  // svelte-ignore state_referenced_locally
  let status = $state(controller.status());
  // svelte-ignore state_referenced_locally
  let dark = $state(controller.dark());
  let input = $state<HTMLInputElement>();
  let map = $state<ExploreMap | null>(null);
  let chosen = $state<string | null>(null);   // the case picked on the floor
  let floor = $state<MapFloor | null>(null);
  let asked = 0;
  let timer = 0;

  const searching = $derived(query.trim().length > 0);
  const hits = $derived(searching && answer ? answer.hits.map(shownOf) : []);
  const clear = $derived(!answer || answer.strong > 0);
  const kinds = $derived(KINDS.find(([id]) => id === kind)?.[2] ?? []);
  const shown: Shown[] = $derived(searching ? hits : recent);

  const pieces = $derived.by(() => {
    if (!searching) return recent.map((item) => pieceOf(item, { strong: true }));
    const strong = answer?.strong ?? 0;
    const found = hits.map((hit, i) => pieceOf(hit, { strong: clear && i < strong, closest: !clear || i >= strong, score: hit.score }));
    const seen = new Set(hits.map((h) => h.path));
    const rest = recent.filter((item) => !seen.has(item.path)).map((item) => pieceOf(item, { strong: false, back: true }));
    return [...found, ...rest];
  });

  // The floor: the map's cases of the kinds chosen; a search shows its results where they stand
  const mapPieces: MapPiece[] = $derived((map?.pieces ?? []).filter((p) => !kinds.length || kinds.includes(p.kind))
    .map((p) => ({ ...p, name: nameOf(p.path), folder: folderOf(p.path) || "/", visual: VISUAL.has(p.kind) })));
  const mapAisles: MapAisle[] = $derived.by(() => {
    if (!kinds.length) return map?.aisles ?? [];
    const counts = new Map<number, number>();
    for (const p of mapPieces) counts.set(p.aisle, (counts.get(p.aisle) ?? 0) + 1);
    return (map?.aisles ?? []).filter((a) => counts.has(a.index)).map((a) => ({ ...a, count: counts.get(a.index)! }));
  });
  const onFloor = $derived(new Set(mapPieces.map((p) => p.path)));
  const ranked = $derived(hits.filter((h) => onFloor.has(h.path)));
  const found = $derived(searching && answer && !busy ? new Map(ranked.map((h, i) => [h.path, i])) : null);
  const scores = $derived(found ? new Map(ranked.map((h) => [h.path, h.score ?? 0])) : null);
  const matches = $derived(new Set(hits.slice(0, answer?.strong ?? 0).map((h) => h.path)));

  const summary = $derived.by(() => {
    if (!on) return "";
    if (layout === "map" && !searching) {
      if (!map) return "Laying out the vault…";
      const named = map.aisles.some((a) => !a.label.startsWith("Aisle "));
      return `${map.total.toLocaleString()} files in ${map.aisles.length} aisle${map.aisles.length === 1 ? "" : "s"}, ` +
        `grouped by what's in them${named || !map.aisles.length ? "" : " (named once the model has started)"} · ${status}`;
    }
    if (!searching) return status;
    if (busy && !answer) return "Searching…";
    if (!answer) return "";
    const matches = answer.strong;
    const words = answer.meaning ? "" : " · words only, while the model starts";
    if (!answer.hits.length) return `Nothing found${words}`;
    return (matches ? `${matches} match${matches === 1 ? "" : "es"}` : CLOSEST_LABEL) + ` · ${Math.round(answer.ms)} ms${words}`;
  });

  async function run(): Promise<void> {
    const mine = ++asked;
    if (!query.trim()) { answer = null; busy = false; return; }
    busy = true;
    try {
      const found = await controller.search(query, kinds);
      if (mine === asked) { answer = found; selected = 0; }
    } finally {
      if (mine === asked) busy = false;
    }
  }

  function changed(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 150);
  }

  async function loadRecent(): Promise<void> {
    if (controller.on()) recent = await controller.recent();
  }

  async function loadMap(): Promise<void> {
    if (!controller.on()) return;
    const next = await controller.explore();
    if (next !== map) map = next;
  }

  /** What opens for a case: the search's hit (at its line or page), else the file. */
  function shownFor(path: string): Shown {
    return hits.find((h) => h.path === path) ?? { path, kind: mapPieces.find((p) => p.path === path)?.kind ?? "note",
      loc: null, locEnd: null, excerpt: null, info: {} };
  }

  /** Asked from outside (a command, a link): this query, now. */
  export function ask(next: string): void {
    query = next;
    void run();
  }

  function setLayout(next: string): void {
    layout = next;
    if (next === "map") void loadMap();
    try { localStorage.setItem("dowse-layout", next); } catch { /* private storage */ }
  }

  function keys(event: KeyboardEvent): void {
    if (layout === "map" && found) {   // through the results where they stand
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step) {
        const path = rankedStep(ranked.map((h) => h.path), chosen, step);
        if (path) { chosen = path; floor?.focusResult(path); }
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" && (chosen ?? ranked[0]?.path)) {
        controller.open(shownFor(chosen ?? ranked[0].path), event.ctrlKey || event.metaKey);
        event.preventDefault();
        return;
      }
    }
    const items = shown;
    if (event.key === "ArrowDown") { selected = Math.min(selected + 1, items.length - 1); event.preventDefault(); }
    else if (event.key === "ArrowUp") { selected = Math.max(selected - 1, 0); event.preventDefault(); }
    else if (event.key === "Enter" && items[selected]) { controller.open(items[selected], event.ctrlKey || event.metaKey); event.preventDefault(); }
    else if (event.key === "Escape" && query) { query = ""; answer = null; event.preventDefault(); }
  }

  onMount(() => {
    input?.focus();
    void loadRecent();
    if (layout === "map") void loadMap();
    if (query.trim()) void run();
    let lastReady = controller.ready();
    const stop = controller.subscribe(() => {
      on = controller.on();
      status = controller.status();
      dark = controller.dark();
      const ready = controller.ready();
      if (ready && !lastReady && answer && !answer.meaning) void run();   // the model came: by meaning now
      lastReady = ready;
    });
    const refresh = window.setInterval(() => {
      if (!searching) void loadRecent();
      if (layout === "map") void loadMap();   // remade in the background as the vault is read; the last one meanwhile
    }, 10000);
    return () => { stop(); window.clearInterval(refresh); window.clearTimeout(timer); };
  });
</script>

<div class="dowse-panel" class:theme-dark={dark}>
  {#if !on}
    <div class="dowse-off">
      <h2>Search this vault by what's in it</h2>
      <p>Describe a note, a PDF or a canvas in your own words, in any of 100+ languages: Dowse finds it, at the right
        line or page. Everything stays on this computer.</p>
      <p class="dowse-quiet">Turning it on downloads the search model (542 MB, from Hugging Face), once for all your vaults.</p>
      <button class="mod-cta" onclick={() => controller.turnOn()}>Turn on for this vault</button>
    </div>
  {:else}
    <div class="dowse-head">
      <div class="dowse-search">
        <Icon name="search" size={18} />
        <input bind:this={input} type="search" placeholder="Describe what you remember" bind:value={query}
               oninput={changed} onkeydown={keys} spellcheck="false" aria-label="Search the vault" />
      </div>
      <div class="dowse-bar">
        <div class="dowse-kinds" role="radiogroup" aria-label="Kinds of files">
          {#each KINDS as [id, label]}
            <button class="dowse-chip" class:is-active={kind === id} role="radio" aria-checked={kind === id}
                    onclick={() => { kind = id; void run(); }}>{label}</button>
          {/each}
        </div>
        <div class="dowse-layout" role="radiogroup" aria-label="Show results as">
          <button class="clickable-icon" class:is-active={layout === "wall"} aria-label="As a wall" role="radio"
                  aria-checked={layout === "wall"} onclick={() => setLayout("wall")}><Icon name="wall" size={16} /></button>
          <button class="clickable-icon" class:is-active={layout === "list"} aria-label="As a list" role="radio"
                  aria-checked={layout === "list"} onclick={() => setLayout("list")}><Icon name="list" size={16} /></button>
          <button class="clickable-icon" class:is-active={layout === "map"} aria-label="Explore: the whole vault, by what's in it"
                  role="radio" aria-checked={layout === "map"} onclick={() => setLayout("map")}><Icon name="map" size={16} /></button>
          {#if layout === "map"}
            <button class="clickable-icon" aria-label="See the whole floor" onclick={() => floor?.overview()}><Icon name="layers" size={16} /></button>
          {/if}
        </div>
      </div>
      <div class="dowse-summary" aria-live="polite">{summary}</div>
    </div>
    <div class="dowse-body" class:dowse-floor={layout === "map"}>
      {#if layout === "map"}
        {#if mapPieces.length}
          <MapFloor bind:this={floor} pieces={mapPieces} aisles={mapAisles} {found} {scores} {clear} {matches} {dark}
                    selected={chosen}
                    picture={(piece, px) => controller.picture(pieceOf(shownFor(piece.path), { strong: true }), px, [])}
                    onselect={(piece) => (chosen = piece.path)}
                    onopen={(piece) => controller.open(shownFor(piece.path), false)}
                    onhover={(event, piece, target) => controller.hover(event, piece.path, target)} />
        {:else if map}
          <div class="dowse-empty">{kinds.length ? "No files of this kind on the floor." : "Files appear here as Dowse reads them."}</div>
        {/if}
      {:else if layout === "wall" && pieces.length}
        <Wall {pieces} collectionKeys={recent.map((r) => r.path)} selected={searching && hits.length ? Math.min(selected, hits.length - 1) : -1}
              terms={answer?.terms ?? []} {searching} {clear} {dark}
              picture={(piece, px, terms) => controller.picture(piece, px, terms)}
              onselect={(i) => (selected = i)} onopen={(i) => { const item = shown[i]; if (item) controller.open(item, false); }} />
      {:else if shown.length}
        <ResultList items={shown} {selected} {controller} onselect={(i) => (selected = i)} />
      {:else if searching && answer && !busy}
        <div class="dowse-empty">Nothing in this vault matches “{query}”.</div>
      {:else if !searching}
        <div class="dowse-empty">{status}</div>
      {/if}
    </div>
  {/if}
</div>
