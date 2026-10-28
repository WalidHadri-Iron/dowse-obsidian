import { test } from "node:test";
import assert from "node:assert/strict";
import { readPdfStep, type PdfLike } from "../src/engine/reading/pdf.ts";
import { readCanvas } from "../src/engine/reading/canvas.ts";
import { kindOf, titleOf } from "../src/engine/reading/types.ts";

function pdf(pages: string[], title?: string): PdfLike {
  return {
    numPages: pages.length,
    getMetadata: async () => ({ info: title ? { Title: title } : {} }),
    getPage: async (n) => ({
      getTextContent: async () => ({ items: pages[n - 1].split("\n").map((line) => ({ str: line, hasEOL: true })) }),
    }),
  };
}

test("each PDF page with text is a passage, numbered as Obsidian numbers pages", async () => {
  const page = "The tenancy agreement for the flat on Linden Street, signed in March, with the deposit and rent. ".repeat(3);
  const read = await readPdfStep("Admin/Lease.pdf", pdf([page, "Scan 1", page], "Tenancy agreement"), 0);
  assert.deepEqual(read.pieces.map((p) => [p.loc, p.text !== null]), [[1, true], [2, false], [3, true]]);
  assert.ok(read.pieces[0].text!.startsWith("title: Tenancy agreement | text: The tenancy"));
  assert.deepEqual(read.info, { pages: 3, title: "Tenancy agreement", pictures: [2] });
  assert.equal(read.next, null);
});

test("a long PDF is read in steps of 30 pages", async () => {
  const pages = Array.from({ length: 70 }, (_, i) => `Page ${i + 1} ` + "words of the report ".repeat(15));
  const first = await readPdfStep("Report.pdf", pdf(pages), 0);
  assert.equal(first.pieces.length, 30);
  assert.equal(first.next, 30);
  const last = await readPdfStep("Report.pdf", pdf(pages), 60);
  assert.deepEqual([last.pieces[0].loc, last.pieces.length, last.next], [61, 10, null]);
});

test("a canvas's cards are read like notes; groups and files are kept as words", () => {
  const canvas = JSON.stringify({ nodes: [
    { id: "a", type: "text", text: "## Launch plan\nRecord the voiceover, then cut the picture to the words." },
    { id: "b", type: "group", label: "Week one" },
    { id: "c", type: "file", file: "Media/teaser.mp4" },
  ] });
  const read = readCanvas("Projects/Launch board.canvas", canvas);
  assert.equal(read.pieces[0].text, "title: Launch board | text: Launch plan\nRecord the voiceover, then cut the picture to the words.");
  assert.deepEqual(read.pieces[1], { kind: "name", text: null, body: "Week one\nteaser.mp4", loc: null });
  assert.equal(readCanvas("x.canvas", "{not json").note, "not a canvas Obsidian can read");
});

test("files are known by their extension; a name that says nothing isn't a title", () => {
  assert.equal(kindOf("a/b/Trip.MD"), "note");
  assert.equal(kindOf("scan.JPEG"), "image");
  assert.equal(kindOf("data.json"), null);
  assert.equal(titleOf("Photos/IMG_1001.md"), null);
  assert.equal(titleOf("Recipes/Grandma's soup.md"), "Grandma's soup");
  assert.equal(titleOf("x.md", "Untitled document"), null);
});
