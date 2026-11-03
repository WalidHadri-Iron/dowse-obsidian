// Opening a result where it matched: a note at its line, a PDF at its page, anything else as Obsidian opens it; and
// a result as a link, dragged into a note.

import { type App, Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { seekMedia } from "./seek-media.ts";
import type { Shown } from "../ui/results.ts";
import { canOpenExcalidraw, isExcalidraw } from "./excalidraw.ts";

const openings = new WeakMap<WorkspaceLeaf, AbortController>();

/** `newTab`: in a new tab (Ctrl/⌘-click, as Obsidian's own search does). */
export async function openShown(app: App, shown: Shown, newTab = false): Promise<void> {
  const file = app.vault.getFileByPath(shown.path);
  if (!(file instanceof TFile)) return;
  if (shown.kind === "pdf" && shown.loc) {
    await app.workspace.openLinkText(`${file.path}#page=${shown.loc}`, "", newTab);
    return;
  }
  const leaf = app.workspace.getLeaf(newTab);
  openings.get(leaf)?.abort();
  const opening = new AbortController();
  openings.set(leaf, opening);
  const current = () => !opening.signal.aborted && (leaf.view as { file?: TFile }).file?.path === file.path;
  if (isExcalidraw(app, file) && canOpenExcalidraw(app)) {
    // A line in the Markdown backing file must never force an editable drawing into Markdown mode.
    await leaf.setViewState({ type: "excalidraw", state: { file: file.path }, active: true });
    return;
  }
  await leaf.openFile(file, shown.kind === "note" && shown.loc !== null
    ? { eState: { line: shown.loc }, active: true } : { active: true });
  if (!current()) return;
  if ((shown.kind === "audio" || shown.kind === "video") && shown.loc !== null) {
    try {
      let media: HTMLMediaElement | null = null;
      for (let i = 0; i < 40 && !media; i++) {
        if (!current()) return;
        media = leaf.view.containerEl.querySelector<HTMLMediaElement>("audio, video");
        if (!media) await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!media) throw new Error("No media player in this view");
      if (!current()) return;
      await seekMedia(media, shown.loc, opening.signal);
    } catch { if (current()) new Notice("The file opened, but its player could not jump to the matching moment."); }
  }
  if (shown.kind === "canvas" && shown.loc !== null) {
    try {
      const nodes = JSON.parse(await app.vault.cachedRead(file)).nodes as { id: string }[];
      const id = nodes[shown.loc]?.id;
      const canvas = (leaf.view as any).canvas;
      const node = id && canvas?.nodes?.get(id);
      if (node && typeof canvas.selectOnly === "function") {
        canvas.selectOnly(node);
        canvas.zoomToSelection?.();
      }
    } catch { /* The canvas can change while the result is being opened. */ }
  }
}

/** A result dragged out: a link to it, as Obsidian writes links in this vault. */
export function linkTo(app: App, path: string, from = ""): string | null {
  const file = app.vault.getFileByPath(path);
  return file ? app.fileManager.generateMarkdownLink(file, from) : null;
}
