<script lang="ts">
  // The Dowse tab: the vault searched by what's in it. Before a search, the wall holds the vault's latest files; a
  // search gathers clear matches in front of them (the fisheye wall) or lists them, with the words found. Or the whole
  // vault on Explore's floor, in aisles of files that are alike, where a search shows what it found where it stands.
  // Before Dowse is on here, what turning it on does; while a lot is being read, how far it is and how long is left.
  import { onMount } from "svelte";
  import Wall from "./wall/Wall.svelte";
  import Icon from "./wall/Icon.svelte";
  import ResultList from "./ResultList.svelte";
  import MediaMoments from "./MediaMoments.svelte";
  import MapFloor, { type MapAisle, type MapPiece } from "./explore/MapFloor.svelte";
  import { rankedStep } from "./explore/explore-view.ts";
  import type { ExploreGrouping, ExploreMap } from "../engine/search/explore.ts";
  import { CLOSEST_LABEL } from "./wall/search-confidence.ts";
  import { folderOf, lineOf, nameOf, pieceOf, shownOf, titleOf, VISUAL, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";
  import type { Answer } from "../plugin/search.ts";
  import { heldText, modelTrouble, timeLeft } from "../plugin/status.ts";
  import { dragLink } from "./drag.ts";
  import { radios } from "./radios.ts";
  import { dateRange, filtersFor, meetsFilters } from "../plugin/filters.ts";
  import { KIND_NAME } from "./results.ts";

  let { controller, initial = "" }: { controller: Controller; initial?: string } = $props();

  const KINDS: [string, string, string[]][] = [
    ["all", "All", []], ["note", "Notes", ["note"]], ["pdf", "PDFs", ["pdf"]], ["canvas", "Canvases", ["canvas"]],
    ["image", "Images", ["image"]], ["audio", "Recordings", ["audio"]], ["video", "Videos", ["video"]],
  ];
  const stored = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };

  // svelte-ignore state_referenced_locally
  let query = $state(initial);   // (the tab's first query: read once)
  let kind = $state("all");
  let folders = $state<string[]>([]);
  let from = $state("");
  let to = $state("");
  let inferDate = $state(true);
  let inferKinds = $state(true);
  // svelte-ignore state_referenced_locally
  let folderOptions = $state(controller.folders());
  let error = $state("");
  const dateSpan = $derived(dateRange(from, to));
  const options = $derived({ within: folders, dateSpan, inferDate, inferKinds });
  const LAYOUTS = ["wall", "list", "map"];
  // The list first (it reads at any size); the wall and the map a click away, and remembered once chosen
  let layout = $state(LAYOUTS.includes(stored("dowse-layout", "list")) ? stored("dowse-layout", "list") : "list");
  let grouping = $state<ExploreGrouping>(stored("dowse-explore-grouping", "content") === "folder" ? "folder" : "content");
  let answer = $state<Answer | null>(null);
  let recent = $state<Shown[]>([]);
  let selected = $state(-1);   // (none until a search, or ↑/↓: a row lit before anything was done meant nothing)
  let busy = $state(false);
  let searchIntent = $state(0);   // user searches move the camera; background index refreshes keep the current view
  // svelte-ignore state_referenced_locally
  let on = $state(controller.on());   // (the controller stays the same; these follow it by subscription)
  // svelte-ignore state_referenced_locally
  let selection = $state(controller.selection());
  const own = (text: string) => text.replace(/^Dowse · /, "");   // (in Dowse's own tab, its name goes without saying)
  // svelte-ignore state_referenced_locally
  let status = $state(own(controller.status()));
  // svelte-ignore state_referenced_locally
  let dark = $state(controller.dark());
  // svelte-ignore state_referenced_locally
  let reading = $state(controller.reading());
  // svelte-ignore state_referenced_locally
  let parts = $state(controller.parts());
  // svelte-ignore state_referenced_locally
  let counts = $state(controller.counts());
  // The kinds this vault has (and the one chosen): a chip for a kind with no file in it is a choice that can't matter
  const kindsHere = $derived(KINDS.filter(([id, , of]) => !of.length || of.some((k) => (counts[k] ?? 0) > 0) || id === kind));
  let input = $state<HTMLInputElement>();
  let map = $state<ExploreMap | null>(null);
  let mapError = $state("");
  let mapAsked = 0;
  let chosen = $state<string | null>(null);   // the case picked on the floor
  let floor = $state<MapFloor | null>(null);
  let asked = 0;
  let timer = 0;

  const searching = $derived(query.trim().length > 0 || folders.length > 0 || !!dateSpan);
  const hits = $derived.by(() => { void selection; return searching && answer ? answer.hits.filter(h => controller.active(h.path)).map(shownOf) : []; });
  const matchCount = $derived.by(() => { void selection; return answer?.hits.slice(0, answer.strong).filter(h => controller.active(h.path)).length ?? 0; });
  const clear = $derived(!answer || matchCount > 0);
  const kinds = $derived(KINDS.find(([id]) => id === kind)?.[2] ?? []);
  const applied = $derived(filtersFor(query, { ...options, kinds }));
  // Before a search, the vault's latest files, of the kinds chosen (the chips filter them too)
  const latest = $derived.by(() => { void selection; return recent.filter(item => controller.active(item.path) && meetsFilters(item, applied)); });
  // A search's list: its matches, and what's less likely folded into one row (opened when asked); with no clear match,
  // the closest ten (they're the answer then)
  let more = $state(false);
  const cut = $derived(!answer ? hits.length : matchCount > 0 ? matchCount : 10);
  const listed = $derived(more ? hits : hits.slice(0, cut));
  const shown: Shown[] = $derived(searching ? (layout === "list" ? listed : hits) : latest);

  const pieces = $derived.by(() => {
    if (!searching) return latest.map((item) => pieceOf(item, { strong: true }));
    const strong = matchCount;
    const found = hits.map((hit, i) => pieceOf(hit, { strong: clear && i < strong, closest: !clear || i >= strong, score: hit.score }));
    const seen = new Set(hits.map((h) => h.path));
    const rest = latest.filter((item) => !seen.has(item.path)).map((item) => pieceOf(item, { strong: false, back: true }));
    return [...found, ...rest];
  });

  // The floor: the map's cases of the kinds chosen; a search shows its results where they stand
  const collectionFiles = $derived(new Map(recent.map(file => [file.path, file])));
  const mapPieces: MapPiece[] = $derived.by(() => { void selection;
    return (map?.pieces ?? []).filter(p => controller.active(p.path) && meetsFilters(collectionFiles.get(p.path) ?? p, applied))
      .map(p => ({ ...p, name: nameOf(p.path), folder: folderOf(p.path) || "/", visual: VISUAL.has(p.kind), version: collectionFiles.get(p.path)?.mtime }));
  });
  const mapAisles: MapAisle[] = $derived.by(() => {
    void selection;
    if (!applied.kinds.length && !applied.within.length && !applied.date) return map?.aisles ?? [];
    const counts = new Map<number, number>();
    for (const aisle of map?.aisles ?? []) {
      const count = (map?.membership[aisle.id] ?? []).filter(path => {
        const file = collectionFiles.get(path);
        return file && controller.active(path) && meetsFilters(file, applied);
      }).length;
      if (count) counts.set(aisle.index, count);
    }
    return (map?.aisles ?? []).filter((a) => counts.has(a.index)).map((a) => ({ ...a, count: counts.get(a.index)! }));
  });
  const onFloor = $derived(new Set(mapPieces.map((p) => p.path)));
  const ranked = $derived(hits.filter((h) => onFloor.has(h.path)));
  const found = $derived(searching && answer ? new Map(ranked.map((h, i) => [h.path, i])) : null);
  const scores = $derived(found ? new Map(ranked.map((h) => [h.path, h.score ?? 0])) : null);
  const matches = $derived(new Set(hits.slice(0, matchCount).map((h) => h.path)));
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
  const both = (a: string, b: string) => [a, b].filter((x) => !x.startsWith("0 ")).join(" and ");

  // The first screen: the model's parts for this vault's pictures and sound, offered with their size (checked when the
  // vault has such files: unread, they're found by their names only, and a search for what they show finds nothing)
  // svelte-ignore state_referenced_locally
  let wantImages = $state(Boolean(counts.image || counts.video));
  // svelte-ignore state_referenced_locally
  let wantSound = $state(Boolean(counts.audio || counts.video));

  // Files only found by name (their part is off), said where they may be what's looked for: their kind chosen, among
  // a search's results, or a search with no clear match (what it describes may be in a picture or a recording)
  const unread = $derived.by(() => {
    const out: { part: "images" | "sound"; text: string; button: string }[] = [];
    const wanted = (k: string[]) => kinds.some((x) => k.includes(x))
      || (searching && !!answer && !busy && (matchCount === 0 || hits.some((h) => k.includes(h.kind))));
    if (!parts.images && (counts.image || counts.video) && wanted(["image", "video"]))
      out.push({ part: "images", button: "Read images (336 MB)",
                 text: `${both(many(counts.image, "image", "images"), many(counts.video, "video", "videos"))}: found by their names only, until Dowse reads what they show.` });
    if (!parts.sound && (counts.audio || counts.video) && wanted(["audio", "video"]))
      out.push({ part: "sound", button: "Read sound (587 MB)",
                 text: `${both(many(counts.audio, "recording", "recordings"), many(counts.video, "video", "videos"))}: found by their names only, until Dowse listens to them.` });
    return out;
  });

  const summary = $derived.by(() => {
    if (!on) return "";
    if (layout === "map" && !searching) {
      if (!map) return "Laying out the vault…";
      if (grouping === "folder") return `${map.total.toLocaleString()} files in ${map.aisles.length} folder group${map.aisles.length === 1 ? "" : "s"}, grouped by folder` +
        (strip ? "" : ` · ${status}`);
      const named = map.aisles.some((a) => !a.label.startsWith("Aisle "));
      return `${map.total.toLocaleString()} files in ${map.aisles.length} aisle${map.aisles.length === 1 ? "" : "s"}, ` +
        `grouped by what's in them${named || !map.aisles.length ? "" : " (named once the model has started)"}` +
        (strip ? "" : ` · ${status}`);
    }
    if (!searching) return `${latest.length.toLocaleString()} file${latest.length === 1 ? "" : "s"}${strip ? "" : ` · ${status}`}`;
    if (busy) return "Searching…";
    if (!answer) return "";
    if (!query.trim()) return `${answer.hits.length.toLocaleString()} file${answer.hits.length === 1 ? "" : "s"}`;
    const matches = matchCount;
    const words = answer.meaning ? "" : " · words only, while the model starts";
    if (!answer.hits.length) return `Nothing found${words}`;
    return (matches ? `${matches} match${matches === 1 ? "" : "es"}` : CLOSEST_LABEL) + words;
  });

  /** The search asked. `again`: the same one, asked again as more of the vault is read (what's chosen stays chosen,
   * what's opened stays open, nothing shows as searching). */
  async function run(again = false): Promise<void> {
    const mine = ++asked;
    if (!query.trim() && !folders.length && !dateSpan) { answer = null; busy = false; selected = -1; chosen = null; searchIntent++; return; }
    if ((from || to) && !dateSpan) { error = "Choose a valid date range, with the start before the end."; busy = false; return; }
    error = "";
    const kept = again ? shown[selected]?.path : undefined;
    if (!again) busy = true;
    try {
      const found = await controller.search(query, kinds, options);
      if (mine === asked) {
        answer = found;
        if (!again) searchIntent++;
        if (again) {
          const at = kept ? found.hits.findIndex((h) => h.path === kept) : -1;
          selected = at >= 0 ? at : selected >= 0 ? 0 : -1;
        } else {
          selected = 0; more = false;
        }
        if (layout === "map" && (!again || !found.hits.some(h => h.path === chosen)))
          chosen = found.hits.find(h => onFloor.has(h.path))?.path ?? null;
      }
    } catch (e) {
      if (mine === asked) error = "Search could not finish. Try again.";
    } finally {
      if (mine === asked) busy = false;
    }
  }

  function changed(): void {
    inferDate = true; inferKinds = true;
    asked++;   // invalidate an old response immediately, including during the debounce interval
    window.clearTimeout(timer);
    if (!query.trim()) { void run(); return; }
    busy = true;
    timer = window.setTimeout(() => void run(), 150);
  }

  async function loadRecent(): Promise<void> {
    try { if (controller.on()) recent = await controller.recent(); }
    catch { /* A view may close while its index is shutting down. */ }
  }

  async function loadMap(): Promise<void> {
    if (!controller.on()) return;
    const mine = ++mapAsked, mode = grouping;
    try {
      const next = await controller.explore(mode);
      if (mine === mapAsked && mode === grouping) {
        if (next !== map) map = next;
        if (searching && (!chosen || !ranked.some(h => h.path === chosen))) chosen = ranked[0]?.path ?? null;
        mapError = "";
      }
    } catch {
      if (mine === mapAsked) mapError = "The map could not load. Try again.";
    }
  }

  function setGrouping(next: ExploreGrouping): void {
    if (next === grouping) return;
    grouping = next; map = null; mapError = ""; chosen = null;
    try { localStorage.setItem("dowse-explore-grouping", next); } catch { /* private storage */ }
    void loadMap();
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
    if (next === "map") { if (searching && !ranked.some(h => h.path === chosen)) chosen = ranked[0]?.path ?? null; void loadMap(); }
    try { localStorage.setItem("dowse-layout", next); } catch { /* private storage */ }
  }

  function folderChanged(path: string, checked: boolean): void {
    folders = checked ? [...folders, path] : folders.filter(p => p !== path);
    void run();
  }

  function removeDate(): void { from = ""; to = ""; inferDate = false; void run(); }
  function removeKind(): void { kind = "all"; inferKinds = false; void run(); }

  function keys(event: KeyboardEvent): void {
    if (busy && event.key === "Enter") { event.preventDefault(); return; }
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
    else if (event.key === "Escape" && query) { query = ""; void run(); event.preventDefault(); }
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
      selection = controller.selection();
      status = own(controller.status());
      dark = controller.dark();
      reading = controller.reading();
      parts = controller.parts();
      if (on && !wasOn) { void loadRecent(); if (layout === "map") void loadMap(); }   // just turned on: the files listed
      const ready = controller.ready();
      if (ready && !lastReady && answer && !answer.meaning) void run();   // the model came: by meaning now
      lastReady = ready;
    });
    const unfollow = controller.follow(() => {   // remade in the background as the vault is read (not polled)
      counts = controller.counts(); folderOptions = controller.folders();
      if (searching && answer && !busy) void run(true);   // what's newly read may be what's looked for
      void loadRecent();   // refresh modification dates and preview versions even while a search is open
      if (layout === "map") void loadMap();
    });
    return () => { stop(); unfollow(); asked++; mapAsked++; window.clearTimeout(timer); };
  });
