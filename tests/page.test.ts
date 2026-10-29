// A note's page as the wall and the floor draw it: its blocks (headings, paragraphs, lists, tasks, quotes, code,
// tables, pictures), its frontmatter left out, from the line a search matched; and its words as they read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blocks, inline } from "../src/plugin/page.ts";

const note = `---
title: Lisbon in June
tags: [travel]
---
# Lisbon in June

We rode the **yellow tram** 28 up to [[Graça|the hill]].

## Food
- Pastéis de nata
  - with cinnamon
- [x] Sardines
> [!tip] Go early
> before the queues

\`\`\`
const x = 1;
\`\`\`
| Day | Place |
|---|---|
| 1 | Alfama |
![[tram.jpg]]
---`;

test("a note's blocks: its frontmatter left out, each kind read", () => {
  const all = blocks(note);
  assert.deepEqual(all.map((b) => b.kind), ["heading", "paragraph", "heading", "item", "item", "item", "quote", "code", "table", "picture", "rule"]);
  assert.deepEqual(all[4], { kind: "item", text: "with cinnamon", depth: 1, mark: "•" });
  assert.deepEqual(all[5], { kind: "item", text: "Sardines", depth: 0, mark: "task", done: true });
  assert.deepEqual(all[6], { kind: "quote", text: "Tip: Go early before the queues" });
  assert.deepEqual(all[8], { kind: "table", rows: [["Day", "Place"], ["1", "Alfama"]] });
  assert.deepEqual(all[9], { kind: "picture", link: "tram.jpg" });
});

test("from the line a search matched", () => {
  const lines = note.split("\n");
  const food = lines.indexOf("## Food");
  assert.deepEqual(blocks(note, food)[0], { kind: "heading", level: 2, text: "Food" });
});

test("a line's words as they read: links by their shown name, emphasis taken out, the query's words marked", () => {
  const runs = inline("We rode the **yellow tram** 28 up to [[Graça|the hill]] #travel", ["tram"]);
  const text = runs.map((r) => r.text).join("");
  assert.equal(text, "We rode the yellow tram 28 up to the hill #travel");
  assert.deepEqual(runs.filter((r) => r.mark).map((r) => r.text), ["tram"]);
  assert.ok(runs.find((r) => r.text === "hill")?.accent);
  assert.ok(runs.find((r) => r.text === "#travel")?.accent);
});
