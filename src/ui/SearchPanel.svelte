<script lang="ts">
  // The Dowse tab: the vault searched by what's in it. Before a search, the wall holds the vault's latest files; a
  // search gathers clear matches in front of them (the fisheye wall) or lists them, with the words found. Or the whole
  // vault on Explore's floor, in aisles of files that are alike, where a search shows what it found where it stands.
  // Before Dowse is on here, what turning it on does; while a lot is being read, how far it is and how long is left.
  import { onMount } from "svelte";
  import Wall from "./wall/Wall.svelte";
  import Icon from "./wall/Icon.svelte";
  import ResultList from "./ResultList.svelte";
  import MapFloor, { type MapAisle, type MapPiece } from "./explore/MapFloor.svelte";
  import { rankedStep } from "./explore/explore-view.ts";
  import type { ExploreMap } from "../engine/search/explore.ts";
  import { CLOSEST_LABEL } from "./wall/search-confidence.ts";
  import { folderOf, lineOf, nameOf, pieceOf, shownOf, titleOf, VISUAL, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";
  import type { Answer } from "../plugin/search.ts";
  import { heldText, modelTrouble, timeLeft } from "../plugin/status.ts";
  import { dragLink } from "./drag.ts";
  import { radios } from "./radios.ts";

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
  // The list first (it reads at any size); the wall and the map a click away, and remembered once chosen
  let layout = $state(LAYOUTS.includes(stored("dowse-layout", "list")) ? stored("dowse-layout", "list") : "list");
  let answer = $state<Answer | null>(null);
  let recent = $state<Shown[]>([]);
  let selected = $state(-1);   // (none until a search, or ↑/↓: a row lit before anything was done meant nothing)
  let busy = $state(false);
  // svelte-ignore state_referenced_locally
  let on = $state(controller.on());   // (the controller stays the same; these follow it by subscription)
  const own = (text: string) => text.replace(/^Dowse · /, "");   // (in Dowse's own tab, its name goes without saying)
  // svelte-ignore state_referenced_locally
  let status = $state(own(controller.status()));
  // svelte-ignore state_referenced_locally
  let dark = $state(controller.dark());
  // svelte-ignore state_referenced_locally
  let reading = $state(controller.reading());
  // svelte-ignore state_referenced_locally
  const counts = controller.counts();   // (for the first screen, and the kinds' chips)
  // The kinds this vault has (and the one chosen): a chip for a kind with no file in it is a choice that can't matter
  const kindsHere = $derived(KINDS.filter(([id, , of]) => !of.length || of.some((k) => (counts[k] ?? 0) > 0) || id === kind));
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
  // Before a search, the vault's latest files, of the kinds chosen (the chips filter them too)
  const latest = $derived(kinds.length ? recent.filter((item) => kinds.includes(item.kind)) : recent);
  // A search's list: its matches, and what's less likely folded into one row (opened when asked); with no clear match,
  // the closest ten (they're the answer then)
  let more = $state(false);
  const cut = $derived(!answer ? hits.length : answer.strong > 0 ? answer.strong : 10);
  const listed = $derived(more ? hits : hits.slice(0, cut));
  const shown: Shown[] = $derived(searching ? (layout === "list" ? listed : hits) : latest);

  const pieces = $derived.by(() => {
    if (!searching) return latest.map((item) => pieceOf(item, { strong: true }));
    const strong = answer?.strong ?? 0;
    const found = hits.map((hit, i) => pieceOf(hit, { strong: clear && i < strong, closest: !clear || i >= strong, score: hit.score }));
    const seen = new Set(hits.map((h) => h.path));
    const rest = latest.filter((item) => !seen.has(item.path)).map((item) => pieceOf(item, { strong: false, back: true }));
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
  // The numbered ones (the matches, or the first five when nothing clearly matches), at most five, named beside the floor
  const rail = $derived(ranked.slice(0, Math.min(5, clear ? matches.size : 5)));

  // Reading a lot (the first time, or images turned on): how far, how long is left, and pausing it
  const strip = $derived.by(() => {
    const r = reading;
    if (r.model === "downloading") return { text: `Downloading the search model · ${Math.round((r.progress ?? 0) * 100)}%`,
                                            part: r.progress ?? 0, note: "Once, for all your vaults." };
    if (r.model === "failed" || r.held === "the model couldn't start") return { text: "The search model couldn't start",
      part: null, note: `${modelTrouble(r.error)} Dowse tries again every 2 minutes; meanwhile files are found by name.`,
      retry: true };
    const left = r.total - r.done;
    if (r.state === "paused") return { text: `${cap(heldText(r.held))} · ${left.toLocaleString()} files to read`,
                                       part: r.total ? r.done / r.total : 0, note: "", resume: r.paused };
    if ((r.state === "reading" || r.state === "waiting") && left >= 5) {
      const time = timeLeft(r.left);
      return { text: `Reading the vault · ${Math.min(r.done + 1, r.total).toLocaleString()} of ${r.total.toLocaleString()}` +
                     (time ? ` · ${time}` : ""), part: r.total ? r.done / r.total : 0,
               note: "Search works on what's read so far; the rest is found by name.", pause: true };
    }
    return null;
  });
  const cap = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
  // What a screen reader is told of reading: its state, and every tenth of the way (not every file)
  const heard = $derived(strip ? `${strip.text.split(" · ")[0]}${strip.part !== null ? `, ${Math.floor(strip.part * 10) * 10}%` : ""}` : "");

  // The search field drives the results (a combobox): its option is the one selected, whichever layout shows them; on
  // the wall and the map, whose cases are drawn, an unseen list says them
  const uid = Math.random().toString(36).slice(2, 8);
  const listId = `dowse-results-${uid}`;
  const current = $derived.by(() => {
    if (!searching || !hits.length) return undefined;
    if (layout === "map") { const i = chosen ? hits.findIndex((h) => h.path === chosen) : -1; return i >= 0 ? `${listId}-${i}` : undefined; }
    return selected >= 0 && selected < hits.length ? `${listId}-${selected}` : undefined;
  });
  const many = (n: number | undefined, one: string, more: string) => `${(n ?? 0).toLocaleString()} ${n === 1 ? one : more}`;

  const summary = $derived.by(() => {
    if (!on) return "";
    if (layout === "map" && !searching) {
      if (!map) return "Laying out the vault…";
      const named = map.aisles.some((a) => !a.label.startsWith("Aisle "));
      return `${map.total.toLocaleString()} files in ${map.aisles.length} aisle${map.aisles.length === 1 ? "" : "s"}, ` +
        `grouped by what's in them${named || !map.aisles.length ? "" : " (named once the model has started)"}` +
        (strip ? "" : ` · ${status}`);
    }
    if (!searching) return strip ? "" : `Recent files · ${status}`;   // (what the rows are, and how reading is)
    if (busy && !answer) return "Searching…";
    if (!answer) return "";
    const matches = answer.strong;
    const words = answer.meaning ? "" : " · words only, while the model starts";
    if (!answer.hits.length) return `Nothing found${words}`;
    return (matches ? `${matches} match${matches === 1 ? "" : "es"}` : CLOSEST_LABEL) + words;
  });

  async function run(): Promise<void> {
    const mine = ++asked;
    if (!query.trim()) { answer = null; busy = false; selected = -1; return; }
    busy = true;
    try {
      const found = await controller.search(query, kinds);
      if (mine === asked) {
        answer = found; selected = 0; more = false;
        if (layout === "map") chosen = ranked[0]?.path ?? null;   // the first result named on the floor at once
      }
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
    else if (event.key === "Escape" && query) { query = ""; answer = null; selected = -1; event.preventDefault(); }
  }

  onMount(() => {
    input?.focus();
    void loadRecent();
    if (layout === "map") void loadMap();
    if (query.trim()) void run();
    let lastReady = controller.ready();
    const stop = controller.subscribe(() => {
      const wasOn = on;
      on = controller.on();
      status = own(controller.status());
      dark = controller.dark();
      reading = controller.reading();
      if (on && !wasOn) { void loadRecent(); if (layout === "map") void loadMap(); }   // just turned on: the files listed
      const ready = controller.ready();
      if (ready && !lastReady && answer && !answer.meaning) void run();   // the model came: by meaning now
      lastReady = ready;
    });
    const unfollow = controller.follow(() => {   // remade in the background as the vault is read (not polled)
      if (!searching) void loadRecent();
      if (layout === "map") void loadMap();
    });
    return () => { stop(); unfollow(); window.clearTimeout(timer); };
  });
</script>

<div class="dowse-panel" class:theme-dark={dark}>
  {#if !on}
    <div class="dowse-off">
      <h2>Search this vault by what's in it</h2>
      <p>Describe a note, a PDF or a canvas in your own words, in any of 100+ languages: Dowse finds it, at the right
        line or page. Everything stays on this computer.</p>
      <ol class="dowse-steps">
        <li><b>It downloads its search model</b>, once for all your vaults: 542 MB, from Hugging Face.</li>
        <li><b>It reads this vault in the background</b>: {many(counts.note, "note", "notes")},
          {many(counts.pdf, "PDF", "PDFs")} and {many(counts.canvas, "canvas", "canvases")}. You can keep working, search
          what's read so far, and pause it.</li>
        <li><b>Then it keeps up as you write.</b> Images, recordings and videos are found by name; Settings › Dowse can
          read what's in them too.</li>
        <li><b>Beside your notes</b>, “Like this note” shows what's like the one open, and links it in a click (the
          status bar's Dowse menu opens it).</li>
      </ol>
      <button class="mod-cta" onclick={() => controller.turnOn()}>Turn on for this vault</button>
      <p class="dowse-quiet">Folders and files can be left out (right-click, “Dowse: stop searching”), and Dowse turned
        off or its index deleted in Settings › Dowse.</p>
    </div>
  {:else}
    <div class="dowse-head">
      <div class="dowse-search-row">
        <div class="dowse-search">
          <Icon name="search" size={18} />
          <input bind:this={input} type="search" placeholder="Describe what you remember" bind:value={query}
                 oninput={changed} onkeydown={keys} spellcheck="false" aria-label="Search the vault"
                 role="combobox" aria-autocomplete="list" aria-expanded={searching && hits.length > 0}
                 aria-controls={listId} aria-activedescendant={current} />
        </div>
        <div class="dowse-layout" role="radiogroup" use:radios aria-label="Show results as">
          <button class="clickable-icon" class:is-active={layout === "wall"} aria-label="As a wall" role="radio"
                  aria-checked={layout === "wall"} tabindex={(layout === "wall") ? 0 : -1} onclick={() => setLayout("wall")}><Icon name="wall" size={16} /></button>
          <button class="clickable-icon" class:is-active={layout === "list"} aria-label="As a list" role="radio"
                  aria-checked={layout === "list"} tabindex={(layout === "list") ? 0 : -1} onclick={() => setLayout("list")}><Icon name="list" size={16} /></button>
          <button class="clickable-icon" class:is-active={layout === "map"} aria-label="Explore: the whole vault, by what's in it"
                  role="radio" aria-checked={layout === "map"} tabindex={(layout === "map") ? 0 : -1} onclick={() => setLayout("map")}><Icon name="map" size={16} /></button>
        </div>
      </div>
      <div class="dowse-bar">
        <div class="dowse-kinds" role="radiogroup" use:radios aria-label="Kinds of files">
          {#each kindsHere as [id, label]}
            <button class="dowse-chip" class:is-active={kind === id} role="radio" aria-checked={kind === id} tabindex={(kind === id) ? 0 : -1}
                    onclick={() => { kind = id; void run(); }}>{label}</button>
          {/each}
        </div>
      </div>
      {#if strip}
        <div class="dowse-strip">
          <span class="dowse-unseen" role="status">{heard}</span>
          <div class="dowse-strip-text" aria-hidden="true">
            <span>{strip.text}</span>
            {#if strip.note}<span class="dowse-quiet">{strip.note}</span>{/if}
          </div>
          {#if strip.retry}<button onclick={() => controller.retry()}>Try again</button>
          {:else if strip.resume}<button onclick={() => controller.pause(false)}>Resume</button>
          {:else if strip.pause}<button onclick={() => controller.pause(true)}>Pause</button>{/if}
          {#if strip.part !== null}<div class="dowse-strip-bar" style:--part={strip.part}></div>{/if}
        </div>
      {/if}
      <div class="dowse-summary" aria-live="polite">{summary}</div>
    </div>
    {#if layout !== "list" && searching && hits.length}
      <ul class="dowse-unseen" role="listbox" id={listId} aria-label="Results">
        {#each hits as hit, i (hit.path + ":" + hit.loc)}
          <li role="option" id={`${listId}-${i}`} aria-selected={`${listId}-${i}` === current}>
            {answer && answer.strong > 0 && i >= answer.strong ? "Less likely: " : ""}{titleOf(hit)}, {lineOf(hit)}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="dowse-body" class:dowse-floor={layout === "map"}>
      {#if layout === "map"}
        {#if mapPieces.length}
          <MapFloor bind:this={floor} pieces={mapPieces} aisles={mapAisles} {found} {scores} {clear} {matches} {dark}
                    selected={chosen}
                    picture={(piece, px) => controller.picture(pieceOf(shownFor(piece.path), { strong: true }), px, [])}
                    onselect={(piece) => (chosen = piece.path)}
                    onopen={(piece) => controller.open(shownFor(piece.path), false)}
                    onhover={(event, piece, target) => controller.hover(event, piece.path, target)}
                    ondragout={(piece, event) => dragLink(event, controller.link(piece.path), piece.name)}
                    onstep={(step) => { const path = rankedStep(ranked.map((h) => h.path), chosen, step);
                                        if (path) { chosen = path; floor?.focusResult(path); } }} />
          {#if searching && answer && rail.length}
            <!-- The floor's numbers, named: the first few results, as the badges number them -->
            <ol class="dowse-rail" aria-label="Results on the floor">
              {#each rail as hit, i (hit.path)}
                <li><button class:is-on={chosen === hit.path} tabindex="-1"
                            onclick={() => { chosen = hit.path; floor?.focusResult(hit.path); }}>
                  <span class="dowse-rail-rank">{i + 1}</span><span class="dowse-rail-title">{titleOf(hit)}</span>
                </button></li>
              {/each}
            </ol>
          {/if}
        {:else if map}
          <div class="dowse-empty">{kinds.length ? "No files of this kind on the floor." : "Files appear here as Dowse reads them."}</div>
        {/if}
      {:else if layout === "wall" && pieces.length}
        <Wall {pieces} collectionKeys={latest.map((r) => r.path)} selected={searching && hits.length ? Math.min(selected, hits.length - 1) : -1}
              terms={answer?.terms ?? []} {searching} {clear} {dark}
              picture={(piece, px, terms) => controller.picture(piece, px, terms)}
              onselect={(i) => (selected = i)} onopen={(i) => { const item = shown[i]; if (item) controller.open(item, false); }}
              ondragout={(i, event) => { const piece = pieces[i]; if (piece) dragLink(event, controller.link(piece.path), piece.name); else event.preventDefault(); }} />
      {:else if shown.length}
        <ResultList items={shown} {selected} {controller} onselect={(i) => (selected = i)}
                    strong={searching && answer ? answer.strong : null} id={listId}
                    more={searching && !more && hits.length > shown.length ? hits.length - shown.length : 0}
                    onmore={() => (more = true)} />
      {:else if searching && answer && !busy}
        <div class="dowse-empty">Nothing in this vault matches “{query}”.</div>
      {:else if !searching}
        <div class="dowse-empty">{status}</div>
      {/if}
    </div>
  {/if}
</div>
