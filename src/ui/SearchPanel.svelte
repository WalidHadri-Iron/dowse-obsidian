<script lang="ts">
  // The Dowse tab: the vault searched by what's in it. Before a search, the wall holds the vault's latest files; a
  // search gathers clear matches in front of them (the fisheye wall) or lists them, with the words found.
  import { onMount } from "svelte";
  import Wall from "./wall/Wall.svelte";
  import Icon from "./wall/Icon.svelte";
  import ResultList from "./ResultList.svelte";
  import { CLOSEST_LABEL } from "./wall/search-confidence.ts";
  import { pieceOf, shownOf, type Shown } from "./results.ts";
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
  let layout = $state(stored("dowse-layout", "wall") === "list" ? "list" : "wall");
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

  const summary = $derived.by(() => {
    if (!on) return "";
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

  /** Asked from outside (a command, a link): this query, now. */
  export function ask(next: string): void {
    query = next;
    void run();
  }

  function setLayout(next: string): void {
    layout = next;
    try { localStorage.setItem("dowse-layout", next); } catch { /* private storage */ }
  }

  function keys(event: KeyboardEvent): void {
    const items = shown;
    if (event.key === "ArrowDown") { selected = Math.min(selected + 1, items.length - 1); event.preventDefault(); }
    else if (event.key === "ArrowUp") { selected = Math.max(selected - 1, 0); event.preventDefault(); }
    else if (event.key === "Enter" && items[selected]) { controller.open(items[selected], event.ctrlKey || event.metaKey); event.preventDefault(); }
    else if (event.key === "Escape" && query) { query = ""; answer = null; event.preventDefault(); }
  }

  onMount(() => {
    input?.focus();
    void loadRecent();
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
    const refresh = window.setInterval(() => { if (!searching) void loadRecent(); }, 10000);
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
        </div>
      </div>
      <div class="dowse-summary" aria-live="polite">{summary}</div>
    </div>
    <div class="dowse-body">
      {#if layout === "wall" && pieces.length}
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
