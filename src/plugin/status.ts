// What the status bar says: the model's download, then the reading, then "up to date".

import type { Engine } from "./engine.ts";

export function statusText(engine: Engine): string {
  const { model, status } = engine;
  if (model.state === "downloading") return `Dowse · downloading the model ${Math.round((model.progress ?? 0) * 100)}%`;
  if (model.state === "failed") return "Dowse · the model couldn't start";
  if (status.state === "waiting") return "Dowse · waiting while you type";
  if (status.state === "reading") {
    return status.total > 1 ? `Dowse · reading ${Math.min(status.done + 1, status.total)} of ${status.total}` : "Dowse · reading";
  }
  if (model.state === "loading") return "Dowse · starting";
  return "Dowse · up to date";
}
