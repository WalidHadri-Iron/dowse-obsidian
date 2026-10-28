// The statistics agree with Python's and Dowse's (tests/fixtures/stats.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalInv, normalTail, sidak, tAsZ } from "../src/engine/search/stats.ts";

const fixture = JSON.parse(readFileSync(new URL("fixtures/stats.json", import.meta.url), "utf8"));
const close = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(b), 1e-300) ||
            (b !== 0 && Math.abs(a / b - 1) < 1e-9), `${what}: ${a} vs ${b}`);

test("the normal tail and its inverse", () => {
  for (const [z, p] of fixture.tail) close(normalTail(z), p, `tail ${z}`);
  for (const [p, z] of fixture.inv) close(normalInv(p), z, `inv ${p}`);
});

test("Šidák's correction and Student's t as z, as Dowse computes them", () => {
  for (const [z, n, out] of fixture.sidak) close(sidak(z, n), out, `sidak ${z} ${n}`);
  for (const [t, df, out] of fixture.t) close(tAsZ(t, df), out, `t ${t} ${df}`);
});
