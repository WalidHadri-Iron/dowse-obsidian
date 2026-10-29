// Which graphics card Obsidian runs on, on Windows. Chromium takes the card Windows gives it (it ignores WebGPU's
// "high-performance" there), and a PC with a graphics card and an integrated GPU gives it the integrated one, much
// slower for the model. Windows' own switch for that (Settings › System › Display › Graphics) is a value under the
// user's DirectX preferences, keyed by the program's path: set here only when the person turns the setting on, and
// taken away when they turn it off. Windows applies it when Obsidian starts again.

import { execFile } from "child_process";

const WINDOWS = process.platform === "win32";

const DISPLAY = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const PREFERENCES = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
const HIGH = "GpuPreference=2;";

function reg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile("reg", args, { windowsHide: true, timeout: 10000 },
    (error, stdout) => (error ? reject(error) : resolve(stdout))));
}

/** A card of its own (NVIDIA, AMD Radeon RX or Pro, Intel Arc A or B), not one built into the processor. */
export function dedicated(name: string): boolean {
  return /nvidia|geforce|quadro/i.test(name) || /radeon\s*(\(tm\)\s*)?(rx|pro)\b/i.test(name)
    || /\barc\s*(\(tm\)\s*)?[ab]\d{3}/i.test(name);
}

/** The display adapters Windows has drivers for, by name. */
export async function cards(): Promise<string[]> {
  if (!WINDOWS) return [];
  const out = await reg(["query", DISPLAY, "/s", "/v", "DriverDesc"]).catch(() => "");
  const names = [...out.matchAll(/DriverDesc\s+REG_SZ\s+(.+)/g)].map((m) => m[1].trim());
  return [...new Set(names)].filter((n) => !/basic display|remote|virtual|indirect/i.test(n));
}

/** Obsidian's own program (the one Windows' preference is keyed by). */
function program(): string {
  return process.execPath;
}

/** The preference's other settings (Windows keeps a few in the same value), without the GPU one. */
function others(value: string): string {
  return value.split(";").filter((part) => part && !part.startsWith("GpuPreference=")).map((p) => p + ";").join("");
}

async function current(): Promise<string | null> {
  const out = await reg(["query", PREFERENCES, "/v", program()]).catch(() => "");
  return out.match(/REG_SZ\s+(.*)/)?.[1].trim() ?? null;
}

/** Obsidian is set to run on the high-performance card. */
export async function preferred(): Promise<boolean> {
  return WINDOWS && /GpuPreference=2;/.test((await current()) ?? "");
}

/** Sets (or takes away) Windows' preference for the high-performance card for Obsidian. */
export async function prefer(high: boolean): Promise<void> {
  const value = others((await current()) ?? "");
  if (high) await reg(["add", PREFERENCES, "/v", program(), "/t", "REG_SZ", "/d", value + HIGH, "/f"]);
  else if (value) await reg(["add", PREFERENCES, "/v", program(), "/t", "REG_SZ", "/d", value, "/f"]);
  else await reg(["delete", PREFERENCES, "/v", program(), "/f"]).catch(() => {});
}

function vendorOf(name: string): string | null {
  return /nvidia/i.test(name) ? "nvidia" : /amd|radeon|ati\b/i.test(name) ? "amd" : /intel/i.test(name) ? "intel" : null;
}

/** The faster card there is (null: none, or not on Windows), and whether the model runs on it: `gpu` is WebGPU's
 * description of the card it got ("nvidia ada-lovelace", "amd rdna-2"…). Unknown when both are of one maker. */
export async function situation(gpu: string | null | undefined): Promise<{ faster: string | null; on: boolean | null }> {
  return among(await cards(), gpu);
}

/** `situation`, given the cards. */
export function among(all: string[], gpu: string | null | undefined): { faster: string | null; on: boolean | null } {
  const faster = all.find(dedicated) ?? null;
  if (!faster || !gpu) return { faster, on: null };
  const using = vendorOf(gpu);
  const integrated = all.filter((n) => !dedicated(n)).map(vendorOf);
  if (using === vendorOf(faster) && !integrated.includes(using)) return { faster, on: true };
  if (integrated.includes(using) && using !== vendorOf(faster)) return { faster, on: false };
  return { faster, on: null };
}
