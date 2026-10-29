<script lang="ts">
  // The sidebar: notes and files like the one open, from its own vectors (the model isn't needed), as it changes. Each
  // says whether the open note links to it (or it to the open note) already; the others can be linked from here, at
  // the note's cursor (or at its end, when it isn't being edited). "Not linked yet" leaves only those.
  import { onMount } from "svelte";
  import Icon from "./wall/Icon.svelte";
  import ResultList from "./ResultList.svelte";
  import { shownOf, titleOf, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";

  let { controller, current }: { controller: Controller; current: () => string | null } = $props();

  const stored = () => { try { return localStorage.getItem("dowse-similar-unlinked") === "1"; } catch { return false; } };
  let path = $state<string | null>(null);
  let found = $state<Shown[]>([]);
  let linked = $state(new Set<string>());
  let unlinkedOnly = $state(stored());
  let note = $state("");
  let strongCount = $state(0);   // how many of `found` are clearly alike (the rest only close)
  let more = $state(false);
  let asked = 0;

  // The clearly alike first, then the first few only close, the rest when asked (as the Dowse tab's list)
  const CLOSE_SHOWN = 5;
  const filtered = $derived(unlinkedOnly ? found.filter((item) => !linked.has(item.path)) : found);
  const strong = $derived.by(() => {
    const clear = new Set(found.slice(0, strongCount).map((item) => item.path));
    return filtered.filter((item) => clear.has(item.path)).length;
  });
  const items = $derived(more ? filtered : filtered.slice(0, strong > 0 ? strong + CLOSE_SHOWN : 10));

  async function refresh(): Promise<void> {
    const mine = ++asked;
    path = current();
    if (!controller.on()) { found = []; note = "Turn Dowse on for this vault to see what's like the open file."; return; }
    if (!path) { found = []; note = "Open a note to see what's like it."; return; }
    const answer = await controller.similar(path);
    if (mine !== asked) return;
    found = answer.hits.slice(0, 20).map(shownOf);
    strongCount = answer.strong;
    more = false;
    linked = controller.linked(path);
    note = found.length ? "" : "Nothing like it yet (it may not be read yet).";
  }

  /** The links changed (the note was edited, or linked from here). */
  export function relink(): void {
    if (path) linked = controller.linked(path);
  }

  async function link(item: Shown): Promise<void> {
    if (!path) return;
    await controller.insertLink(path, item.path);
    linked = new Set([...linked, item.path]);
  }

  function setUnlinked(on: boolean): void {
    unlinkedOnly = on;
    try { localStorage.setItem("dowse-similar-unlinked", on ? "1" : "0"); } catch { /* private storage */ }
  }

  onMount(() => {
    void refresh();
    let last = "";
    const stop = controller.subscribe(() => {
      const now = `${current()}|${controller.on()}`;
      if (now !== last) { last = now; void refresh(); }
    });
    return stop;
  });

  export function update(): void {
    void refresh();
  }
</script>

<div class="dowse-similar">
  {#if path && found.length}
    <div class="dowse-similar-head">Like <b>{titleOf({ path, kind: "note", loc: null, locEnd: null, excerpt: null, info: {} })}</b></div>
    <div class="dowse-similar-filter" role="radiogroup" aria-label="Which to show">
      <button class="dowse-chip" class:is-active={!unlinkedOnly} role="radio" aria-checked={!unlinkedOnly}
              onclick={() => setUnlinked(false)}>All</button>
      <button class="dowse-chip" class:is-active={unlinkedOnly} role="radio" aria-checked={unlinkedOnly}
              onclick={() => setUnlinked(true)}>Not linked yet</button>
    </div>
  {/if}
  {#if items.length}
    <ResultList {items} compact {controller} {strong} more={more ? 0 : filtered.length - items.length}
                onmore={() => (more = true)}>
      {#snippet aside(item: Shown)}
        {#if linked.has(item.path)}
          <span role="img" aria-label="Linked already" title="Linked already"><Icon name="link" size={14} /></span>
        {:else}
          <button class="dowse-link-button" title="Add a link to it in the open note" aria-label={`Link ${titleOf(item)}`}
                  onclick={(event) => { event.stopPropagation(); void link(item); }}>Link</button>
        {/if}
      {/snippet}
    </ResultList>
  {:else if found.length}
    <div class="dowse-empty">All of these are linked already.</div>
  {:else}
    <div class="dowse-empty">{note}</div>
  {/if}
</div>
