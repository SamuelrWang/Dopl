// LIVE WORK CORRECTS A STALE BETWEEN-TURNS LABEL — regression for the "waiting while it is clearly
// working" defect (Samuel, 2026-10-10; `main/session-reducer.js › workingPatch`).
//
// THE SHAPE OF THE BUG, which is what the first test reproduces end to end: a push that arrives MID-TURN
// queues on the prompt iterator instead of being consumed (`session-io.js › makePushIterator.push`). Its own
// dispatch marks `working`; the in-flight turn's `result` then lands and overwrites that with the end-of-turn
// word; and the turn the push STARTED used to run to completion with nothing in the stream able to move the
// label back. `session-pill.js` maps both `idle` and `awaiting_peer` to the `idle` pill, so the window read
// "Waiting" and `channel_sessions.state` agreed while the tool label was seconds old.
//
// SOURCE EXTRACTION, like session-reducer.test.mjs: the real sentinel blocks are sliced and evaluated, so
// these assertions are about what ships.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadReducer } from "./_reducer-block.mjs";

const { initialSessionState, sessionReducer } = loadReducer();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;

const toolUse = { type: "tool_use", payload: { name: "mcp__dopl__dopl_edit_object", toolUseId: "t1" } };

// ── the reproduction ──────────────────────────────────────────────────────────

test("a turn started by a MID-TURN push reports working, not waiting (the 2026-10-10 defect)", () => {
  // The agent posts, so the turn it is in will end `awaiting_peer`.
  let s = sessionReducer(running(), { type: "outbound_post", payload: { toolUseId: "p1" } }).state;
  assert.equal(s.postedThisTurn, true);

  // A steer lands while that turn is still in flight: the dispatch marks working, the push QUEUES.
  const steered = sessionReducer(s, { type: "steer", text: "keep going" });
  assert.equal(steered.state.activity, "working");
  assert.ok(
    steered.effects.some((e) => e.type === "pushTurn"),
    "the steer queues a turn rather than starting one"
  );
  s = steered.state;

  // The ORIGINAL turn now ends. This is the overwrite: correct for the turn that just finished.
  s = sessionReducer(s, { type: "result" }).state;
  assert.equal(s.activity, "awaiting_peer", "turn end still records that it posted");

  // The queued turn is consumed and the runtime starts streaming. BEFORE the fix the label stayed
  // `awaiting_peer` for the whole of it.
  s = sessionReducer(s, toolUse).state;
  assert.equal(s.activity, "working", "a streamed tool call says the session is working");
});

// ── every live frame, and only the two stale words ────────────────────────────

for (const event of [
  toolUse,
  { type: "tool_result", payload: { toolUseId: "t1", ok: true } },
  { type: "assistant", payload: { text: "looking at the next object" } },
  { type: "thinking", payload: { text: "which field is unset" } },
]) {
  test(`${event.type} corrects idle -> working`, () => {
    const s = sessionReducer({ ...running(), activity: "idle" }, event).state;
    assert.equal(s.activity, "working");
  });

  test(`${event.type} corrects awaiting_peer -> working`, () => {
    const s = sessionReducer({ ...running(), activity: "awaiting_peer" }, event).state;
    assert.equal(s.activity, "working");
  });

  test(`${event.type} NEVER talks over a held gate`, () => {
    // A card is open: `awaiting_permission` is the finer truth and `gateActivity` owns that decision.
    const held = { ...running(), activity: "awaiting_permission", pendingPermissions: ["r1"] };
    assert.equal(sessionReducer(held, event).state.activity, "awaiting_permission");
    // …and a pending card under a between-turns label resolves the same way, never to plain `working`.
    const stale = { ...running(), activity: "idle", pendingPermissions: ["r1"] };
    assert.equal(sessionReducer(stale, event).state.activity, "awaiting_permission");
  });

  test(`${event.type} NEVER wakes a parked session (FIX #5's drained tail)`, () => {
    const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
    assert.equal(parked.parked, true);
    const r = sessionReducer(parked, event);
    assert.equal(r.state.activity, "parked");
    assert.equal(r.state.phase, "parked");
    assert.equal(r.state.parked, true);
    // ⚠ AND IT ARMS NOTHING: the timer a parked session holds is the ABANDONMENT bound, and a drained tail
    // must not push that out — M2's "a parked session nobody comes back to ends" would never fire.
    assert.deepEqual(r.effects, []);
  });

  test(`${event.type} NEVER revives an ended session`, () => {
    const ended = sessionReducer(running(), { type: "inactive" }).state;
    const after = sessionReducer(ended, event);
    assert.equal(after.state.phase, "ended");
    assert.deepEqual(after.effects, []);
  });

  test(`${event.type} RE-ARMS the idle TTL, as a WORK re-arm`, () => {
    // 2026-10-10, "never park mid-work": a live frame holds the TTL open, and `from: 'work'` is what lets
    // the engine bound that against the continuous-work cap. Without the word it would be unparkable.
    const r = sessionReducer({ ...running(), activity: "idle" }, event);
    assert.deepEqual(r.effects, [{ type: "scheduleIdle", from: "work" }]);
  });

  test(`${event.type} re-arms even when the state does NOT move`, () => {
    // The session already reads `working` — which is exactly the one whose timer has to be pushed out. The
    // re-arm must not ride on the label having changed.
    const s = { ...running(), activity: "working" };
    const r = sessionReducer(s, event);
    assert.equal(r.state.activity, "working");
    assert.equal(r.state, s, "no state object is minted when nothing moved");
    assert.deepEqual(r.effects, [{ type: "scheduleIdle", from: "work" }]);
  });
}

// ── the correction must not cost F3 ───────────────────────────────────────────

test("a DENIED post's failing result still un-counts it, and corrects the label too", () => {
  let s = sessionReducer(running(), { type: "outbound_post", payload: { toolUseId: "p1" } }).state;
  s = sessionReducer(s, { type: "result" }).state;
  assert.equal(s.activity, "awaiting_peer");
  // The gate refused the post: FIX F3 un-counts it, and the frame is live work all the same.
  const r = sessionReducer({ ...s, postedThisTurn: true, postedToolUseIds: ["p1"] }, {
    type: "tool_result",
    payload: { toolUseId: "p1", ok: false },
  });
  assert.deepEqual(r.state.postedToolUseIds, []);
  assert.equal(r.state.postedThisTurn, false);
  assert.equal(r.state.activity, "working");
});

test("turn end still settles the label after a correction", () => {
  // The correction is not sticky: a turn that posted nothing ends `idle`, exactly as before.
  let s = sessionReducer({ ...running(), activity: "awaiting_peer" }, toolUse).state;
  assert.equal(s.activity, "working");
  s = sessionReducer(s, { type: "result" }).state;
  assert.equal(s.activity, "idle");
});
