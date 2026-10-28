// THE CONTINUOUS-WORK CAP, DRIVEN THROUGH THE REAL ENGINE (2026-10-11, release review items 2 and 3).
//
// ⚠ WHAT WAS MISSING. `session-work-cap.js` is the module's own headline risk — its header says so: a
// stale `workSince` makes the FIRST tool frame of the next stretch read as already past the cap and
// parks the session instantly, on a loop. The two clears that prevent that live in `session-engine.js`
// (`dispatch`'s `result` arm and the `abortQuery` effect), and NEITHER had an asserting test: only the
// pure arithmetic was covered, which agrees with itself whatever the engine does with it.
//
// ⚠ AND THE "NEVER PARK MID-WORK" RULING WAS NOT ACHIEVED FOR THE CASE IT WAS WRITTEN ABOUT. The only
// re-arm sources are `tool_use` / `tool_result` / `assistant` / `thinking`; there is no heartbeat, and
// the normalizer's `context` frames are consumed and never dispatched. One twenty-minute `Bash` or
// `Task` call therefore streams NOTHING between T and T+20m, the fifteen-minute park fired at T+15m,
// and `abortQuery` tore the query down mid-call. A tool in flight now holds the park open — and the
// two-hour cap still parks a tool that never returns, which is the other half of the ruling.
//
// Driven on the REAL engine (`_engine-harness.mjs`) over a VIRTUAL CLOCK (`_engine-clock.mjs`): raw
// Claude frames in, the engine's own `scheduleIdle` arming read back out.
//
// Run: `node --test dopl-desktop-app/test/session-work-cap-engine.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { freeze, advance, armedMs, expire } from "./_engine-clock.mjs";
import {
  engine, rt, frames, settle, registryReads, launchArgs, MAIN, CHANNEL, ME,
} from "./_engine-harness.mjs";
import { loadReducer } from "./_reducer-block.mjs";

const { DEFAULT_IDLE_MS } = loadReducer();
const { WORK_CAP_MS } = createRequire(import.meta.url)(join(MAIN, "session-work-cap.js"));
const HOUR = 60 * 60 * 1000;

engine.setSelfIdentity(ME);

// ── raw Claude frames the harness does not carry ──────────────────────────────
// A real tool call and its result, as `runtime/claude/normalize.js › renderEvents` reads them: the
// `tool_use` block's `id` is what becomes `payload.toolUseId`, and the `tool_result` block's
// `tool_use_id` is what matches it back.

const toolUse = (id, name = "Bash") => ({
  type: "assistant",
  parent_tool_use_id: null,
  message: { content: [{ type: "tool_use", id, name, input: { command: "sleep 1200" } }] },
});
const toolResult = (id) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: "ok" }] },
});

/** One live responder session on the real engine, plus its runtime handle. */
async function live(agentName) {
  const before = rt.handles.length;
  const res = await engine.launchResponderSession(launchArgs({ threadId: "", agentName }));
  assert.ok(res && res.sessionId, `launched: ${JSON.stringify(res)}`);
  await settle();
  const h = rt.handles[before];
  const s = registryReads.sessionOn({ channelId: CHANNEL, threadId: "", agentId: res.agentId });
  assert.ok(h && s, "the handle and the registry entry");
  return { h, s, agentId: res.agentId };
}

// ── ITEM 2: the two clears, asserted end to end ───────────────────────────────

test("`result` ENDS THE STRETCH: a second turn three hours later re-arms the FULL TTL, not zero", async () => {
  const T0 = freeze(Date.now());
  const { h, s } = await live("Two Turns");
  h.feed(frames.init("sdk-turns"));
  await settle();
  assert.equal(armedMs(s), DEFAULT_IDLE_MS, "`launched` arms the ordinary idle TTL");

  // TURN ONE.
  h.feed(toolUse("t1"));
  await settle();
  assert.equal(s.workSince, T0, "the stretch is stamped by its FIRST live frame");
  assert.equal(armedMs(s), DEFAULT_IDLE_MS, "a work re-arm at the top of the cap is the full TTL");
  h.feed(toolResult("t1"));
  h.feed(frames.result());
  await settle();
  assert.equal(s.workSince, null, "the turn end ended the stretch (`dispatch`'s `result` arm)");
  assert.equal(armedMs(s), DEFAULT_IDLE_MS, "…and armed the PLAIN TTL, unclamped");

  // TURN TWO, THREE HOURS LATER — comfortably past the two-hour cap. This is the stale-stamp trap: if
  // `workSince` still held T0, `capMsLeft` would be 0 and this frame would arm the timer at ZERO and
  // park a session that has only just started working, over and over.
  advance(3 * HOUR);
  h.feed(toolUse("t2"));
  await settle();
  assert.equal(armedMs(s), DEFAULT_IDLE_MS, "a fresh stretch has the WHOLE cap");
  assert.equal(s.workSince, T0 + 3 * HOUR, "and it is stamped by its own first frame");
  assert.equal(s.state.parked, false, "nothing parked");

  h.feed(toolResult("t2"));
  h.feed(frames.result());
  await settle();
  assert.equal(s.workSince, null, "the second turn end ended the second stretch too");
});

