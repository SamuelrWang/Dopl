// Tests for the v2.5 D1 INBOUND GATE transitions in the pure session reducer
// (main/session-reducer.js). SAME source-extraction idiom as session-reducer(-park):
// slice the BEGIN/END sentinel block and evaluate it verbatim, so these can never drift
// from what ships. A third reducer test file keeps all three under the §2 500-line cap.
//
// The contract: a counterparty message NEVER reaches the agent before the operator
// accepts it. Covers pending -> accept / accept-for-task / decline, the two auto
// bypasses (the per-session toggle and the standing grant), the parked resume-on-accept,
// a declined message being LOCAL (dropped, nothing posted), and the grant never leaving
// memory (it is not in the durable record projection).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer, REDUCER_SRC } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// §2 SPLIT (H1): the pure block now spans session-effects.js + session-reducer.js;
// test/_reducer-block.mjs slices BOTH sentinel pairs and evaluates them as one program.
const { initialSessionState, sessionReducer, nextIdleMs, turnCapReached, costCapReached,
        DEFAULT_TURN_CAP, DEFAULT_IDLE_MS, DEFAULT_COST_CAP_USD } = loadReducer();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const effTypes = (effects) => effects.map((e) => e.type);
const findEff = (effects, type) => effects.find((e) => e.type === type);
const emitted = (effects, payloadType) =>
  effects.filter((e) => e.type === "emit").map((e) => e.payload).find((p) => p.type === payloadType);
const arrive = { type: "inbound_arrived", pendingId: "p1", message: "can you ship it?", authorName: "David" };

// ── the default is a HOLD, in every mode ─────────────────────────────────────────

test("GATE: a fresh session holds an inbound reply — no push, no counterparty bubble", () => {
  for (const mode of ["interactive", "autonomous"]) {
    const r = sessionReducer(running({ mode }), arrive);
    assert.equal(r.state.phase, "awaiting_inbound", `${mode}: held`);
    assert.equal(r.state.hasPendingInbound, true);
    // FIX #1: the gate card AND the status that makes the pill say so. Those two emits are
    // the ONLY effects — nothing is pushed, nothing is written.
    assert.deepEqual(effTypes(r.effects), ["emit", "emit"], `${mode}: card + status, nothing else`);
    assert.deepEqual(emitted(r.effects, "inbound_pending"), {
      type: "inbound_pending", pendingId: "p1", from: "David", text: "can you ship it?",
    });
    assert.deepEqual(emitted(r.effects, "status"), {
      type: "status", phase: "awaiting_inbound", activity: "awaiting_inbound",
    }, `${mode}: the pill is told a message is waiting`);
    assert.ok(!r.effects.some((e) => e.type === "pushInbound"), `${mode}: the agent never sees it`);
  }
});

test("GATE: a launched session starts with NEITHER opt-in armed (fail closed)", () => {
  const s = running();
  assert.equal(s.messageMode, "ask", "v2.9: AXIS B starts at its most restrictive value");
  assert.equal(s.toolMode, "manual", "and so does AXIS A");
  assert.equal(s.inboundForTask, false);
});

// ── accept ───────────────────────────────────────────────────────────────────────

test("ACCEPT: feeds the held reply as the next turn and returns to working", () => {
  const held = sessionReducer(running(), arrive).state;
  const r = sessionReducer(held, { type: "inbound_accept", pendingId: "p1", message: "can you ship it?", authorName: "David" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.activity, "working");
  assert.equal(r.state.hasPendingInbound, false);
  assert.equal(r.state.inboundForTask, false, "a one-off accept grants nothing standing");
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "can you ship it?", authorName: "David", addressing: null });
  assert.deepEqual(emitted(r.effects, "inbound_resolved"), { type: "inbound_resolved", pendingId: "p1", decision: "accepted" });
});

test("ACCEPT FOR THIS TASK: feeds it AND arms the standing grant", () => {
  const held = sessionReducer(running(), arrive).state;
  const r = sessionReducer(held, { type: "inbound_accept_for_task", pendingId: "p1", message: "go", authorName: "David" });
  assert.equal(r.state.inboundForTask, true);
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "go", authorName: "David", addressing: null });
  assert.deepEqual(emitted(r.effects, "inbound_resolved"), { type: "inbound_resolved", pendingId: "p1", decision: "accepted-task" });
  // The grant makes every LATER reply flow straight through (no second card).
  const next = sessionReducer(r.state, { type: "inbound_arrived", pendingId: "p2", message: "and this", authorName: "David" });
  assert.equal(next.state.phase, "running");
  assert.ok(next.effects.some((e) => e.type === "pushInbound"), "the standing grant feeds it");
  assert.ok(!next.effects.some((e) => e.type === "emit" && e.payload.type === "inbound_pending"), "no card");
});

