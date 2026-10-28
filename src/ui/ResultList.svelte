<script lang="ts">
  // Results as a list, as Obsidian lists files: the kind's icon, the title, where it matched, the words found.
  import Icon from "./wall/Icon.svelte";
  import { KIND_ICON, lineOf, runs, titleOf, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";

  let { items, selected = -1, compact = false, controller, onselect }: {
    items: Shown[];
    selected?: number;
    compact?: boolean;       // the sidebar's: no excerpts
    controller: Controller;
    onselect?: (index: number) => void;
  } = $props();

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

<div class="dowse-results" class:compact bind:this={list} role="listbox" aria-label="Results">
  {#each items as item, index (item.path + ":" + item.loc)}
    <div class="dowse-result" class:is-selected={index === selected} data-index={index} role="option"
         aria-selected={index === selected} tabindex="-1" draggable="true" ondragstart={(e) => drag(e, item)}
         onmouseover={(e) => controller.hover(e, item.path, e.currentTarget as HTMLElement)}
         onfocus={() => onselect?.(index)}
         onclick={(e) => { onselect?.(index); controller.open(item, e.ctrlKey || e.metaKey); }}
         onauxclick={(e) => { if (e.button === 1) controller.open(item, true); }}
         onkeydown={(e) => { if (e.key === "Enter") controller.open(item, e.ctrlKey || e.metaKey); }}>
      <span class="dowse-result-icon"><Icon name={KIND_ICON[item.kind] ?? "file"} size={16} /></span>
      <div class="dowse-result-text">
        <div class="dowse-result-title">{titleOf(item)}</div>
        <div class="dowse-result-line">{lineOf(item)}</div>
        {#if item.excerpt && !compact}
          <div class="dowse-result-excerpt">
            {#each runs(item.excerpt) as run}{#if run.marked}<mark>{run.text}</mark>{:else}{run.text}{/if}{/each}
          </div>
        {/if}
      </div>
    </div>
  {/each}
</div>
