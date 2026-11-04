// Where a link from the sidebar goes in the note being written (main.ts insertLink).

/** Where a link goes in the open note, from its cursor: null (at the end) when the cursor was never placed (a note just opened
 * has it at the start of its first line, and a link there broke its `# heading`); otherwise the text to put at the
 * cursor: on its own line when the cursor starts a line with something on it (a heading or list item it starts stays
 * one), spaced from the words beside it. */
export function linkPlacement(link: string, line: string, lineNo: number, ch: number, selected: boolean): string | null {
  if (selected) return link;
  if (line.trim() && ch === 0) return lineNo === 0 ? null : `${link}\n`;
  const before = line.slice(0, ch), after = line.slice(ch);
  return `${before && !/\s$/.test(before) ? " " : ""}${link}${after && !/^\s/.test(after) ? " " : ""}`;
}
