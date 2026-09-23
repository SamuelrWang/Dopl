// P4-07 — A LAUNCH REFUSED FOR A MISSING CREDENTIAL LEAVES NOTHING BEHIND.
//
// The windowless preflight used to register the session, persist its record, raise the auth hold
// (which parks the record and posts the AUTH_HELD note) and then roll back the registry only. The
// caller was told `auth-hold`, yet the record stayed on disk at `parked`, and the next boot ended
// it as an Ended card for an agent that never started. Driven through the real engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { engine, rt, STORE, lifecycles, launchArgs, settle, CHANNEL } from "./_engine-harness.mjs";

const recordsFor = () => Object.keys(STORE.sessionRecords || {}).filter((k) => k.startsWith(CHANNEL));

test("a signed-out launch (New Agent and a peer trigger) registers, persists and posts nothing", async () => {
  rt.credential = { usable: false, source: null };
  for (const over of [{ idle: true }, {}]) {
    const res = await engine.launchResponderSession(launchArgs(over));
    assert.deepEqual(res, { skipped: "auth-hold" }, JSON.stringify(over));
  }
  await settle();
  assert.deepEqual(recordsFor(), [], "no durable record for an agent that was never started");
  assert.deepEqual(engine.listLiveSessions(), []);
  assert.deepEqual(lifecycles, [], "the caller answers the peer; the engine posts no hold note of its own");
  assert.equal(rt.handles.length, 0, "no query was started");
});

test("…so the next boot has nothing to end: no Ended card, no interrupted lifecycle", async () => {
  await engine.init();
  await settle();
  assert.deepEqual(lifecycles, []);
  assert.deepEqual(Object.keys(STORE.agentHistory || {}), []);
});

test("a usable credential, or a probe that fails, is not a refusal: the launch goes ahead", async () => {
  for (const credential of [{ usable: true, source: "cli-store" }, new Error("probe failed")]) {
    rt.credential = credential;
    const res = await engine.launchResponderSession(launchArgs({ idle: true }));
    assert.ok(res.sessionId && res.agentId, JSON.stringify(res));
  }
  assert.equal(recordsFor().length, 2);
});
