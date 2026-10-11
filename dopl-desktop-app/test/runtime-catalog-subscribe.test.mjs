// `model-catalog.js › onSettled` / `› onLiveReady` — the two hooks other modules subscribe with
// (`channel-runtime-reply.js`, `catalog-publish.js`). Pins what a subscriber is promised: it is called,
// its unsubscribe stops it, and a non-function subscriber never breaks a read.
//
// Run: `node --test dopl-desktop-app/test/runtime-catalog-subscribe.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, adapter, row, settle } from "./_model-catalog-harness.mjs";

/** An adapter whose roster read fails until `state.ok` flips. */
function flippable() {
  const state = { ok: false };
  const a = adapter({ id: "rt", label: "Rt", models: { source: "live", dimensions: null } }, async () => {
    if (!state.ok) throw new Error("down");
    return { models: [row("m-1", { isDefault: true })] };
  });
  return { state, a };
}

test("`onLiveReady` hands each live ready read to a subscriber until it unsubscribes", async () => {
  const catalog = loadCatalog();
  const { state, a } = flippable();
  state.ok = true;
  const seen = [];
  const off = catalog.onLiveReady((id, c) => seen.push([id, c.status, c.models.map((m) => m.id)]));
  assert.equal(typeof off, "function");
  catalog.snapshot(a);
  await settle();
  assert.deepEqual(seen, [["rt", "ready", ["m-1"]]]);

  off();
  catalog.invalidate("rt", "test");
  catalog.snapshot(a);
  await settle();
  assert.equal(catalog.snapshot(a).status, "ready", "a second live read did settle");
  assert.equal(seen.length, 1, "an unsubscribed listener is not called again");
});

test("`onSettled` stops calling a listener once it unsubscribes", async () => {
  const catalog = loadCatalog();
  const { state, a } = flippable();
  const seen = [];
  const off = catalog.onSettled((id, from, to) => seen.push([id, from, to]));
  catalog.snapshot(a);
  await settle();
  state.ok = true;
  catalog.invalidate("rt", "repaired");
  catalog.snapshot(a);
  await settle();
  assert.deepEqual(seen, [["rt", "unavailable", "ready"]]);

  off();
  state.ok = false;
  catalog.invalidate("rt", "broke");
  catalog.snapshot(a);
  await settle();
  assert.equal(catalog.snapshot(a).status, "stale", "the verdict did change");
  assert.equal(seen.length, 1, "an unsubscribed listener is not called again");
});

test("a non-function subscriber answers an unsubscribe and never breaks a read", async () => {
  const catalog = loadCatalog();
  for (const subscribe of [catalog.onSettled, catalog.onLiveReady]) {
    const off = subscribe(null);
    assert.equal(typeof off, "function");
    assert.doesNotThrow(() => off());
  }
  const { state, a } = flippable();
  state.ok = true;
  catalog.snapshot(a);
  await settle();
  assert.equal(catalog.snapshot(a).status, "ready", "a read with a null subscriber settles normally");
});