test("ACCEPT: `inbound_released` is kept as the accept-once alias (v2.3 callers)", () => {
  const held = sessionReducer(running(), arrive).state;
  const r = sessionReducer(held, { type: "inbound_released", message: "go", authorName: "David" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.inboundForTask, false, "the alias never grants anything standing");
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "go", authorName: "David", addressing: null });
});

// ── decline ──────────────────────────────────────────────────────────────────────

test("DECLINE is LOCAL: nothing is pushed, nothing is posted, no grant is recorded", () => {
  const held = sessionReducer(running(), arrive).state;
  const r = sessionReducer(held, { type: "inbound_decline", pendingId: "p1" });
  assert.equal(r.state.hasPendingInbound, false);
  assert.equal(r.state.inboundForTask, false);
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.activity, "idle");
  assert.ok(!r.effects.some((e) => e.type === "pushInbound"), "the agent never sees a declined message");
  // No server write of ANY kind — a decline is not an echo or a lifecycle event. `closeTask`
  // was a real effect type until thread closing (wiring plan Phase 4, 2026-08-18) and stays on
  // this list deliberately: the ban must not quietly narrow when an effect goes away.
  for (const banned of ["lifecycle", "closeTask", "persist", "settle"]) {
    assert.ok(!r.effects.some((e) => e.type === banned), `a decline must not ${banned}`);
  }
  assert.deepEqual(emitted(r.effects, "inbound_resolved"), { type: "inbound_resolved", pendingId: "p1", decision: "declined" });
});

// ── parked: the gate composes with the v2.3 park machinery ───────────────────────

test("PARKED: a held reply does NOT wake the session; the ACCEPT is the wake trigger", () => {
  const parked = sessionReducer(running({ mode: "autonomous" }), { type: "idle_timeout" }).state;
  const held = sessionReducer(parked, arrive);
  assert.equal(held.state.parked, true, "holding a reply never resumes a parked query");
  assert.ok(!held.effects.some((e) => e.type === "resumeQuery"));
  const accepted = sessionReducer(held.state, { type: "inbound_accept", pendingId: "p1", message: "go", authorName: "David" });
  assert.equal(accepted.state.parked, false);
  assert.equal(effTypes(accepted.effects)[0], "resumeQuery", "resume precedes the push (fresh iterator)");
  assert.ok(effTypes(accepted.effects).indexOf("pushInbound") > 0);
});

test("PARKED: a DECLINE leaves the session parked (a decline is not a wake trigger)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const held = sessionReducer(parked, arrive).state;
  const r = sessionReducer(held, { type: "inbound_decline", pendingId: "p1" });
  assert.equal(r.state.parked, true);
  assert.equal(r.state.phase, "parked");
  assert.equal(r.state.activity, "parked");
  assert.ok(!r.effects.some((e) => e.type === "resumeQuery"), "no query is rebuilt for a dropped message");
});

test("PARKED: an auto-accepted reply wakes it exactly like the pre-gate path did", () => {
  const parked = sessionReducer(running({ mode: "autonomous" }), { type: "idle_timeout" }).state;
  const r = sessionReducer({ ...parked, inboundForTask: true }, arrive);
  assert.equal(effTypes(r.effects)[0], "resumeQuery");
  assert.deepEqual(emitted(r.effects, "counterparty"), { type: "counterparty", from: "David", text: "can you ship it?" });
});

// ── the standing grant vs. AXIS B (D4, re-cut for v2.9) ──────────────────────────

test("D4/v2.9: the MESSAGE axis auto-accepts inbound; the TOOL axis never does", () => {
  for (const mode of ["auto_inbound", "auto_both"]) {
    const s = sessionReducer(running(), { type: "set_message_mode", mode }).state;
    assert.equal(s.messageMode, mode);
    assert.ok(sessionReducer(s, arrive).effects.some((e) => e.type === "pushInbound"), `${mode}: fed without a card`);
  }
  // Back to `ask` re-arms the gate (unless a standing grant was taken).
  const off = sessionReducer(running(), { type: "set_message_mode", mode: "ask" }).state;
  assert.equal(sessionReducer(off, arrive).state.phase, "awaiting_inbound");
  // THE INVARIANT: no tool posture, and not the outbound half either, feeds an inbound turn.
  for (const state of [{ toolMode: "bypass" }, { toolMode: "auto" }, { messageMode: "auto_outbound" }]) {
    assert.equal(sessionReducer({ ...running(), ...state }, arrive).state.phase, "awaiting_inbound",
      `${JSON.stringify(state)} must not open the inbound gate`);
  }
});