test("THE CLAMP IS REAL: inside the last TTL of the cap the engine SHORTENS the work re-arm", async () => {
  // The engine's one line of arithmetic, read off the engine rather than re-derived in a test: with
  // five minutes of cap left, a work frame arms five minutes, not fifteen.
  const T0 = freeze(Date.now());
  const { h, s } = await live("Clamped");
  h.feed(frames.init("sdk-clamp"));
  await settle();
  h.feed(toolUse("c1"));
  h.feed(toolResult("c1"));
  await settle();
  assert.equal(s.workSince, T0);

  advance(WORK_CAP_MS - 5 * 60 * 1000);
  h.feed(toolUse("c2"));
  h.feed(toolResult("c2"));
  await settle();
  assert.equal(armedMs(s), 5 * 60 * 1000, "clamped to what the cap has left");
  assert.ok(armedMs(s) < DEFAULT_IDLE_MS, "the clamp only ever SHORTENS");
});

test("the park at the CAP clears the stretch, so the RESUMED session's first frame arms the full TTL", async () => {
  const T0 = freeze(Date.now());
  const { h, s, agentId } = await live("Capped");
  h.feed(frames.init("sdk-cap"));
  await settle();
  // One unbroken stretch: a frame, then the cap's worth of time, then a frame.
  h.feed(toolUse("p1"));
  h.feed(toolResult("p1"));
  await settle();
  assert.equal(s.workSince, T0);

  // Carry the SAME stretch to the very edge of the cap: the last work re-arm it can get is the TTL
  // that ends exactly at `WORK_CAP_MS`. (Driven by hand rather than by letting a zero-length timer
  // fire, so the moment of the park is this test's choice and not the event loop's.)
  advance(WORK_CAP_MS - DEFAULT_IDLE_MS);
  h.feed(toolUse("p2"));
  h.feed(toolResult("p2"));
  await settle();
  assert.equal(armedMs(s), DEFAULT_IDLE_MS, "the cap's last full TTL");
  assert.equal(s.workSince, T0, "and it is still ONE stretch, two hours long");

  advance(DEFAULT_IDLE_MS);
  assert.equal(expire(s), true);
  await settle();
  assert.equal(s.state.parked, true, "a spent cap parks the session");
  assert.equal(s.state.phase, "parked", "…by the ORDINARY idle_timeout — resumable, never an end");
  // ⚠ THE `abortQuery` CLEAR, which is the one with no test at all before this. Park, crash and end
  // all run that effect, so it is the clear that catches every teardown.
  assert.equal(s.workSince, null, "the park's teardown ended the stretch");

  // Woken. Before the clear, the first frame of this new stretch would read as `WORK_CAP_MS` old and
  // arm the timer at zero — parking the session the operator just resumed, on a loop.
  assert.deepEqual(
    engine.messageByThread({ channelId: CHANNEL, threadId: "", agentId, text: "carry on" }),
    { ok: true }
  );
  await settle();
  const h2 = rt.handles[rt.handles.length - 1];
  assert.equal(h2.via, "resume", "the wake resumed the conversation");
  h2.feed(frames.init("sdk-cap-2"));
  await settle();
  h2.feed(toolUse("p3"));
  await settle();
  assert.equal(s.state.parked, false, "running again");
  assert.equal(armedMs(s), DEFAULT_IDLE_MS, "the first live frame of the new stretch arms the FULL TTL");
  assert.equal(s.workSince, T0 + WORK_CAP_MS, "stamped by its own first frame, not the old one's");
});

// ── ITEM 3: a tool in flight holds the park open ──────────────────────────────