</script>

<div class="dowse-panel" class:theme-dark={dark}>
  {#if !on}
    <div class="dowse-off">
      <h2>Search this vault by what's in it</h2>
      {#if controller.problem()}<p role="alert">{controller.problem()}</p>{/if}
      <p>Describe a note, a PDF or a canvas in your own words, in any of 100+ languages: Dowse finds it, at the right
        line or page. Everything stays on this computer.</p>
      <ol class="dowse-steps">
        <li><b>It downloads its search model</b>, once for all your vaults: 542 MB, from Hugging Face.</li>
        <li><b>It reads this vault in the background</b>: {many(counts.note, "note", "notes")},
          {many(counts.pdf, "PDF", "PDFs")} and {many(counts.canvas, "canvas", "canvases")}. You can keep working, search
          what's read so far, and pause it.</li>
        <li><b>Then it keeps up as you write.</b></li>
        <li><b>Beside your notes</b>, “Like this note” shows what's like the one open, and links it in a click (the
          status bar's Dowse menu opens it).</li>
      </ol>
      {#if counts.image || counts.video || counts.audio}
        <div class="dowse-parts">
          {#if counts.image || counts.video}
            <label><input type="checkbox" bind:checked={wantImages} />
              <span>Read what its {both(many(counts.image, "image", "images"), many(counts.video, "video", "videos"))} show
                <span class="dowse-quiet">· 336 MB more</span></span></label>
          {/if}
          {#if counts.audio || counts.video}
            <label><input type="checkbox" bind:checked={wantSound} />
              <span>Listen to its {both(many(counts.audio, "recording", "recordings"), many(counts.video, "video", "videos"))}
                <span class="dowse-quiet">· 587 MB more</span></span></label>
          {/if}
          <span class="dowse-quiet">Unchecked, they're found by their names only (Settings › Dowse can turn them on later).</span>
        </div>
      {/if}
      <button class="mod-cta" disabled={!!controller.problem()} onclick={() => controller.turnOn({ images: wantImages, sound: wantSound })}>Turn on for this vault</button>
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
          <button class="clickable-icon" class:is-active={layout === "map"} aria-label="Explore: the whole vault"
                  role="radio" aria-checked={layout === "map"} tabindex={(layout === "map") ? 0 : -1} onclick={() => setLayout("map")}><Icon name="map" size={16} /></button>
        </div>
      </div>
      {#if layout === "map"}
        <div class="dowse-grouping">
          <span>Group</span>
          <div class="dowse-kinds" role="radiogroup" use:radios aria-label="Group Explore by">
            <button class="dowse-chip" class:is-active={grouping === "content"} role="radio" aria-checked={grouping === "content"}
                    tabindex={grouping === "content" ? 0 : -1} onclick={() => setGrouping("content")}
                    title="Automatically group files with similar content">By content</button>
            <button class="dowse-chip" class:is-active={grouping === "folder"} role="radio" aria-checked={grouping === "folder"}
                    tabindex={grouping === "folder" ? 0 : -1} onclick={() => setGrouping("folder")}
                    title="Group files by their parent folder; root files have their own group">By folder</button>
          </div>
        </div>
      {/if}
      <div class="dowse-bar">
        <div class="dowse-kinds" role="radiogroup" use:radios aria-label="Kinds of files">
          {#each kindsHere as [id, label]}
            <button class="dowse-chip" class:is-active={kind === id} role="radio" aria-checked={kind === id} tabindex={(kind === id) ? 0 : -1}
                    onclick={() => { kind = id; inferKinds = id !== "all"; void run(); }}>{label}</button>
          {/each}
        </div>
        <div class="dowse-filter-controls">
          <details class="dowse-filter-picker">
            <summary><Icon name="folder" size={14} /> Folders{folders.length ? ` (${folders.length})` : ""}</summary>
            <div class="dowse-folder-options">
              {#if !folderOptions.length}<span>No folders in this vault.</span>{/if}
              {#each folderOptions as path}
                <label><input type="checkbox" checked={folders.includes(path)} onchange={(e) => folderChanged(path, e.currentTarget.checked)} />
                  <span>{path === "/" ? "Vault root files" : path}</span></label>
              {/each}
            </div>
          </details>
          <details class="dowse-filter-picker">
            <summary><Icon name="clock" size={14} /> Date</summary>
            <div class="dowse-date-options">
              <label>From <input type="date" bind:value={from} onchange={() => { inferDate = false; void run(); }} /></label>
              <label>Through <input type="date" bind:value={to} onchange={() => { inferDate = false; void run(); }} /></label>
              <button onclick={removeDate}>Clear date</button>
            </div>
          </details>
        </div>
      </div>
      {#if folders.length || applied.date || applied.kinds.length}
        <div class="dowse-filter-chips" aria-label="Active search filters">
          {#each folders as path}<button class="dowse-chip" aria-label={`Remove folder filter ${path}`} onclick={() => folderChanged(path, false)}>
            Folder: {path === "/" ? "Vault root files" : path} ×</button>{/each}
          {#if applied.date}<button class="dowse-chip" onclick={removeDate} aria-label="Remove date filter">
            Date: {applied.date.label}{applied.inferredDate ? " (from query)" : ""} ×</button>{/if}
          {#if applied.kinds.length}<button class="dowse-chip" onclick={removeKind} aria-label="Remove file type filter">
            Type: {applied.kinds.map(k => KIND_NAME[k] ?? k).join(", ")}{applied.inferredKinds ? " (from query)" : ""} ×</button>{/if}
        </div>
      {/if}
      {#if error}<p class="dowse-search-error" role="alert">{error}</p>{/if}
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
      {#each unread as notice (notice.part)}
        <div class="dowse-unread">
          <span>{notice.text}</span>
          <button onclick={() => void controller.setParts(notice.part === "images" ? { images: true } : { sound: true })}>{notice.button}</button>
        </div>
      {/each}
      <div class="dowse-summary" aria-live="polite">{summary}</div>
      {#if searching && !busy && layout !== "list"}
        {@const media = layout === "map" ? hits.find(h => h.path === chosen) : shown[selected]}
        {#if media}<MediaMoments item={media} {controller} />{/if}
      {/if}
    </div>
    {#if layout !== "list" && searching && hits.length}
      <ul class="dowse-unseen" role="listbox" id={listId} aria-label="Results">
        {#each hits as hit, i (hit.path + ":" + hit.loc)}
          <li role="option" id={`${listId}-${i}`} aria-selected={`${listId}-${i}` === current}>
            {answer && matchCount > 0 && i >= matchCount ? "Less likely: " : ""}{titleOf(hit)}, {lineOf(hit)}
          </li>
        {/each}
      </ul>
    {/if}
    <div class="dowse-body" class:dowse-floor={layout === "map"} aria-busy={busy}>
      {#if layout === "map"}
        {#if mapError}
          <div class="dowse-empty" role="alert">{mapError} <button onclick={() => void loadMap()}>Try again</button></div>
        {:else if mapPieces.length}
          <MapFloor bind:this={floor} pieces={mapPieces} aisles={mapAisles} {found} {scores} {clear} {matches} {dark} {searchIntent}
                    selected={chosen}
                    picture={(piece, px) => controller.picture(pieceOf(shownFor(piece.path), { strong: true }), px,
                                                               found?.has(piece.path) ? answer?.terms ?? [] : [])}
                    onselect={(piece) => (chosen = piece.path)}
                    onopen={(piece) => { if (!busy) controller.open(shownFor(piece.path), false); }}
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
          <div class="dowse-empty">{applied.kinds.length || applied.within.length || applied.date ? "No files meet these filters on the floor." : "Files appear here as Dowse reads them."}</div>
        {:else}
          <div class="dowse-empty" role="status">Laying out the vault…</div>
        {/if}
      {:else if layout === "wall" && pieces.length}
        <Wall {pieces} collectionKeys={latest.map((r) => r.path)} selected={searching && hits.length ? Math.min(selected, hits.length - 1) : -1}
              terms={answer?.terms ?? []} {searching} {clear} {dark}
              picture={(piece, px, terms) => controller.picture(piece, px, terms)}
              onselect={(i) => (selected = i)} onopen={(i) => { const item = shown[i]; if (item && !busy) controller.open(item, false); }}
              ondragout={(i, event) => { const piece = pieces[i]; if (piece) dragLink(event, controller.link(piece.path), piece.name); else event.preventDefault(); }} />
      {:else if shown.length}
        <ResultList items={shown} {selected} {controller} pending={busy} onselect={(i) => (selected = i)}
                    strong={searching && answer ? matchCount : null} id={listId}
                    more={searching && !more && hits.length > shown.length ? hits.length - shown.length : 0}
                    onmore={() => (more = true)} />
      {:else if searching && answer && !busy}
        <div class="dowse-empty">{query.trim() ? `Nothing in this vault matches “${query}”.` : "No files meet these filters."}</div>
      {:else if !searching}
        <div class="dowse-empty">{status}</div>
      {/if}
    </div>
  {/if}
</div>
