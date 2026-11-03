<script lang="ts">
  import Icon from "./wall/Icon.svelte";
  import { atMoment, mediaMoments, momentLabel, titleOf, type Shown } from "./results.ts";
  import type { Controller } from "./controller.ts";
  let { item, controller, disabled = false }: { item: Shown; controller: Controller; disabled?: boolean } = $props();
  const moments = $derived(mediaMoments(item));
</script>

{#if moments.length}
  <div class="dowse-media-moments" aria-label={`Matching moments in ${titleOf(item)}`}>
    <span>Matching {moments.length === 1 ? "moment" : "moments"}</span>
    {#each moments as moment, i (moment[0] + ":" + moment[1])}
      <button type="button" class="dowse-moment" class:is-best={i === 0} {disabled}
              title={moment[1] === null ? "Go to this matching frame" : "Go to this matching passage (approximate range)"}
              aria-label={`Go to ${momentLabel(moment)} in ${titleOf(item)}`}
              onkeydown={e => e.stopPropagation()} onpointerdown={e => e.stopPropagation()}
              onclick={e => { e.stopPropagation(); controller.open(atMoment(item, moment), e.ctrlKey || e.metaKey); }}>
        <Icon name="clock" size={12} />{momentLabel(moment)}
      </button>
    {/each}
  </div>
{/if}
