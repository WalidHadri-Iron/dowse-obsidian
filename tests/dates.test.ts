// Dates read from queries agree with Dowse's (tests/fixtures/dates.json, made by Dowse's `dates`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forMeaning, parse } from "../src/engine/search/dates.ts";

const fixture = JSON.parse(readFileSync(new URL("fixtures/dates.json", import.meta.url), "utf8"));

test("dates in queries are read as Dowse reads them", () => {
  for (const c of fixture) {
    const [y, m, d] = c.now.split("-").map(Number);
    const now = new Date(y, m - 1, d, 12).getTime();
    const found = parse(c.query, now);
    const label = `${c.now} · ${c.query}`;
    if (c.span === null) assert.equal(found, null, label);
    else assert.deepEqual(found && { label: found.label, rest: found.rest, from: found.from, to: found.to }, c.span, label);
    assert.equal(forMeaning(c.query, now), c.for_meaning, label);
  }
});
