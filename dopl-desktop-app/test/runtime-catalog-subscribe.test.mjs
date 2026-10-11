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
  const control = []; // never unsubscribes: proves the second live read really reached listeners
  const off = catalog.onLiveReady((id, c) => seen.push([id, c.status, c.models.map((m) => m.id)]));
  catalog.onLiveReady((id) => control.push(id));
  assert.equal(typeof off, "function");
  catalog.snapshot(a);
  await settle();
  assert.deepEqual(seen, [["rt", "ready", ["m-1"]]]);
  assert.deepEqual(control, ["rt"]);

  off();
  catalog.invalidate("rt", "test");
  catalog.snapshot(a);
  await settle();
  assert.equal(catalog.snapshot(a).status, "ready", "a second live read did settle");
  assert.deepEqual(control, ["rt", "rt"], "the still-subscribed control heard the second live read");
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

test("a non-function subscriber is never stored, answers an unsubscribe and never breaks a read", async () => {
  const catalog = loadCatalog();
  // ⚠ WHY A PUSH SPY. Listener calls are try/catch-wrapped, so a stored non-function is swallowed
  // when called and no read can show it: the guard's ONLY effect is that nothing is stored. The
  // module is evaluated in this realm (`new Function`), so its `list.push` is this Array.prototype.push.
  const NOT_A_FN = { notAFunction: true };
  const pushed = [];
  const realPush = Array.prototype.push;
  Array.prototype.push = function (...items) { if (this !== pushed) realPush.apply(pushed, items); return realPush.apply(this, items); };
  const fn = () => {};
  let offs;
  try {
    offs = [catalog.onSettled, catalog.onLiveReady].flatMap((subscribe) => [subscribe(NOT_A_FN), subscribe(fn)]);
  } finally {
    Array.prototype.push = realPush;
  }
  assert.equal(pushed.filter((x) => x === fn).length, 2, "control: a function subscriber IS stored (the spy sees pushes)");
  assert.equal(pushed.includes(NOT_A_FN), false, "a non-function subscriber is never stored");
  for (const off of offs) {
    assert.equal(typeof off, "function");
    assert.doesNotThrow(() => off());
  }
  const { state, a } = flippable();
  state.ok = true;
  catalog.snapshot(a);
  await settle();
  assert.equal(catalog.snapshot(a).status, "ready", "a read after a non-function subscribe settles normally");
});
