import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatter, lines, passages, plain, readNote } from "../src/engine/reading/markdown.ts";

test("frontmatter gives the title, tags and aliases, however they're written", () => {
  const note = ["---", "title: \"Trip to Lisbon\"", "tags: [travel, '#portugal']", "aliases:", "  - Lisboa",
                "  - Lisbon 2025", "created: 2025-06-01", "---", "# Day one"].join("\n");
  const front = frontmatter(note.split("\n"));
  assert.equal(front.title, "Trip to Lisbon");
  assert.deepEqual(front.tags, ["travel", "portugal"]);
  assert.deepEqual(front.aliases, ["Lisboa", "Lisbon 2025"]);
  assert.equal(front.lines, 8);
});

test("a line is read as its words: links as what they say, no embeds or markup", () => {
  assert.equal(plain("See [[People/Ana Silva|Ana]] and [[Recipes/Bacalhau#Sauce]] or [the map](https://x.y)"),
               "See Ana and Bacalhau Sauce or the map");
  assert.equal(plain("![[tram.jpg]] **yellow** ==tram== ~~old~~ `code`"), " yellow tram old code");
  assert.equal(plain("> [!warning]+ Watch out"), "Watch out");
  assert.equal(plain("- [x] book the hotel[^1]"), "- book the hotel");
  assert.equal(plain("## Day two"), "Day two");
});

test("comments are left out, code is kept, each line knows where it is", () => {
  const read = lines(["---", "title: x", "---", "Intro %% a hidden", "note %% after", "<!-- gone -->kept",
                      "```js", "const tram = 28;", "```", "# Heading"].join("\n"));
  assert.deepEqual(read.map((l) => [l.text, l.line, l.heading]), [
    ["Intro", 3, false], [" after", 4, false], ["kept", 5, false], ["const tram = 28;", 7, false], ["Heading", 9, true],
  ]);
});

test("Excalidraw text stays searchable while fenced compressed scene data stays hidden", () => {
  const source = ["---", "excalidraw-plugin: parsed", "---", "# Garden layout", "## Text Elements",
    "Rainwater tank ^water123", "Vegetable beds ^beds1234", "%%", "## Drawing", "```compressed-json",
    "N4KAhiddenSceneDataNotSearchable", "```", "%%", "A note after the drawing."].join("\n");
  const read = readNote("Garden.excalidraw.md", source);
  const body = read.pieces.map(p => p.body).join("\n");
  assert.match(body, /Rainwater tank/);
  assert.match(body, /Vegetable beds/);
  assert.match(body, /A note after the drawing/);
  assert.doesNotMatch(body, /hiddenSceneData|compressed-json|## Drawing/);
  assert.equal(lines(source).find(l => l.text === "A note after the drawing.")?.line, 13);
});

test("fences hidden in HTML comments do not swallow visible text, and real code keeps literal comment markers", () => {
  const source = ["Before", "<!--", "```json", '{"hidden":true}', "```", "-->", "After", "```js",
    'const percent = "%%";', 'const html = "<!--";', "```", "Last"].join("\n");
  const visible = lines(source).filter(l => l.text).map(l => [l.text, l.line]);
  assert.deepEqual(visible, [["Before", 0], ["After", 6], ['const percent = "%%";', 8],
    ['const html = "<!--";', 9], ["Last", 11]]);
});

test("headings start passages; long sections are cut at line ends, overlapping a little", () => {
  const body = Array.from({ length: 40 }, (_, i) => `Line ${i}: ${"word ".repeat(18)}`).join("\n");
  const note = `# One\nshort section\n# Two\n${body}`;
  const found = passages(lines(note), 1800, 200);
  assert.equal(found[0].text, "One\nshort section");
  assert.deepEqual([found[0].first, found[0].last], [0, 1]);
  assert.ok(found.length >= 3 && found.slice(1).every((p) => p.text.length <= 1800));
  assert.ok(found[2].first < found[1].last, "the next passage starts a line or two back");
  assert.ok(found[1].text.startsWith("Two\nLine 0"));
});

test("a note is read with its title; one without words is kept for keyword search only", () => {
  const read = readNote("Travel/Lisbon trip.md", "# Lisbon in June\nWe rode the yellow tram 28 up to Graça.");
  assert.equal(read.info.title, "Lisbon in June");
  assert.equal(read.pieces[0].text, "title: Lisbon in June | text: Lisbon in June\nWe rode the yellow tram 28 up to Graça.");
  const named = readNote("Untitled 3.md", "1 2 3 4 5 | 6 7 8 9");
  assert.equal(named.info.title, undefined);
  assert.equal(named.pieces[0].text, null);
  assert.equal(readNote("Empty.md", "---\ntags: [a]\n---\n").note, "no text");
});
