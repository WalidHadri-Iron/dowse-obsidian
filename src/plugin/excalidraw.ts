// Optional integration with Obsidian Excalidraw. Use its own renderer, so text, arrows, images and freehand strokes
// look like the editable drawing. Never reset or populate the user's shared ExcalidrawAutomate workbench.
import type { App, TFile } from "obsidian";

const ID = "obsidian-excalidraw-plugin";
interface Element { isDeleted?: boolean }
interface Automate {
  getSceneFromFile(file: TFile): Promise<{ elements: Element[] }>;
  getBoundingBox(elements: Element[]): { width: number; height: number };
  createPNG(path: string, scale: number, settings: { withBackground: boolean; withTheme: boolean },
    loader: undefined, theme: string, padding: number): Promise<Blob>;
  destroy?(): void;
}
interface DrawingPlugin {
  manifest?: { version?: string };
  ea?: Automate;
  isExcalidrawFile?(file: TFile): boolean;
}

function plugin(app: App): DrawingPlugin | undefined {
  return (app as App & { plugins?: { plugins?: Record<string, DrawingPlugin> } }).plugins?.plugins?.[ID];
}

export function isExcalidraw(app: App, file: TFile): boolean {
  if (/\.excalidraw(?:\.md)?$/i.test(file.path)) return true;
  if (file.extension !== "md") return false;
  try { if (plugin(app)?.isExcalidrawFile?.(file)) return true; } catch { /* check cached frontmatter instead */ }
  const mode: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.["excalidraw-plugin"];
  return mode === "parsed" || mode === "raw";
}

export function excalidrawRenderer(app: App): string {
  const enabled = plugin(app);
  return enabled?.ea?.createPNG ? enabled.manifest?.version ?? "enabled" : "unavailable";
}

export function canOpenExcalidraw(app: App): boolean { return !!plugin(app); }

export async function drawExcalidraw(app: App, file: TFile, pixels: number, dark: boolean,
  signal?: AbortSignal): Promise<string | null> {
  const enabled = plugin(app), template = enabled?.ea;
  if (signal?.aborted || !template?.createPNG || !template.getSceneFromFile || !template.getBoundingBox) return null;
  // The plugin exposes the Automate instance; its documented constructor makes an isolated workbench.
  const Constructor = template.constructor;
  if (Constructor === Object || typeof Constructor !== "function") return null;
  const ea = new (Constructor as unknown as new (plugin: DrawingPlugin) => Automate)(enabled!);
  try {
    const scene = await ea.getSceneFromFile(file);
    if (signal?.aborted || !scene?.elements?.length) return null;
    const box = ea.getBoundingBox(scene.elements.filter(e => !e.isDeleted));
    if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
    const padding = 20, width = Math.max(1, box.width) + 2 * padding, height = Math.max(1, box.height) + 2 * padding;
    const size = Math.max(96, Math.min(pixels, 4096));
    const scale = Math.min(4, size / width, 4096 / height);
    const png = await ea.createPNG(file.path, scale, { withBackground: true, withTheme: true }, undefined,
      dark ? "dark" : "light", padding);
    if (signal?.aborted) return null;
    return png instanceof Blob ? URL.createObjectURL(png) : null;
  } finally { ea.destroy?.(); }
}
