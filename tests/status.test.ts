import { test } from "node:test";
import assert from "node:assert/strict";
import { timeLeft } from "../src/plugin/status.ts";

test("the time left, in words", () => {
  assert.equal(timeLeft(null), "");
  assert.equal(timeLeft(42), "less than a minute left");
  assert.equal(timeLeft(6 * 60 + 10), "about 6 min left");
  assert.equal(timeLeft(59 * 60), "about 59 min left");
  assert.equal(timeLeft(2 * 3600 + 14 * 60), "about 2 h 10 min left");
  assert.equal(timeLeft(2 * 3600 + 58 * 60), "about 3 h left");
});