// M2 (2026-08-05) — INVERTED. This used to prove FIX #3 + C9: a park disarmed both axes and the
// standing inbound grant, so a peer's reply on a parked session HELD instead of feeding. Samuel's
// contract is that a posture he set holds for the session, so an operator who turned inbound
// auto-accept on before stepping out gets what they asked for when the reply lands. The away
// threat that reset was buying is bought instead by the ABANDONMENT END (session-state.ABANDONED_MS):
// a session nobody comes back to is terminal, and terminal cannot be woken by anyone.
test("M2: a park keeps BOTH axes and the standing grant, so a woken reply feeds as set", () => {
  const armed = { ...running(), toolMode: "bypass", messageMode: "auto_both", inboundForTask: true };
  const parked = sessionReducer(armed, { type: "idle_timeout" }).state;
  assert.equal(parked.toolMode, "bypass", "AXIS A is the operator's for the session");
  assert.equal(parked.messageMode, "auto_both", "and so is AXIS B");
  assert.equal(parked.inboundForTask, true, "and the standing inbound grant");
  const woken = sessionReducer(parked, arrive);
  assert.equal(woken.state.phase, "running", "the reply feeds, as the operator asked");
  assert.equal(woken.state.parked, false);
  assert.equal(effTypes(woken.effects)[0], "resumeQuery");
  // A session the operator never opted in on still HOLDS: M2 preserves intent, it does not add any.
  const plain = sessionReducer(running(), { type: "idle_timeout" }).state;
  assert.equal(sessionReducer(plain, arrive).state.phase, "awaiting_inbound", "no opt-in, no feed");
});

// ── FIX #6: nothing clobbers the gate state while a card is still pending ─────────
//
// result / permission_request / permission_decision / steer / the axis setters all wrote a
// phase without consulting hasPendingInbound, so the pill fell back to "Idle" / "Working" /
// "Waiting for reply" seconds after the card appeared and the operator lost the only signal
// that a message needed answering. The DESIGN: `phase` carries the gate (a pending card
// pins it to awaiting_inbound) and `activity` keeps telling the truth about what the agent
// is doing — so the pill reads "Message waiting" while sendButtonMode can still offer Pause
// on a genuinely mid-flight turn (see session-chrome.test.mjs).

const held = () => sessionReducer(running(), arrive).state;
const statusOf = (effects) => emitted(effects, "status");

test("FIX #6: a turn ENDING does not overwrite the pending gate (phase stays, activity is true)", () => {
  for (const [posted, activity] of [[false, "idle"], [true, "awaiting_peer"]]) {
    const s = { ...held(), postedThisTurn: posted };
    const r = sessionReducer(s, { type: "result", turnCostUsd: 0.01 });
    assert.deepEqual(statusOf(r.effects), { type: "status", phase: "awaiting_inbound", activity: activity });
    assert.equal(r.state.phase, "awaiting_inbound", "the card still owns the pill");
  }
  // With NO card pending the turn-end status is byte-identical to before.
  const clean = sessionReducer(running(), { type: "result", turnCostUsd: 0.01 });
  assert.deepEqual(statusOf(clean.effects), { type: "status", phase: "running", activity: "idle" });
});

test("FIX #6: a permission request / decision does not overwrite the pending gate", () => {
  const req = sessionReducer(held(), { type: "permission_request", requestId: "r1", name: "Bash", payload: {} });
  assert.equal(req.state.phase, "awaiting_inbound", "the dock has its own surface; the pill keeps the gate");
  assert.equal(req.state.activity, "awaiting_permission");
  const dec = sessionReducer(req.state, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: "Bash" });
  assert.equal(dec.state.phase, "awaiting_inbound");
  assert.equal(dec.state.activity, "working", "the agent really is back at work");
  // And with no card pending, both are exactly what they were.
  const plain = sessionReducer(running(), { type: "permission_request", requestId: "r1", name: "Bash", payload: {} });
  assert.equal(plain.state.phase, "awaiting_permission");
});

test("FIX #6: STEERING while a card waits keeps the gate but reports the turn as working", () => {
  const r = sessionReducer(held(), { type: "steer", text: "start on the other thing" });
  assert.equal(r.state.phase, "awaiting_inbound", "typing does not answer the gate");
  assert.equal(r.state.activity, "working");
  assert.deepEqual(statusOf(r.effects), { type: "status", phase: "awaiting_inbound", activity: "working" });
  assert.equal(r.state.hasPendingInbound, true, "the card is still there to answer");
});

test("FIX #6: an outbound post while a card waits keeps the gate phase", () => {
  const r = sessionReducer({ ...held(), activity: "idle" }, {
    type: "outbound_post", payload: { type: "outbound_post", toolUseId: "u1", text: "hi" },
  });
  assert.deepEqual(statusOf(r.effects), { type: "status", phase: "awaiting_inbound", activity: "working" });
});

