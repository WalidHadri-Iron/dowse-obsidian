// A theme's colour as three.js can take it: Obsidian's tokens may be any CSS colour (color-mix, oklch, a translucent
// one), which three.js can't read. Resolved by the page itself and drawn over the floor: plain rgb().

let canvas: CanvasRenderingContext2D | null = null;

/** `name`, a custom property seen from `host`, as rgb(), laid over `under` (a translucent token over the floor). */
export function cssColor(host: HTMLElement, name: string, under = "#ffffff"): string {
  const probe = host.createSpan();   // (read and taken away at once: never drawn)
  probe.setCssProps({ color: `var(${name})` });
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  canvas ??= new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = under;
  canvas.fillRect(0, 0, 1, 1);
  canvas.fillStyle = resolved;
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}
