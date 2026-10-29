// A file dragged from the wall or the map into a note: its link (as the list's rows give it), shown while dragged as a
// label with its name, not a picture of the whole canvas.

export function dragLink(event: DragEvent, link: string | null, name: string): void {
  if (!link || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData("text/plain", link);
  event.dataTransfer.effectAllowed = "copyLink";
  const ghost = document.createElement("div");
  ghost.className = "dowse-drag-ghost";
  ghost.textContent = name;
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, 12, 12);
  window.setTimeout(() => ghost.remove(), 0);
}
