// Where a link from the sidebar goes in the open note (src/plugin/link-placement.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { linkPlacement } from "../src/plugin/link-placement.ts";

const link = "[[Lisbon weekend route]]";

test("a cursor never placed (a note just opened) sends the link to the end, not ahead of the first heading", () => {
  assert.equal(linkPlacement(link, "# Lisbon itinerary", 0, 0, false), null);
  assert.equal(linkPlacement(link, "---", 0, 0, false), null, "frontmatter stays first too");
});

test("at the start of a line with words, the link takes a line of its own: the heading stays a heading", () => {
  assert.equal(linkPlacement(link, "## Day 2", 7, 0, false), `${link}\n`);
});

test("among words it is spaced from them; on an empty line or a selection, it goes as it is", () => {
  assert.equal(linkPlacement(link, "See also:", 9, 9, false), ` ${link}`);
  assert.equal(linkPlacement(link, "See also: ", 9, 10, false), link);
  assert.equal(linkPlacement(link, "before after", 3, 7, false), `${link} `, "the space before it is there already");
  assert.equal(linkPlacement(link, "beforeafter", 3, 6, false), ` ${link} `);
  assert.equal(linkPlacement(link, "", 4, 0, false), link);
  assert.equal(linkPlacement(link, "", 0, 0, false), link, "an empty note: at the cursor");
  assert.equal(linkPlacement(link, "# Title", 0, 0, true), link, "a selection is replaced");
});
