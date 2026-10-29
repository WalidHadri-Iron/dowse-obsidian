// What the status bar says: the model's download, then the reading (with the time left, once it can be told), then
// "up to date"; and why reading is paused when it is.

import type { Engine } from "./engine.ts";
import type { Status } from "../engine/indexer.ts";

/** "about 6 min left", from seconds ("" when it can't be told yet). */
export function timeLeft(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const tens = Math.round(minutes / 10) * 10;   // past an hour, to ten minutes
  const [hours, rest] = [Math.floor(tens / 60), tens % 60];
  return rest ? `about ${hours} h ${rest} min left` : `about ${hours} h left`;
}

/** Why reading is paused, in words. */
export function heldText(held: string | undefined): string {
  return held === "on battery" ? "paused while on battery" : held === "paused" ? "reading paused"
    : held ? `waiting: ${held}` : "paused";
}

/** "reading 12 of 4,000 · about 6 min left". */
export function readingText(status: Status): string {
  const left = timeLeft(status.left);
  const count = status.total > 1 ? ` ${Math.min(status.done + 1, status.total).toLocaleString()} of ${status.total.toLocaleString()}` : "";
  return `reading${count}${left ? ` · ${left}` : ""}`;
}

export function statusText(engine: Engine): string {
  const { model, status } = engine;
  if (model.state === "downloading") return `Dowse · downloading the model ${Math.round((model.progress ?? 0) * 100)}%`;
  if (model.state === "failed") return "Dowse · the model couldn't start";
  if (status.state === "paused") return `Dowse · ${heldText(status.held)}`;
  if (status.state === "waiting") return "Dowse · waiting while you type";
  if (status.state === "reading") return `Dowse · ${readingText(status)}`;
  if (model.state === "loading") return "Dowse · starting";
  return "Dowse · up to date";
}
