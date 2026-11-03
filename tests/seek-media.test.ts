import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { seekMedia } from "../src/plugin/seek-media.ts";

class Player extends EventTarget {
  readyState = 4;
  duration = 90;
  seeking = false;
  time = 0;
  seeks = 0;
  complete = true;
  get currentTime(): number { return this.time; }
  set currentTime(value: number) {
    this.seeks++; this.seeking = true;
    if (this.complete) queueMicrotask(() => { this.time = value; this.seeking = false; this.dispatchEvent(new Event("seeked")); });
  }
  get element(): HTMLMediaElement { return this as unknown as HTMLMediaElement; }
}

test("a search waits until the native player reaches the requested nonzero timestamp", async () => {
  const player = new Player();
  assert.equal(await seekMedia(player.element, 28), 28);
  assert.equal(player.currentTime, 28);
  assert.equal(player.seeking, false);
  await seekMedia(player.element, 28);
  assert.equal(player.seeks, 1, "an already cued player does not wait for a nonexistent seek event");
  assert.equal(await seekMedia(player.element, 999), 89.99, "outdated hits clamp within the updated duration");
  assert.equal(getEventListeners(player, "seeked").length, 0);
});

test("a new player waits for metadata; zero, invalid timestamps and cancelled navigation are handled", async () => {
  const player = new Player(); player.readyState = 0;
  const pending = seekMedia(player.element, 9);
  assert.equal(player.seeks, 0);
  player.readyState = 1; player.dispatchEvent(new Event("loadedmetadata"));
  await pending; assert.equal(player.currentTime, 9);
  await seekMedia(player.element, 0); assert.equal(player.currentTime, 0);
  await assert.rejects(seekMedia(player.element, NaN), /Invalid/);
  const cancel = new AbortController(); player.complete = false;
  const stopped = seekMedia(player.element, 50, cancel.signal);
  cancel.abort(); await assert.rejects(stopped);
  assert.equal(getEventListeners(player, "seeked").length, 0);
  assert.equal(getEventListeners(player, "error").length, 0);
});
