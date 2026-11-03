// What the plugin keeps in its data.json, in the vault (so it follows the vault): whether Dowse is on here, and what's
// turned off. The index itself lives elsewhere (IndexedDB), never in the vault.

export interface Settings {
  on: boolean;                 // the person turned Dowse on for this vault (the model is downloaded on that)
  off: string[];               // folders and files turned off, as vault paths
  images: boolean;             // images, PDF scans and videos' frames read (the model's image part: 336 MB more)
  sound: boolean;              // recordings and videos' sound read (the model's audio part: 587 MB more)
  graphicsHinted: boolean;     // told once that the model runs on the integrated GPU while a faster card is there
  batteryPause: boolean;       // reading waits while the computer runs on its battery
  device: "auto" | "wasm";    // automatic GPU selection, or the processor explicitly
}

export const DEFAULTS: Settings = { on: false, off: [], images: false, sound: false, graphicsHinted: false, batteryPause: false, device: "auto" };

/** Whether `path` is searched: not under anything turned off (a folder covers what's in it). */
export function isOn(settings: Settings, path: string): boolean {
  return !settings.off.some((off) => path === off || path.startsWith(off + "/"));
}

/** A parent suspension preserves explicit choices made for its children. */
export function turnOff(settings: Settings, path: string): Settings {
  return settings.off.includes(path) ? settings : { ...settings, off: [...settings.off, path].sort() };
}

/** Turns `path` back on. Something inside a folder that stays off can't be: its folder covers it (the switch for
 * the folder turns it back on with everything in it). */
export function turnOn(settings: Settings, path: string): Settings {
  return { ...settings, off: settings.off.filter((p) => p !== path) };
}

/** Move explicit exclusions with a file/folder; an excluded item stays excluded when moved out of its parent. */
export function renamed(settings: Settings, from: string, to: string): Settings {
  const off = settings.off.map((p) => p === from || p.startsWith(from + "/") ? to + p.slice(from.length) : p);
  const next = { ...settings, off: [...new Set(off)].sort() };
  return !isOn(settings, from) && isOn(next, to) ? turnOff(next, to) : next;
}

/** Obsidian's "Excluded files" patterns that are plain folder or file paths (regular expressions are left out). */
export function plainExclusions(filters: unknown): string[] {
  if (!Array.isArray(filters)) return [];
  return filters.filter((f): f is string => typeof f === "string" && !/^\/.*\/[a-z]*$/.test(f))
    .map((f) => f.replace(/\/+$/, "")).filter(Boolean);
}
