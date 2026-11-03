<script lang="ts">
  // Results as a list, as Obsidian lists files: the kind's icon, the title, where it matched, the words found. The
  // search's matches first; after them, set apart and quieter, what's only close (`strong`: how many matched).
  import type { Snippet } from "svelte";
  import { onMount, tick, untrack } from "svelte";
  import Icon from "./wall/Icon.svelte";
  import MediaMoments from "./MediaMoments.svelte";
  import { KIND_ICON, lineOf, runs, titleOf, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";

  let { items, selected = -1, compact = false, controller, onselect, aside, strong = null, id = undefined, more = 0,
        onmore, pending = false }: {
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
    pending?: boolean;
  } = $props();
  // The keyboard: one row in the Tab order (the selected one, else the first), ↑/↓ from row to row, Enter opens
  let focusAt = $state(0);
  async function step(event: KeyboardEvent, index: number): Promise<void> {
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : -1;
    if (next < 0 || next >= items.length) return;
    event.preventDefault();
    focusAt = next;
    onselect?.(next);
    reveal(next);
    await tick();
    list?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
  }
  const close = (index: number) => strong !== null && index >= strong;
  const virtual = $derived(items.length > 100 && !compact);
  const rowHeight = $derived(items.some(item => (item.kind === "audio" || item.kind === "video") && item.loc !== null) ? 120 : 88);
  let first = $state(0);
  let visibleCount = $state(30);
  const start = $derived(virtual ? Math.min(first, Math.max(0, items.length - 1)) : 0);
  const visible = $derived(virtual ? items.slice(start, start + visibleCount) : items);
  const desiredFocus = $derived(selected >= 0 ? selected : focusAt);
  const tabbable = $derived(virtual ? Math.max(start, Math.min(desiredFocus, start + visible.length - 1)) : desiredFocus);
  let scroller: HTMLElement | null = null;

  function reveal(index: number): void {
    if (virtual && scroller && (index < start || index >= start + visibleCount)) {
      first = Math.max(0, index - 3);
      scroller.scrollTop = first * rowHeight;
    }
  }

  onMount(() => {
    scroller = list.closest<HTMLElement>(".dowse-body, .dowse-sidebar");
    const update = () => {
      if (!scroller) return;
      visibleCount = Math.ceil(scroller.clientHeight / rowHeight) + 20;
      first = Math.max(0, Math.floor(scroller.scrollTop / rowHeight) - 10);
    };
    scroller?.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    if (scroller) observer.observe(scroller);
    update();
    return () => { scroller?.removeEventListener("scroll", update); observer.disconnect(); };
  });

  let list: HTMLElement;
  $effect(() => {
    const index = selected;
    void items;
    untrack(() => {
      if (index >= 0) { reveal(index); void tick().then(() => list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" })); }
    });
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
  {#if virtual && start > 0}<div role="presentation" aria-hidden="true" style:height="{start * rowHeight}px"></div>{/if}
  {#each visible as item, localIndex (item.path + ":" + item.loc)}
    {@const index = start + localIndex}
    {#if close(index) && index === strong}<div class="dowse-results-divider" aria-hidden="true">{strong === 0 ? "Closest candidates" : "Less likely"}</div>{/if}
    <div class="dowse-result" class:is-selected={index === selected} class:is-close={close(index)} data-index={index}
         class:is-virtual={virtual} style:height={virtual ? `${rowHeight}px` : undefined}
         role="option" aria-selected={index === selected} aria-disabled={pending} tabindex={index === tabbable ? 0 : -1}
         aria-posinset={index + 1} aria-setsize={items.length}
         id={id ? `${id}-${index}` : undefined} draggable="true" ondragstart={(e) => drag(e, item)}
         onmouseover={(e) => controller.hover(e, item.path, e.currentTarget as HTMLElement)}
         onfocus={() => { focusAt = index; onselect?.(index); }}
         onclick={(e) => { if (!pending) { onselect?.(index); controller.open(item, e.ctrlKey || e.metaKey); } }}
         onauxclick={(e) => { if (!pending && e.button === 1) controller.open(item, true); }}
         onkeydown={(e) => { if (e.key === "Enter") { if (!pending) controller.open(item, e.ctrlKey || e.metaKey); } else step(e, index); }}>
      <span class="dowse-result-icon"><Icon name={KIND_ICON[item.kind] ?? "file"} size={16} /></span>
      <div class="dowse-result-text">
        <div class="dowse-result-title">{#if close(index)}<span class="dowse-unseen">Less likely: </span>{/if}{titleOf(item)}</div>
        <div class="dowse-result-line">{lineOf(item)}</div>
        <MediaMoments {item} {controller} disabled={pending} />
        {#if item.excerpt && !compact}
          <div class="dowse-result-excerpt">
            {#each runs(item.excerpt) as run}{#if run.marked}<mark>{run.text}</mark>{:else}{run.text}{/if}{/each}
          </div>
        {/if}
      </div>
      {#if aside}<div class="dowse-result-aside">{@render aside(item)}</div>{/if}
    </div>
  {/each}
  {#if virtual && start + visible.length < items.length}
    <div role="presentation" aria-hidden="true" style:height="{(items.length - start - visible.length) * rowHeight}px"></div>
  {/if}
</div>
{#if more && onmore}
  <button class="dowse-more" onclick={onmore}>{more} less likely ›</button>
{/if}
