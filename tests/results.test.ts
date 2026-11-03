// How a result reads: an excerpt without Markdown's marks, and no "line 1" for a note found at its start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { atMoment, lineOf, mediaMoments, momentLabel, readable, shownOf, timestamp, type Shown } from "../src/ui/results.ts";
import type { Hit } from "../src/engine/search/searcher.ts";

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

test("media results retain every matching moment and distinguish passages from sampled frames", () => {
  const hit: Hit = { path: "clip.mp4", kind: "video", score: 4, z: 4, cosine: .7, keywordRank: null,
    segment: "audio", segmentId: 1, loc: 28, locEnd: 36, excerpt: null, mtime: 1, info: {},
    moments: [[68, 76], [104, null]], clear: true, evidence: [] };
  const shown = shownOf(hit);
  assert.deepEqual(mediaMoments(shown), [[28, 36], [68, 76], [104, null]]);
  assert.equal(lineOf(shown), "Video · ≈ 0:28–0:36");
  assert.equal(momentLabel([9, null]), "0:09");
  assert.equal(timestamp(3605), "1:00:05");
  assert.equal(timestamp(8.9), "0:08", "never round past a matching frame");
  const next = atMoment(shown, [68, 76]);
  assert.deepEqual([next.loc, next.locEnd], [68, 76]);
  assert.equal(shown.loc, 28, "opening a secondary moment must not mutate the main result");
  shown.moments![0][0] = 70;
  assert.equal(hit.moments[0][0], 68, "UI state cannot mutate the cached search response");
});

test("moment controls ignore invalid and duplicate locations, and filename-only results have none", () => {
  const shown: Shown = { path: "recording.mp3", kind: "audio", loc: 0, locEnd: 8, excerpt: null, info: {},
    moments: [[0, 8], [-1, 3], [8, 7], [NaN, null], [16, 24]] };
  assert.deepEqual(mediaMoments(shown), [[0, 8], [16, 24]]);
  assert.deepEqual(mediaMoments({ ...shown, loc: null }), []);
  assert.deepEqual(mediaMoments({ ...shown, kind: "note" }), []);
});

test("an excerpt cut at a word, with an ellipsis", async () => {
  const { clip } = await import("../src/plugin/search.ts");
  assert.equal(clip("short", 220), "short");
  assert.equal(clip("Tenancy agreement for the flat on Linden Street, signed in March", 30), "Tenancy agreement for the…");
});
