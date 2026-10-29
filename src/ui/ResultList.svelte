<script lang="ts">
  // Results as a list, as Obsidian lists files: the kind's icon, the title, where it matched, the words found. The
  // search's matches first; after them, set apart and quieter, what's only close (`strong`: how many matched).
  import type { Snippet } from "svelte";
  import Icon from "./wall/Icon.svelte";
  import { KIND_ICON, lineOf, runs, titleOf, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";

  let { items, selected = -1, compact = false, controller, onselect, aside, strong = null, id = undefined, more = 0,
        onmore }: {
    items: Shown[];
    selected?: number;
    compact?: boolean;       // the sidebar's: no excerpts
    controller: Controller;
    onselect?: (index: number) => void;
    aside?: Snippet<[Shown]>;   // at the row's end (the sidebar's: linked, or a button to link it)
    strong?: number | null;     // a search's matches, the first so many (null: not a search)
    id?: string;                // the listbox's (the search field points into it); its options' are `${id}-${index}`
    more?: number;              // results left out (only close): a row offers them
    onmore?: () => void;
  } = $props();
  // The keyboard: one row in the Tab order (the selected one, else the first), ↑/↓ from row to row, Enter opens
  let focusAt = $state(0);
  const tabbable = $derived(selected >= 0 ? selected : focusAt);
  function step(event: KeyboardEvent, index: number): void {
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : -1;
    if (next < 0 || next >= items.length) return;
    event.preventDefault();
    focusAt = next;
    onselect?.(next);
    list?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
  }
  const close = (index: number) => strong !== null && strong > 0 && index >= strong;

  let list: HTMLElement;
  $effect(() => {
    if (selected >= 0) list?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function drag(event: DragEvent, item: Shown): void {
    const link = controller.link(item.path);
    if (link && event.dataTransfer) {
      event.dataTransfer.setData("text/plain", link);
      event.dataTransfer.effectAllowed = "copyLink";
    }
  }
</script>

<div class="dowse-results" class:compact bind:this={list} role="listbox" aria-label="Results" {id}>
  {#each items as item, index (item.path + ":" + item.loc)}
    {#if close(index) && index === strong}<div class="dowse-results-divider" aria-hidden="true">Not as close</div>{/if}
    <div class="dowse-result" class:is-selected={index === selected} class:is-close={close(index)} data-index={index}
         role="option" aria-selected={index === selected} tabindex={index === tabbable ? 0 : -1}
         id={id ? `${id}-${index}` : undefined} draggable="true" ondragstart={(e) => drag(e, item)}
         onmouseover={(e) => controller.hover(e, item.path, e.currentTarget as HTMLElement)}
         onfocus={() => { focusAt = index; onselect?.(index); }}
         onclick={(e) => { onselect?.(index); controller.open(item, e.ctrlKey || e.metaKey); }}
         onauxclick={(e) => { if (e.button === 1) controller.open(item, true); }}
         onkeydown={(e) => { if (e.key === "Enter") controller.open(item, e.ctrlKey || e.metaKey); else step(e, index); }}>
      <span class="dowse-result-icon"><Icon name={KIND_ICON[item.kind] ?? "file"} size={16} /></span>
      <div class="dowse-result-text">
        <div class="dowse-result-title">{#if close(index)}<span class="dowse-unseen">Not as close: </span>{/if}{titleOf(item)}</div>
        <div class="dowse-result-line">{lineOf(item)}</div>
        {#if item.excerpt && !compact}
          <div class="dowse-result-excerpt">
            {#each runs(item.excerpt) as run}{#if run.marked}<mark>{run.text}</mark>{:else}{run.text}{/if}{/each}
          </div>
        {/if}
      </div>
      {#if aside}<div class="dowse-result-aside">{@render aside(item)}</div>{/if}
    </div>
  {/each}
</div>
{#if more && onmore}
  <button class="dowse-more" onclick={onmore}>Show {more} more that {more === 1 ? "is" : "are"} only close</button>
{/if}
