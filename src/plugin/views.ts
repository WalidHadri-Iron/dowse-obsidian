// The views: the Dowse tab (search, the fisheye wall), the sidebar of what's like the open file, and Quick search
// (Obsidian's own suggestion modal, opened by a command you give a hotkey).

import { ItemView, SuggestModal, type App, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import SearchPanel from "../ui/SearchPanel.svelte";
import SimilarPanel from "../ui/SimilarPanel.svelte";
import { lineOf, runs, shownOf, titleOf, type Shown } from "../ui/results.ts";
import type { Controller } from "../ui/controller.ts";

export const SEARCH_VIEW = "dowse-search";
export const SIMILAR_VIEW = "dowse-similar";
export const ICON = "radar";

export class SearchView extends ItemView {
  private controller: Controller;
  private component: { ask?: (query: string) => void } | null = null;

  constructor(leaf: WorkspaceLeaf, controller: Controller) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string { return SEARCH_VIEW; }

  /** Opened on a query (a command, a link): it's asked at once. */
  async setState(state: { query?: string }, result: ViewStateResult): Promise<void> {
    if (state?.query) this.component?.ask?.(state.query);
    await super.setState(state, result);
  }
  getDisplayText(): string { return "Dowse"; }
  getIcon(): string { return ICON; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("dowse-view");
    this.component = mount(SearchPanel, { target: this.contentEl, props: { controller: this.controller } }) as
      { ask?: (query: string) => void };
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component as Record<string, unknown>);
    this.component = null;
  }
}

export class SimilarView extends ItemView {
  private controller: Controller;
  private component: Record<string, unknown> | null = null;

  constructor(leaf: WorkspaceLeaf, controller: Controller) {
    super(leaf);
    this.controller = controller;
  }

  getViewType(): string { return SIMILAR_VIEW; }
  getDisplayText(): string { return "Like this note"; }
  getIcon(): string { return ICON; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("dowse-view", "dowse-sidebar");
    const current = () => this.app.workspace.getActiveFile()?.path ?? null;
    this.component = mount(SimilarPanel, { target: this.contentEl, props: { controller: this.controller, current } });
    this.registerEvent(this.app.workspace.on("file-open", () => (this.component as { update?: () => void })?.update?.()));
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component);
    this.component = null;
  }
}

/** Quick search: type what you remember, Enter opens it where it matched (Ctrl/⌘-Enter: in a new tab). */
export class QuickSearch extends SuggestModal<Shown> {
  private controller: Controller;
  private recent: Shown[] = [];

  constructor(app: App, controller: Controller) {
    super(app);
    this.controller = controller;
    this.setPlaceholder("Describe what you remember");
    this.setInstructions([
      { command: "↑↓", purpose: "to move" }, { command: "↵", purpose: "to open" },
      { command: "ctrl ↵", purpose: "to open in a new tab" }, { command: "esc", purpose: "to close" },
    ]);
    this.scope.register(["Mod"], "Enter", (event) => {
      const chosen = (this as unknown as { chooser?: { values?: Shown[]; selectedItem?: number } }).chooser;
      const item = chosen?.values?.[chosen.selectedItem ?? 0];
      if (item) { this.close(); this.controller.open(item, true); }
      event.preventDefault();
      return false;
    });
    void controller.recent().then((items) => (this.recent = items.slice(0, 20)));
  }

  async getSuggestions(query: string): Promise<Shown[]> {
    if (!query.trim()) return this.recent;
    const answer = await this.controller.search(query, []);
    return answer.hits.slice(0, 20).map(shownOf);
  }

  renderSuggestion(item: Shown, el: HTMLElement): void {
    el.addClass("dowse-suggestion");
    el.createDiv({ cls: "dowse-result-title", text: titleOf(item) });
    el.createDiv({ cls: "dowse-result-line", text: lineOf(item) });
    if (item.excerpt) {
      const excerpt = el.createDiv({ cls: "dowse-result-excerpt" });
      for (const run of runs(item.excerpt)) {
        if (run.marked) excerpt.createEl("mark", { text: run.text });
        else excerpt.appendText(run.text);
      }
    }
  }

  onChooseSuggestion(item: Shown, event: MouseEvent | KeyboardEvent): void {
    this.controller.open(item, event.ctrlKey || event.metaKey);
  }
}