test("FIX #6: ANSWERING the card releases the phase (the pill goes back to the work state)", () => {
  const accepted = sessionReducer(held(), { type: "inbound_accept", pendingId: "p1", message: "go", authorName: "David" });
  assert.equal(accepted.state.phase, "running");
  assert.deepEqual(statusOf(accepted.effects), { type: "status", phase: "running", activity: "working" });
  const declined = sessionReducer(held(), { type: "inbound_decline", pendingId: "p1" });
  assert.equal(declined.state.phase, "running");
  assert.deepEqual(statusOf(declined.effects), { type: "status", phase: "running", activity: "idle" });
});

// ── FIX #10 / #17: park + toggle on a PARKED session ──────────────────────────────

test("FIX #10 (v2.9): an axis change on a PARKED session does not claim it is running", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "set_message_mode", mode: "auto_both" });
  assert.equal(r.state.messageMode, "auto_both", "the value still lands");
  assert.equal(r.state.phase, "parked", "a query-less session is not running");
  assert.equal(r.state.activity, "parked");
  assert.ok(!r.effects.some((e) => e.type === "resumeQuery"), "and nothing is resumed by a select");
  assert.deepEqual(r.effects.map((e) => e.type), ["emit"]);
  assert.deepEqual(r.effects[0].payload, { type: "modes", tool: "manual", message: "auto_both" });
  // A LIVE session keeps whatever phase it had — an axis change is not a lifecycle event.
  const live = sessionReducer(running(), { type: "set_tool_mode", mode: "auto" });
  assert.equal(live.state.phase, "running");
});

test("v2.9: an axis change NEVER drains the pending permission dock (THE INVARIANT)", () => {
  // The old set_auto_approve(true) resolved every parked request. It cannot survive the
  // split: pendingPermissions holds requestIds only, so a blanket drain would let the TOOL
  // axis answer a queued `op=open direct:true`. Anything already waiting keeps its buttons.
  const live = { ...running(), pendingPermissions: ["r1"] };
  for (const ev of [{ type: "set_tool_mode", mode: "bypass" }, { type: "set_message_mode", mode: "auto_both" }]) {
    const r = sessionReducer(live, ev);
    assert.deepEqual(r.state.pendingPermissions, ["r1"], "the queued request is untouched");
    assert.ok(!r.effects.some((e) => e.type === "resolvePermission"), "and nothing is auto-answered");
  }
});

test("FIX #17: a park that lands on a HELD message says so, and re-parking is idempotent", () => {
  const r = sessionReducer(held(), { type: "idle_timeout" });
  assert.equal(r.state.parked, true);
  assert.equal(r.state.phase, "awaiting_inbound", "the pill keeps saying a message waits");
  assert.deepEqual(emitted(r.effects, "status"), { type: "status", phase: "awaiting_inbound" });
  assert.deepEqual(emitted(r.effects, "paused"), { type: "paused", gated: true }, "the note names the real next step");
  // The guard now reads `parked`, not `phase` — a stale timer on a parked-and-held session
  // used to re-run the WHOLE park (a second denyPending / abort / persist) on it.
  const again = sessionReducer(r.state, { type: "idle_timeout" });
  assert.equal(again.state, r.state, "same object: a no-op");
  assert.deepEqual(again.effects, []);
  // An ordinary park is byte-identical to before (no `gated` key at all).
  const plain = sessionReducer(running(), { type: "idle_timeout" });
  assert.deepEqual(emitted(plain.effects, "paused"), { type: "paused" });
  assert.deepEqual(emitted(plain.effects, "status"), { type: "status", phase: "parked" });
});

// ── the grant never reaches disk ─────────────────────────────────────────────────

test("no gate grant is ever persisted: the durable record carries neither flag", () => {
  const io = require(join(HERE, "..", "main", "session-io.js"));
  const rec = io.baseRecord({
    key: "c1:t1", sessionId: "s1", channelId: "c1", taskId: "t1", workspaceId: "w1",
    side: "responder", profile: "full", mode: "interactive", startedAt: 1,
    state: { ...running(), toolMode: "bypass", messageMode: "auto_both", inboundForTask: true, turns: 2, costUsd: 0.1 },
  });
  assert.equal(rec.toolMode, undefined, "AXIS A is memory-only, never persisted");
  assert.equal(rec.messageMode, undefined, "and so is AXIS B");
  assert.equal(rec.inboundForTask, undefined, "the standing accept grant is memory-only");
  assert.equal(rec.allowForTask, undefined, "so is the tool grant set");
  // A shell recreated from this record therefore re-gates from scratch.
  assert.equal(initialSessionState({ mode: rec.mode }).inboundForTask, false);
});
