// The views: the Dowse tab (search, the fisheye wall), the sidebar of what's like the open file, and Quick search
// (Obsidian's own suggestion modal, opened by a command you give a hotkey).

import { ItemView, SuggestModal, type App, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import SearchPanel from "../ui/SearchPanel.svelte";
import SimilarPanel from "../ui/SimilarPanel.svelte";
import { atMoment, lineOf, mediaMoments, momentLabel, runs, shownOf, titleOf, type Shown } from "../ui/results.ts";
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
    this.registerEvent(this.app.metadataCache.on("resolved",   // links changed: what's linked already, again
      () => (this.component as { relink?: () => void })?.relink?.()));
  }

  async onClose(): Promise<void> {
    if (this.component) await unmount(this.component);
    this.component = null;
  }
}

/** Quick search: type what you remember, Enter opens it where it matched (Ctrl/⌘-Enter: in a new tab). The matches
 * first; what's only close after them, quieter, the first of them saying so. */
export class QuickSearch extends SuggestModal<Shown> {
  private controller: Controller;
  private recent: Shown[] = [];
  private onlyClose = new WeakSet<Shown>();
  private firstClose: Shown | null = null;
  private unclear = false;
  private items: Shown[] = [];
  private stops: (() => void)[] = [];
  private summary: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waiting: (() => void) | null = null;
  private asked = 0;
  private active = false;
  private displayedQuery = "";

  constructor(app: App, controller: Controller) {
    super(app);
    this.controller = controller;
    this.setPlaceholder("Describe what you remember");
    this.setInstructions([
      { command: "↑↓", purpose: "to move" }, { command: "↵", purpose: "to open" },
      { command: navigator.platform.includes("Mac") ? "⌘ ↵" : "ctrl ↵", purpose: "to open in a new tab" }, { command: "esc", purpose: "to close" },
    ]);
    this.scope.register(["Mod"], "Enter", (event) => {
      const chosen = (this as unknown as { chooser?: { values?: Shown[]; selectedItem?: number } }).chooser;
      const item = chosen?.values?.[chosen.selectedItem ?? 0];
      if (item && this.inputEl.value === this.displayedQuery) { this.close(); this.controller.open(item, true); }
      event.preventDefault();
      return false;
    });
  }

  onOpen(): void {
    super.onOpen();
    this.active = true;
    this.summary = this.resultContainerEl.parentElement!.createDiv({ cls: "dowse-quick-status", attr: { role: "status", "aria-live": "polite" } });
    this.resultContainerEl.before(this.summary);
    let ready = this.controller.ready(), on = this.controller.on(), selection = this.controller.selection();
    const refresh = () => { if (this.active) this.inputEl.dispatchEvent(new Event("input")); };
    this.stops.push(this.controller.follow(refresh), this.controller.subscribe(() => {
      const nextReady = this.controller.ready(), nextOn = this.controller.on();
      const nextSelection = this.controller.selection();
      if (nextSelection !== selection) {
        selection = nextSelection;
        this.items = this.items.filter(item => this.controller.active(item.path));
        this.resultContainerEl.empty(); refresh();
      }
      if (nextReady !== ready || nextOn !== on) { ready = nextReady; on = nextOn; refresh(); }
    }));
  }

  onClose(): void {
    this.active = false; this.asked++;
    clearTimeout(this.timer); this.waiting?.(); this.waiting = null;
    for (const stop of this.stops.splice(0)) stop();
    this.summary?.remove(); this.summary = null;
    super.onClose();
  }

  async getSuggestions(query: string): Promise<Shown[]> {
    const mine = ++this.asked;
    clearTimeout(this.timer); this.waiting?.();
    if (!this.controller.on()) { this.summary?.setText("Dowse is off for this vault. Open the Dowse tab to turn it on."); return []; }
    if (!query.trim()) {
      const recent = await this.controller.recent();
      if (mine !== this.asked) return this.items;
      this.summary?.setText("Recent files"); this.unclear = false; this.firstClose = null;
      this.recent = recent.slice(0, 20);
      this.displayedQuery = query;
      return this.items = this.recent;
    }
    this.summary?.setText(this.controller.ready() ? "Searching…" : "Searching words while the model starts…");
    await new Promise<void>(resolve => { this.waiting = resolve; this.timer = setTimeout(resolve, 150); });
    if (mine !== this.asked || !this.active) return this.items;
    this.waiting = null;
    let answer;
    try { answer = await this.controller.search(query, []); }
    catch { if (mine === this.asked) this.summary?.setText("Search could not finish. Try again."); return []; }
    if (mine !== this.asked || !this.active) return this.items;
    const items = answer.hits.slice(0, answer.strong > 0 ? answer.strong + 3 : 10).map(shownOf);   // (the rest: in the tab)
    this.displayedQuery = query;
    this.unclear = answer.strong === 0;
    this.summary?.setText((answer.strong ? `${answer.strong} match${answer.strong === 1 ? "" : "es"}` :
      items.length ? "Nothing clearly matches · closest shown" : "Nothing found") + (answer.meaning ? "" : " · words only while the model starts"));
    this.firstClose = answer.strong > 0 && answer.strong < items.length ? items[answer.strong] : null;
    for (const item of items.slice(answer.strong)) this.onlyClose.add(item);
    return this.items = items;
  }

  renderSuggestion(item: Shown, el: HTMLElement): void {
    el.addClass("dowse-suggestion");
    if (this.onlyClose.has(item)) el.addClass("is-close");
    if (item === this.firstClose) el.createDiv({ cls: "dowse-suggestion-divider", text: "Less likely" });
    if (this.unclear) el.createSpan({ cls: "dowse-unseen", text: "Closest candidate: " });
    el.createDiv({ cls: "dowse-result-title", text: titleOf(item) });
    el.createDiv({ cls: "dowse-result-line", text: lineOf(item) });
    const moments = mediaMoments(item);
    if (moments.length) {
      const row = el.createDiv({ cls: "dowse-media-moments", attr: { "aria-label": `Matching moments in ${titleOf(item)}` } });
      row.createSpan({ text: moments.length === 1 ? "Matching moment" : "Matching moments" });
      for (const [i, moment] of moments.entries()) {
        const button = row.createEl("button", { text: momentLabel(moment), cls: "dowse-moment", attr: {
          type: "button", "aria-label": `Go to ${momentLabel(moment)} in ${titleOf(item)}` } });
        if (i === 0) button.addClass("is-best");
        button.addEventListener("mousedown", e => e.stopPropagation());
        button.addEventListener("keydown", e => e.stopPropagation());
        button.addEventListener("click", e => {
          e.preventDefault(); e.stopPropagation();
          if (this.inputEl.value !== this.displayedQuery) return;
          this.close();
          this.controller.open(atMoment(item, moment), e.ctrlKey || e.metaKey);
        });
      }
    }
    if (item.excerpt && this.inputEl.value.trim()) {
      const excerpt = el.createDiv({ cls: "dowse-result-excerpt" });
      for (const run of runs(item.excerpt)) {
        if (run.marked) excerpt.createEl("mark", { text: run.text });
        else excerpt.appendText(run.text);
      }
    }
  }

  onChooseSuggestion(item: Shown, event: MouseEvent | KeyboardEvent): void {
    if (this.inputEl.value === this.displayedQuery) this.controller.open(item, event.ctrlKey || event.metaKey);
  }
}
