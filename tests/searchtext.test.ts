// The text rules give what Dowse's give (tests/fixtures/searchtext.json, made by Dowse's own `searchtext`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chunks, hasWords, mark, normalized, snippet, terms, words } from "../src/engine/searchtext.ts";

const fixture = JSON.parse(readFileSync(new URL("fixtures/searchtext.json", import.meta.url), "utf8"));

test("normalized, words and has-words agree with Dowse", () => {
  for (const c of fixture.cases) {
    assert.equal(normalized(c.text), c.normalized);
    assert.deepEqual(words(c.text).map(([a, b]) => c.text.slice(a, b)), c.words);
    assert.equal(hasWords(c.text), c.has_words, c.text);
  }
});

test("a query's terms agree with Dowse", () => {
  for (const [query, expected] of Object.entries(fixture.terms)) assert.deepEqual(terms(query), expected);
});

test("passages are cut where Dowse cuts them", () => {
  for (const c of fixture.cases) {
    assert.deepEqual(chunks(c.text), c.chunks);
    assert.deepEqual(chunks(c.text, 300, 60), c.chunks_small);
  }
});

test("snippets and marks agree with Dowse", () => {
  for (const c of fixture.cases) {
    for (const [query, expected] of Object.entries(c.snippets)) assert.equal(snippet(c.text, terms(query)), expected, query);
    assert.equal(mark(c.text, terms("update access lac soupe কুমির")), c.mark);
  }
});
