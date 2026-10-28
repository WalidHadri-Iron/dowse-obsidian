import { Plugin } from "obsidian";

export default class DowsePlugin extends Plugin {
  async onload(): Promise<void> {
    if (MEASURE) {
      const { measureIfAsked } = await import("./dev/measure");
      this.app.workspace.onLayoutReady(() => void measureIfAsked(this.app));
    }
  }
}
