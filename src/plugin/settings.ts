// What the plugin keeps in its data.json, in the vault (so it follows the vault): whether Dowse is on here, and what's
// turned off. The index itself lives elsewhere (IndexedDB), never in the vault.

export interface Settings {
  on: boolean;                 // the person turned Dowse on for this vault (the model is downloaded on that)
  off: string[];               // folders and files turned off, as vault paths
}

export const DEFAULTS: Settings = { on: false, off: [] };

/** Whether `path` is searched: not under anything turned off (a folder covers what's in it). */
export function isOn(settings: Settings, path: string): boolean {
  return !settings.off.some((off) => path === off || path.startsWith(off + "/"));
}

/** Turns `path` off (a folder: and what's in it); what it already covers is folded in. */
export function turnOff(settings: Settings, path: string): Settings {
  if (!isOn(settings, path)) return settings;
  const off = settings.off.filter((p) => !(p === path || p.startsWith(path + "/")));
  return { ...settings, off: [...off, path].sort() };
}

/** Turns `path` back on. Something inside a folder that stays off can't be: its folder covers it (the switch for
 * the folder turns it back on with everything in it). */
export function turnOn(settings: Settings, path: string): Settings {
  return { ...settings, off: settings.off.filter((p) => !(p === path || p.startsWith(path + "/"))) };
}

/** Obsidian's "Excluded files" patterns that are plain folder or file paths (regular expressions are left out). */
export function plainExclusions(filters: unknown): string[] {
  if (!Array.isArray(filters)) return [];
  return filters.filter((f): f is string => typeof f === "string" && !/^\/.*\/[a-z]*$/.test(f))
    .map((f) => f.replace(/\/+$/, "")).filter(Boolean);
}
