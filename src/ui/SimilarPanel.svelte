<script lang="ts">
  // The sidebar: notes and files like the one open, from its own vectors (the model isn't needed), as it changes.
  import { onMount } from "svelte";
  import ResultList from "./ResultList.svelte";
  import { shownOf, titleOf, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";

  let { controller, current }: { controller: Controller; current: () => string | null } = $props();

  let path = $state<string | null>(null);
  let items = $state<Shown[]>([]);
  let note = $state("");
  let asked = 0;

  async function refresh(): Promise<void> {
    const mine = ++asked;
    path = current();
    if (!controller.on()) { items = []; note = "Turn Dowse on for this vault to see what's like the open file."; return; }
    if (!path) { items = []; note = "Open a note to see what's like it."; return; }
    const answer = await controller.similar(path);
    if (mine !== asked) return;
    items = answer.hits.slice(0, 20).map(shownOf);
    note = items.length ? "" : "Nothing like it yet (it may not be read yet).";
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
  {#if path && items.length}
    <div class="dowse-similar-head">Like <b>{titleOf({ path, kind: "note", loc: null, locEnd: null, excerpt: null, info: {} })}</b></div>
  {/if}
  {#if items.length}
    <ResultList {items} compact {controller} />
  {:else}
    <div class="dowse-empty">{note}</div>
  {/if}
</div>
