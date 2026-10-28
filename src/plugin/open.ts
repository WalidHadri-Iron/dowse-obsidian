// Opening a result where it matched: a note at its line, a PDF at its page, anything else as Obsidian opens it; and
// a result as a link, dragged into a note.

import { type App, TFile } from "obsidian";
import type { Shown } from "../ui/results.ts";

/** `newTab`: in a new tab (Ctrl/⌘-click, as Obsidian's own search does). */
export async function openShown(app: App, shown: Shown, newTab = false): Promise<void> {
  const file = app.vault.getFileByPath(shown.path);
  if (!(file instanceof TFile)) return;
  if (shown.kind === "pdf" && shown.loc) {
    await app.workspace.openLinkText(`${file.path}#page=${shown.loc}`, "", newTab);
    return;
  }
  const leaf = app.workspace.getLeaf(newTab);
  await leaf.openFile(file, shown.kind === "note" && shown.loc !== null
    ? { eState: { line: shown.loc }, active: true } : { active: true });
}

/** A result dragged out: a link to it, as Obsidian writes links in this vault. */
export function linkTo(app: App, path: string, from = ""): string | null {
  const file = app.vault.getFileByPath(path);
  return file ? app.fileManager.generateMarkdownLink(file, from) : null;
}