test("A SINGLE LONG TOOL CALL IS NOT PARKED: twenty minutes between `tool_use` and `tool_result`", async () => {
  const T0 = freeze(Date.now());
  const { h, s } = await live("Long Task");
  h.feed(frames.init("sdk-long"));
  await settle();

  // The call starts, and then NOTHING streams: no heartbeat, and `context` frames are never dispatched.
  h.feed(toolUse("b1"));
  await settle();
  assert.equal(s.toolsInFlight.size, 1, "the engine knows a call is outstanding");
  assert.equal(armedMs(s), DEFAULT_IDLE_MS);

  // T+15m: the timer expires MID-CALL. This is the exact moment the defect fired.
  advance(DEFAULT_IDLE_MS);
  assert.equal(expire(s), true, "the ordinary park came due");
  await settle();
  assert.equal(s.state.parked, false, "a tool in flight holds the park open");
  assert.equal(s.state.phase, "running");
  assert.equal(h.closed, false, "…and the query was NOT torn down under the running call");
  assert.equal(s.workSince, T0, "it is still one stretch — the hold is not a boundary");
  assert.equal(armedMs(s), DEFAULT_IDLE_MS, "the park is DEFERRED, re-armed as a work re-arm");

  // T+20m: the call returns. One tool call, twenty minutes, session alive and working.
  advance(5 * 60 * 1000);
  h.feed(toolResult("b1"));
  await settle();
  assert.equal(s.toolsInFlight.size, 0, "nothing outstanding now");
  assert.equal(s.state.parked, false);
  h.feed(frames.result());
  await settle();
  assert.equal(s.state.activity, "idle", "the turn ends normally");
  assert.equal(s.workSince, null);
});

test("…and once the call RETURNS the hold is gone: the next expiry parks, as it always did", async () => {
  const T0 = freeze(Date.now());
  const { h, s } = await live("Quiet After");
  h.feed(frames.init("sdk-quiet"));
  await settle();
  h.feed(toolUse("q1"));
  h.feed(toolResult("q1"));
  await settle();
  assert.equal(s.toolsInFlight.size, 0);
  assert.equal(s.workSince, T0, "still inside the stretch, but nothing is in flight");

  advance(DEFAULT_IDLE_MS);
  assert.equal(expire(s), true);
  await settle();
  assert.equal(s.state.parked, true, "a session with no call outstanding parks at fifteen minutes");
});

test("…but a tool that NEVER returns still parks at the two-hour cap", async () => {
  freeze(Date.now());
  const { h, s } = await live("Runaway Tool");
  h.feed(frames.init("sdk-runaway"));
  await settle();
  h.feed(toolUse("never"));
  await settle();
  assert.equal(s.toolsInFlight.size, 1);

  // Walk the deferral forward in TTL-sized steps, exactly as the engine does: each expiry finds the
  // call still outstanding and re-arms — until the cap has nothing left to give. A hold is not a
  // licence, and `capMsLeft` reaching zero is also what stops the deferral being a busy loop.
  const steps = WORK_CAP_MS / DEFAULT_IDLE_MS;
  assert.equal(steps, 8, "two hours of fifteen-minute TTLs");
  for (let i = 0; i < steps; i += 1) {
    assert.equal(s.state.parked, false, `still working at expiry ${i}`);
    advance(DEFAULT_IDLE_MS);
    assert.equal(expire(s), true, `expiry ${i} had a timer to fire`);
    await settle();
  }
  assert.equal(s.state.parked, true, "the cap parks the runaway");
  assert.equal(s.state.phase, "parked", "resumable, never an end");
  assert.equal(s.workSince, null, "the teardown ended the stretch");
  assert.equal(s.toolsInFlight.size, 0, "…and cleared the in-flight set with it");
});

test("the hold is for WORK, not for a parked session's abandonment bound", async () => {
  // A parked session's drained tail already dispatches nothing (FIX #5), and the timer it holds is the
  // ABANDONMENT bound — M2's "a parked session nobody comes back to ends". The hold must never push
  // that out, or an agent with one unanswered tool call would never end.
  freeze(Date.now());
  const { h, s } = await live("Parked Tail");
  h.feed(frames.init("sdk-tail"));
  await settle();
  h.feed(toolUse("d1"));
  await settle();
  assert.equal(s.toolsInFlight.size, 1);

  // Park it by hand (the operator's pause reaches the same effects as the timer).
  advance(WORK_CAP_MS);
  assert.equal(expire(s), true);
  await settle();
  assert.equal(s.state.parked, true);
  assert.equal(s.toolsInFlight.size, 0, "the teardown cleared it, so no hold survives the park");
  const bound = armedMs(s);
  assert.ok(bound > DEFAULT_IDLE_MS, `the abandonment bound is armed (${bound})`);
  // Its expiry ENDS the session, with no hold anywhere in the way.
  assert.equal(expire(s), true);
  await settle();
  assert.equal(s.state.phase, "ended");
});
