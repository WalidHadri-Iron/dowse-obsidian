<script lang="ts" module>
  // Dowse's icon names, drawn with Obsidian's own icons (Lucide), so they match the theme and the rest of Obsidian.
  const LUCIDE: Record<string, string> = {
    remove: "minus", add: "plus", again: "rotate-ccw", search: "search", explore: "compass", folder: "folder",
    folderOpen: "folder-open", open: "external-link", copy: "copy", dismiss: "x", clock: "clock", settings: "settings",
    similar: "sparkles", expand: "maximize-2", note: "file-text", pdf: "file", image: "image", audio: "audio-lines",
    video: "film", canvas: "layout-dashboard", wall: "layout-grid", list: "list",
  };
</script>

<script lang="ts">
  import { setIcon } from "obsidian";

  let { name, size = 20, label = "" }: { name: string; size?: number; label?: string } = $props();

  function icon(node: HTMLElement, which: string) {
    const draw = (n: string) => { node.empty(); setIcon(node, LUCIDE[n] ?? n); };
    draw(which);
    return { update: draw };
  }
</script>

<span class="dowse-icon" style:width="{size}px" style:height="{size}px" style:--icon-size="{size}px"
      role={label ? "img" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : "true"}
      use:icon={name}></span>

<style>
  .dowse-icon { display: inline-grid; place-items: center; flex: none; line-height: 0; }
  .dowse-icon :global(svg) { width: 100%; height: 100%; }
</style>
