// Which graphics card the model runs on, and whether there's a faster one to offer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { among, dedicated } from "../src/plugin/graphics.ts";

test("cards of their own are told from integrated ones", () => {
  for (const name of ["NVIDIA GeForce RTX 4070 Ti", "NVIDIA RTX A2000", "AMD Radeon RX 7800 XT", "AMD Radeon(TM) RX 6600",
                      "AMD Radeon Pro W6600", "Intel(R) Arc(TM) A770 Graphics", "Intel(R) Arc(TM) B580 Graphics"])
    assert.ok(dedicated(name), name);
  for (const name of ["AMD Radeon(TM) Graphics", "AMD Radeon(TM) 780M", "Intel(R) UHD Graphics 770",
                      "Intel(R) Iris(R) Xe Graphics", "Intel(R) Arc(TM) 140V GPU (16GB)"])
    assert.ok(!dedicated(name), name);
});

test("the model on the integrated GPU while a card is there: offered; on the card, or one maker for both: not", () => {
  const pc = ["AMD Radeon(TM) Graphics", "NVIDIA GeForce RTX 4070 Ti"];
  assert.deepEqual(among(pc, "amd rdna-2"), { faster: "NVIDIA GeForce RTX 4070 Ti", on: false });
  assert.deepEqual(among(pc, "nvidia lovelace"), { faster: "NVIDIA GeForce RTX 4070 Ti", on: true });
  assert.deepEqual(among(["AMD Radeon(TM) Graphics", "AMD Radeon RX 7800 XT"], "amd rdna-3"), { faster: "AMD Radeon RX 7800 XT", on: null });
  assert.deepEqual(among(["Intel(R) UHD Graphics 770"], "intel gen-12lp"), { faster: null, on: null });
});
