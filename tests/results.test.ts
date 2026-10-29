// How a result reads: an excerpt without Markdown's marks, and no "line 1" for a note found at its start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineOf, readable } from "../src/ui/results.ts";

test("an excerpt reads as text: tables, links, emphasis, code and headings' marks taken out, the query's marks kept", () => {
  assert.equal(readable("...GB | | Version history | 1 month | 12 months | | Devices |"), "...GB · Version history · 1 month · 12 months · Devices");
  assert.equal(readable("## Food **Pastéis** at `Belém`, see [[Lisbon itinerary|the plan]] and [map](http://x)"),
               "Food Pastéis at Belém, see the plan and map");
  assert.equal(readable("the «budget» for _this_ month"), "the «budget» for this month");
  assert.equal(readable("snake_case_name stays"), "snake_case_name stays");
});

test("a note found at its start says no line", () => {
  const note = { path: "Trips/Lisbon.md", kind: "note", locEnd: null, excerpt: null, info: {} };
  assert.equal(lineOf({ ...note, loc: 0 }), "Note · Trips");
  assert.equal(lineOf({ ...note, loc: 4 }), "Note · line 5 · Trips");
});
