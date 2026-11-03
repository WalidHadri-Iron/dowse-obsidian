// Pictures and sound as Dowse reads them (tests/fixtures/media.json, from Dowse's own rules).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { averageHash, frameTimes, isScreenshot, mediaOptions, RATE, sameShot, targetSize, windows } from "../src/engine/reading/media.ts";

const fixture = JSON.parse(readFileSync(new URL("fixtures/media.json", import.meta.url), "utf8"));

test("images are sized and screenshots told apart as Dowse does", () => {
  for (const [h, w, budget, expected] of fixture.sizes) assert.deepEqual(targetSize(h, w, budget), expected, `${h}×${w}@${budget}`);
  for (const [path, expected] of fixture.screenshots) assert.equal(isScreenshot(path), expected, path);
});

test("sound is cut into 30 s windows 25 s apart on a fixed grid; silence and short tails are skipped", () => {
  const tone = (seconds: number) => Float32Array.from({ length: seconds * RATE }, (_, i) => 0.1 * Math.sin(i / 10));
  const all = windows(tone(70), 0, 70);
  assert.deepEqual(all.map((w) => [w.start, w.end]), [[0, 30], [25, 55], [50, 70]]);
  const resumed = windows(tone(70), 50, 70);
  assert.deepEqual(resumed.map((w) => [w.start, w.end]), [[50, 70]], "a resumed read lands on the same windows");
  assert.deepEqual(windows(new Float32Array(60 * RATE), 0, 60), [], "silence isn't worth a vector");
  assert.deepEqual(windows(tone(1), 0, 1), [], "under two seconds: nothing");
  const short = windows(tone(8), 0, 8);
  assert.deepEqual(short.map((w) => [w.start, w.end]), [[0, 8]]);
});

test("frames of one shot are told apart from a new one; frame times space out for long videos", () => {
  const grey = Array.from({ length: 64 }, (_, i) => (i % 8) * 30);
  const nudged = grey.map((v, i) => (i === 3 ? v + 200 : v));
  const other = grey.map((v) => 255 - v);
  assert.equal(sameShot(averageHash(grey), averageHash(nudged)), true);
  assert.equal(sameShot(averageHash(grey), averageHash(other)), false);
  assert.equal(sameShot(null, averageHash(grey)), false);
  assert.deepEqual(frameTimes(10, 3, 1200), [0, 3, 6, 9]);
  assert.equal(frameTimes(7200, 3, 1200).length, 1200);
  assert.deepEqual(frameTimes(20, 3, 1200, 6, 12), [6, 9]);
});

test("both devices sample short video shots while keeping their long-video frame budgets", () => {
  for (const gpu of [true, false]) {
    const options = mediaOptions(gpu);
    const short = frameTimes(18, options.frameInterval, options.maxFrames);
    for (const [start, end] of [[0, 6], [6, 12], [12, 18]]) {
      assert.ok(short.some(t => t >= start && t < end), `missing shot ${start}–${end} in ${gpu ? "GPU" : "CPU"} mode`);
    }
    const full = frameTimes(7200, options.frameInterval, options.maxFrames);
    assert.ok(full.length <= options.maxFrames);
    assert.deepEqual(frameTimes(7200, options.frameInterval, options.maxFrames, 300, 600), full.filter(t => t >= 300 && t < 600));
  }
});

test("timing windows stay short and overlap across both device modes and resumed reads", () => {
  const samples = new Float32Array(51 * RATE).fill(.1);
  for (const gpu of [true, false]) {
    const options = mediaOptions(gpu), { window, hop, step } = options;
    assert.ok(window <= 12 && hop <= 6 && hop < window);
    assert.equal(step % hop, 0, "step boundaries must preserve the fixed timing grid");
    const all = windows(samples, 0, 51, window, hop), start = hop * 3;
    const resumed = windows(samples, start, 51, window, hop);
    assert.deepEqual(resumed.map(w => [w.start, w.end]), all.filter(w => w.start >= start).map(w => [w.start, w.end]));
    assert.ok(all.every(w => w.end - w.start <= window));
    assert.equal(all.at(-1)!.end, 51, "the final phrase must stay searchable");
  }
});
