/** Obsidian can update its app without updating Electron: test capabilities, not only the app version. */
export function runtimeProblem(features = {
  half: typeof Float16Array !== "undefined", worker: typeof Worker !== "undefined",
  canvas: typeof OffscreenCanvas !== "undefined", storage: typeof indexedDB !== "undefined",
}): string | null {
  return Object.values(features).every(Boolean) ? null :
    "Dowse needs a newer Obsidian installer. Download Obsidian from obsidian.md/download and reinstall it, then reopen this vault. Your notes are kept. Updating only inside Obsidian may leave its browser runtime unchanged.";
}
