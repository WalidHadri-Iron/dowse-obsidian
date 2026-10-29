// How a case looks on the floor while a search is on, and where the camera goes to see some cases (Dowse's).

import { relevance } from "../wall/search-relevance.ts";
import { scoreSize } from "../wall/score-size.ts";

/** Presentation only: never move files between their established aisle coordinates. When there are clear matches,
 * what's only close recedes (a little smaller, dimmer) so the eye goes to the matches; without them, it's the answer. */
export function exploreAppearance(path: string, found: ReadonlyMap<string, number> | null,
  matches: ReadonlySet<string> | null, clear: boolean, score: number | undefined, best: number, selected: string | null) {
  const state = relevance(path, found, clear && (matches === null || matches.has(path)));
  const activeSelection = selected !== null && !!found?.has(selected);
  return {
    state,
    size: state === "neutral" ? 1 : state === "other" ? .78 : state === "match" ? scoreSize(score, best, .9, 1.5) : clear ? .9 : 1,
    light: state === "neutral" ? 1 : state === "other" ? .35 : state === "closest" && clear ? .6
      : activeSelection && path !== selected ? .82 : 1,
    lift: state === "match" ? .35 : 0,
    outline: state === "neutral" ? 0 : state === "other" ? .22 : state === "closest" && clear ? .55 : .95,
  };
}

export function rankedStep(paths: readonly string[], selected: string | null, step: -1 | 1): string | null {
  if (!paths.length) return null;
  const index = selected === null ? -1 : paths.indexOf(selected);
  if (index < 0) return step > 0 ? paths[0] : paths[paths.length - 1];
  return paths[Math.max(0, Math.min(paths.length - 1, index + step))];
}

/** Fit actual cases, not a fixed camera distance or the centroid of six potentially scattered hits. */
export function fitExplore(points: readonly { x: number; y: number; size?: number }[], aspect: number, fov: number, padding = .7, minimum = 3.8) {
  if (!points.length) return null;
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const left = Math.min(...points.map(p => p.x - .84 * (p.size ?? 1) / 2));
  const right = Math.max(...points.map(p => p.x + .84 * (p.size ?? 1) / 2));
  const bottom = Math.min(...points.map(p => p.y - .62 * (p.size ?? 1) / 2));
  const top = Math.max(...points.map(p => p.y + .62 * (p.size ?? 1) / 2));
  const tan = Math.tan(fov * Math.PI / 360);
  const z = Math.max(minimum, (right - left + padding * 2) / (2 * tan * ratio), (top - bottom + padding * 2) / (2 * tan)) * 1.12 + .4;
  return { x: (left + right) / 2, y: (top + bottom) / 2, z };
}
