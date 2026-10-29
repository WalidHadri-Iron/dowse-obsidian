// A radio group as screen readers announce one: Tab reaches its checked radio only (the others are tabindex -1 in
// the markup), and ←/→ (or ↑/↓) move to the next one and choose it. A Svelte action, on the group.

export function radios(group: HTMLElement): { destroy(): void } {
  const keydown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const all = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const next = all[(at + step + all.length) % all.length];
    next.focus();
    next.click();
  };
  group.addEventListener("keydown", keydown);
  return { destroy: () => group.removeEventListener("keydown", keydown) };
}
