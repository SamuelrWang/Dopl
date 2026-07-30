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

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-reducer.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-REDUCER");
const to = SRC.indexOf("// ─── END SESSION-REDUCER");
assert.ok(from !== -1 && to > from, "session-reducer sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

const { initialSessionState, sessionReducer } = new Function(
  `${BLOCK}\n return { initialSessionState, sessionReducer };`
)();

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
  assert.equal(s.autoApprove, false);
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
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "can you ship it?", authorName: "David" });
  assert.deepEqual(emitted(r.effects, "inbound_resolved"), { type: "inbound_resolved", pendingId: "p1", decision: "accepted" });
});

test("ACCEPT FOR THIS TASK: feeds it AND arms the standing grant", () => {
  const held = sessionReducer(running(), arrive).state;
  const r = sessionReducer(held, { type: "inbound_accept_for_task", pendingId: "p1", message: "go", authorName: "David" });
  assert.equal(r.state.inboundForTask, true);
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "go", authorName: "David" });
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
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "go", authorName: "David" });
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
  // No server write of ANY kind — a decline is not an echo, a close, or a lifecycle event.
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

// ── the standing grant vs. the auto-approve toggle (D4) ──────────────────────────

test("D4: the auto-approve toggle also auto-accepts inbound (one switch, three surfaces)", () => {
  const s = sessionReducer(running(), { type: "set_auto_approve", enabled: true }).state;
  assert.equal(s.autoApprove, true);
  const r = sessionReducer(s, arrive);
  assert.ok(r.effects.some((e) => e.type === "pushInbound"), "fed without a card");
  // Turning it back OFF re-arms the gate (unless a standing grant was taken).
  const off = sessionReducer(r.state, { type: "set_auto_approve", enabled: false }).state;
  assert.equal(sessionReducer(off, arrive).state.phase, "awaiting_inbound");
});

test("D4/FIX #3: a park disarms the TOGGLE but keeps the standing task grant", () => {
  const armed = { ...running(), autoApprove: true, inboundForTask: true };
  const parked = sessionReducer(armed, { type: "idle_timeout" }).state;
  assert.equal(parked.autoApprove, false, "the toggle never survives a park (v2.3 FIX #3)");
  assert.equal(parked.inboundForTask, true, "an explicit task grant lives for the session object");
});

// ── FIX #6: nothing clobbers the gate state while a card is still pending ─────────
//
// result / permission_request / permission_decision / steer / set_auto_approve all wrote a
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

test("FIX #10: set_auto_approve on a PARKED session does not claim it is running", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "set_auto_approve", enabled: true });
  assert.equal(r.state.autoApprove, true, "the flag still flips");
  assert.equal(r.state.phase, "parked", "a query-less session is not running");
  assert.equal(r.state.activity, "parked");
  assert.ok(!r.effects.some((e) => e.type === "resumeQuery"), "and nothing is resumed by a toggle");
  assert.deepEqual(r.effects.map((e) => e.type), ["emit"]);
  assert.deepEqual(r.effects[0].payload, { type: "auto_approve", enabled: true });
  // A LIVE session is unchanged: still running/working.
  const live = sessionReducer(running(), { type: "set_auto_approve", enabled: true });
  assert.equal(live.state.phase, "running");
  assert.equal(live.state.activity, "working");
});

test("FIX #10: a parked toggle still drains the pending permission dock (fail-closed unchanged)", () => {
  const parked = { ...sessionReducer(running(), { type: "idle_timeout" }).state, pendingPermissions: ["r1"] };
  const r = sessionReducer(parked, { type: "set_auto_approve", enabled: true });
  assert.deepEqual(r.state.pendingPermissions, []);
  assert.ok(r.effects.some((e) => e.type === "resolvePermission" && e.decision === "allow"));
  assert.equal(r.state.phase, "parked");
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
    state: { ...running(), autoApprove: true, inboundForTask: true, turns: 2, costUsd: 0.1 },
  });
  assert.equal(rec.autoApprove, undefined, "the toggle is memory-only");
  assert.equal(rec.inboundForTask, undefined, "the standing accept grant is memory-only");
  assert.equal(rec.allowForTask, undefined, "so is the tool grant set");
  // A shell recreated from this record therefore re-gates from scratch.
  assert.equal(initialSessionState({ mode: rec.mode }).inboundForTask, false);
});
