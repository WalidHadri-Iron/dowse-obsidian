// Pictures made a few at a time, the most wanted first (src/plugin/lane.ts)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Lane } from "../src/plugin/lane.ts";

const later = () => { let open!: () => void; const gate = new Promise<void>((r) => { open = r; }); return { gate, open }; };

test("no more than its width run at once; the highest priority waiting goes next, then the first asked", async () => {
  const lane = new Lane(2), started: string[] = [], gates = new Map<string, () => void>();
  let running = 0, most = 0;
  const job = (name: string, priority: number) => lane.run(priority, async () => {
    started.push(name); running++; most = Math.max(most, running);
    const { gate, open } = later(); gates.set(name, open); await gate; running--; return name;
  });
  const all = [job("thumb1", 96), job("thumb2", 96), job("thumb3", 96), job("thumb4", 96), job("match", 900), job("near", 560)];
  await Promise.resolve();
  assert.deepEqual(started, ["thumb1", "thumb2"]);
  gates.get("thumb1")!(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(started[2], "match", "a match's picture jumps the thumbnails");
  gates.get("thumb2")!(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(started[3], "near");
  for (const name of ["match", "near"]) gates.get(name)!();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(started.slice(4), ["thumb3", "thumb4"], "then the rest, first asked first");
  for (const name of ["thumb3", "thumb4"]) gates.get(name)!();
  assert.deepEqual(await Promise.all(all), ["thumb1", "thumb2", "thumb3", "thumb4", "match", "near"]);
  assert.equal(most, 2);
});

test("clearing drops what hasn't started; a failure frees its place", async () => {
  const lane = new Lane(1), { gate, open } = later();
  const first = lane.run(1, async () => { await gate; throw new Error("broken page"); });
  const dropped = lane.run(1, async () => "never");
  lane.clear();
  await assert.rejects(dropped, /cancelled/);
  open();
  await assert.rejects(first, /broken page/);
  assert.equal(await lane.run(1, async () => "next"), "next");
});
