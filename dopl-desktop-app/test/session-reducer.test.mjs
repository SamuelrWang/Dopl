// Tests for the v1.9 Session Window pure state machine (main/session-reducer.js, Track T1).
// SOURCE EXTRACTION: the reducer's BEGIN/END sentinel block contains no electron / SDK / fs
// references, so we slice it from the real source and evaluate it verbatim in a plain Node
// context — the test can never drift from what ships (same idiom as classify /
// tool-profiles / the consent-watcher WATCHER-PURE block). Covers every phase transition
// and its effects, the turn / idle / cost caps, the universal inbound gate + its
// auto-accept bypasses (v2.5 D1; accept / decline live in inbound-gate.test.mjs), the
// allow-for-task short-circuit, terminal idempotency. FIX F3: session-reducer-outbound.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer, REDUCER_SRC } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// §2 SPLIT (H1): the pure block now spans session-effects.js + session-reducer.js;
// test/_reducer-block.mjs slices BOTH sentinel pairs and evaluates them as one program.
const { initialSessionState, sessionReducer, nextIdleMs, turnCapReached, costCapReached,
        DEFAULT_TURN_CAP, DEFAULT_IDLE_MS, DEFAULT_COST_CAP_USD } = loadReducer();

// Convenience: a fresh running state, past `launched`.
const running = (opts) => {
  const s0 = initialSessionState(opts);
  return sessionReducer(s0, { type: "launched", payload: { type: "init" } }).state;
};
const effTypes = (effects) => effects.map((e) => e.type);
const findEff = (effects, type) => effects.find((e) => e.type === type);

// ── initialSessionState ───────────────────────────────────────────────────────

test("initialSessionState defaults: interactive/responder, documented caps, empty sets", () => {
  const s = initialSessionState();
  assert.equal(s.phase, "launching");
  assert.equal(s.mode, "interactive");
  assert.equal(s.side, "responder");
  assert.equal(s.turns, 0);
  assert.equal(s.costUsd, 0);
  assert.equal(s.turnCap, DEFAULT_TURN_CAP);
  assert.equal(s.idleMs, DEFAULT_IDLE_MS);
  assert.equal(s.costCapUsd, DEFAULT_COST_CAP_USD);
  assert.deepEqual(s.pendingPermissions, []);
  assert.deepEqual(s.allowForTask, []);
  // v2.9 THE TWO AXES both start at their MOST RESTRICTIVE value (fail-closed).
  assert.equal(s.toolMode, "manual");
  assert.equal(s.messageMode, "ask");
  assert.equal(s.hasPendingInbound, false);
  // P1: a fresh launch is never parked.
  assert.equal(s.parked, false);
  // Item 3: a launching session starts `working`, nothing posted yet.
  assert.equal(s.activity, "working");
  assert.equal(s.postedThisTurn, false);
});

test("initialSessionState honors mode/side and valid caps, rejects invalid caps", () => {
  const s = initialSessionState({ mode: "autonomous", side: "requester", turnCap: 8, idleMs: 1000, costCapUsd: 2.5 });
  assert.equal(s.mode, "autonomous");
  assert.equal(s.side, "requester");
  assert.equal(s.turnCap, 8);
  assert.equal(s.idleMs, 1000);
  assert.equal(s.costCapUsd, 2.5);
  // Invalid values fall back to defaults (a hand-edited store can never inject NaN).
  const bad = initialSessionState({ turnCap: 0, idleMs: -5, costCapUsd: NaN });
  assert.equal(bad.turnCap, DEFAULT_TURN_CAP);
  assert.equal(bad.idleMs, DEFAULT_IDLE_MS);
  assert.equal(bad.costCapUsd, DEFAULT_COST_CAP_USD);
  // An unknown mode/side normalizes to the safe default.
  const norm = initialSessionState({ mode: "wild", side: "sideways" });
  assert.equal(norm.mode, "interactive");
  assert.equal(norm.side, "responder");
});

// ── launched ──────────────────────────────────────────────────────────────────

test("launched: launching -> running with persist/emit/lifecycle(task_started)/scheduleIdle", () => {
  const s0 = initialSessionState();
  const { state, effects } = sessionReducer(s0, { type: "launched", payload: { type: "init", model: "m" } });
  assert.equal(state.phase, "running");
  assert.deepEqual(effTypes(effects), ["persist", "emit", "lifecycle", "scheduleIdle"]);
  assert.equal(findEff(effects, "persist").phase, "running");
  assert.deepEqual(findEff(effects, "emit").payload, { type: "init", model: "m" });
  assert.equal(findEff(effects, "lifecycle").kind, "task_started");
});

// ── pass-through render events ──────────────────────────────────────────────────

test("assistant/tool_use/tool_result just emit their payload, no state change", () => {
  const s = running();
  for (const type of ["assistant", "tool_use", "tool_result"]) {
    const payload = { type, x: 1 };
    const r = sessionReducer(s, { type, payload });
    assert.equal(r.state, s, "no state change for a pass-through render event");
    assert.deepEqual(effTypes(r.effects), ["emit"]);
    assert.deepEqual(r.effects[0].payload, payload);
  }
});

// ── outbound_post (item 2 — the sent-to-peer lane) ────────────────────────────

test("outbound_post: emits its payload, sets postedThisTurn, stays working (no dup status)", () => {
  const s = running(); // already `working`
  const payload = { type: "outbound_post", toolUseId: "t1", to: "Bob", text: "on it" };
  const r = sessionReducer(s, { type: "outbound_post", payload });
  assert.equal(r.state.postedThisTurn, true, "records the post so turn-end -> awaiting_peer");
  assert.equal(r.state.activity, "working");
  // Already working -> no redundant status emit, just the outbound payload.
  assert.deepEqual(effTypes(r.effects), ["emit"]);
  assert.deepEqual(r.effects[0].payload, payload);
});

test("outbound_post from a non-working activity flips to working AND emits a status", () => {
  const s = { ...running(), activity: "idle" };
  const r = sessionReducer(s, { type: "outbound_post", payload: { type: "outbound_post", to: "Bob", text: "hi" } });
  assert.equal(r.state.activity, "working");
  assert.deepEqual(effTypes(r.effects), ["emit", "emit"]);
  const status = r.effects.find((e) => e.payload.type === "status");
  assert.deepEqual(status.payload, { type: "status", phase: "running", activity: "working" });
});

// ── permissions ─────────────────────────────────────────────────────────────────

test("permission_request (not granted): -> awaiting_permission, tracks requestId, emits", () => {
  const s = running();
  const r = sessionReducer(s, {
    type: "permission_request",
    requestId: "r1",
    name: "Bash",
    payload: { type: "permission_request", requestId: "r1", name: "Bash" },
  });
  assert.equal(r.state.phase, "awaiting_permission");
  assert.equal(r.state.activity, "awaiting_permission"); // item 3
  assert.deepEqual(r.state.pendingPermissions, ["r1"]);
  // FIX 3 (2026-08-02): opening a card RE-ARMS the idle timer. It used to be dispatched from
  // `launched` and `result` only, so the 15-minute TTL measured time since the last turn ENDED
  // — and a card left on screen longer than that parked the session underneath the operator,
  // deny-closing the request they were reading and resetting both axes.
  assert.deepEqual(effTypes(r.effects), ["emit", "scheduleIdle"]);
});

test("permission_request short-circuits when the tool is already allowed for the task", () => {
  const s = { ...running(), allowForTask: ["Bash"] };
  const r = sessionReducer(s, { type: "permission_request", requestId: "r9", name: "Bash", payload: {} });
  // No button: the reducer resolves allow immediately and does NOT change phase.
  assert.equal(r.state.phase, "running");
  assert.deepEqual(r.effects, [{ type: "resolvePermission", requestId: "r9", decision: "allow" },
    { type: "scheduleIdle" }]);
});

test("permission_decision allow-once -> running + resolvePermission(allow) + permission_resolved", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1"] };
  const r = sessionReducer(s, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: "Bash" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.activity, "working"); // last button cleared -> back to the in-flight turn
  assert.deepEqual(r.state.pendingPermissions, []);
  assert.deepEqual(r.state.allowForTask, []);
  const resolve = findEff(r.effects, "resolvePermission");
  assert.deepEqual(resolve, { type: "resolvePermission", requestId: "r1", decision: "allow" });
  const resolved = findEff(r.effects, "emit");
  assert.deepEqual(resolved.payload, { type: "permission_resolved", requestId: "r1", decision: "allow-once" });
});

test("permission_decision allow-task adds the tool to allowForTask; SDK decision is allow", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1"] };
  const r = sessionReducer(s, { type: "permission_decision", requestId: "r1", decision: "allow-task", name: "Write" });
  assert.deepEqual(r.state.allowForTask, ["Write"]);
  assert.equal(findEff(r.effects, "resolvePermission").decision, "allow");
});

test("permission_decision deny -> resolvePermission(deny)", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1"] };
  const r = sessionReducer(s, { type: "permission_decision", requestId: "r1", decision: "deny", name: "Bash" });
  assert.equal(findEff(r.effects, "resolvePermission").decision, "deny");
});

test("FIX M1: an unrecognized decision string FAILS CLOSED — resolves DENY, grants nothing", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1"] };
  for (const bad of ["allow", "yes", "", undefined, "ALLOW-ONCE", "bypass"]) {
    const r = sessionReducer(s, { type: "permission_decision", requestId: "r1", decision: bad, name: "Bash" });
    assert.equal(findEff(r.effects, "resolvePermission").decision, "deny", `decision ${JSON.stringify(bad)} must resolve DENY`);
    assert.deepEqual(r.state.allowForTask, [], "an unrecognized decision never grants for the task");
  }
});

test("permission_decision leaves phase awaiting while other permissions remain pending", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1", "r2"] };
  const r = sessionReducer(s, { type: "permission_decision", requestId: "r1", decision: "allow", name: "Bash" });
  assert.equal(r.state.phase, "awaiting_permission", "still awaiting the second permission");
  assert.deepEqual(r.state.pendingPermissions, ["r2"]);
});

// ── v2.9 set_tool_mode / set_message_mode (the two axes) ─────────────────────────

test("a launched session starts BOTH axes at their most restrictive value (never persisted)", () => {
  for (const s of [running(), running({ mode: "autonomous" })]) {
    assert.equal(s.toolMode, "manual");
    assert.equal(s.messageMode, "ask");
  }
});

test("set_tool_mode / set_message_mode set ONE axis and echo BOTH in a single `modes` event", () => {
  const a = sessionReducer(running(), { type: "set_tool_mode", mode: "auto" });
  assert.equal(a.state.toolMode, "auto");
  assert.equal(a.state.messageMode, "ask", "the other axis is untouched");
  assert.deepEqual(effTypes(a.effects), ["emit"]);
  assert.deepEqual(a.effects[0].payload, { type: "modes", tool: "auto", message: "ask" });

  const b = sessionReducer(a.state, { type: "set_message_mode", mode: "auto_both" });
  assert.equal(b.state.toolMode, "auto", "and stays untouched from the other side too");
  assert.equal(b.state.messageMode, "auto_both");
  assert.deepEqual(b.effects[0].payload, { type: "modes", tool: "auto", message: "auto_both" });
});

test("both setters coerce FAIL-CLOSED: an unknown value lands on the most restrictive member", () => {
  for (const junk of ["bypassPermissions", "AUTO", "", null, undefined, 1, {}, "auto_inbound "]) {
    assert.equal(sessionReducer({ ...running(), toolMode: "bypass" }, { type: "set_tool_mode", mode: junk }).state.toolMode,
      "manual", `tool mode ${String(junk)}`);
    assert.equal(sessionReducer({ ...running(), messageMode: "auto_both" }, { type: "set_message_mode", mode: junk }).state.messageMode,
      "ask", `message mode ${String(junk)}`);
  }
  // ...and an axis event can never set the OTHER axis, whatever it carries.
  const r = sessionReducer(running(), { type: "set_tool_mode", mode: "bypass", messageMode: "auto_both" });
  assert.equal(r.state.messageMode, "ask");
});

test("an axis change NEVER drains the pending dock (a mode governs the NEXT call only)", () => {
  const s = { ...running(), phase: "awaiting_permission", activity: "awaiting_permission", pendingPermissions: ["r1", "r2"] };
  for (const ev of [{ type: "set_tool_mode", mode: "bypass" }, { type: "set_message_mode", mode: "auto_both" }]) {
    const r = sessionReducer(s, ev);
    assert.deepEqual(r.state.pendingPermissions, ["r1", "r2"], "anything waiting keeps its buttons");
    assert.deepEqual(effTypes(r.effects), ["emit"], "the echo, and nothing else");
    assert.ok(!r.effects.some((e) => e.type === "resolvePermission"), "nothing is auto-answered");
    assert.equal(r.state.phase, "awaiting_permission", "and the gate still owns the phase");
  }
});

test("the axis setters are ignored by a settled session (terminal idempotency)", () => {
  const ended = sessionReducer(running(), { type: "end" }).state;
  for (const ev of [{ type: "set_tool_mode", mode: "bypass" }, { type: "set_message_mode", mode: "auto_both" }]) {
    const r = sessionReducer(ended, ev);
    assert.equal(r.state, ended);
    assert.deepEqual(r.effects, []);
  }
});

// ── result / caps ────────────────────────────────────────────────────────────────

test("result: accumulates cost + turns for the caps, reschedules idle, emits NO usage (item 6)", () => {
  const s = running({ turnCap: 5 });
  const r = sessionReducer(s, { type: "result", turnCostUsd: 0.02, model: "m" });
  assert.equal(r.state.turns, 1);
  assert.equal(r.state.costUsd, 0.02, "cost still accumulates internally for the cost cap");
  assert.equal(r.state.phase, "running");
  // The display-only usage emit is GONE; a status emit replaces it.
  assert.deepEqual(effTypes(r.effects), ["emit", "scheduleIdle"]);
  assert.ok(!r.effects.some((e) => e.type === "emit" && e.payload.type === "usage"), "no usage emit in v2");
  assert.deepEqual(findEff(r.effects, "emit").payload, { type: "status", phase: "running", activity: "idle" });
});

test("result WITH a post this turn -> awaiting_peer; WITHOUT -> idle; postedThisTurn resets", () => {
  // A turn that posted to the peer ends `awaiting_peer` (waiting for a reply).
  const posted = sessionReducer(
    { ...running({ turnCap: 9 }), postedThisTurn: true },
    { type: "result", turnCostUsd: 0.01 }
  );
  assert.equal(posted.state.activity, "awaiting_peer");
  assert.equal(posted.state.postedThisTurn, false, "the flag resets at turn end");
  assert.deepEqual(findEff(posted.effects, "emit").payload, {
    type: "status", phase: "running", activity: "awaiting_peer",
  });
  // A turn with no post ends `idle`.
  const idle = sessionReducer(running({ turnCap: 9 }), { type: "result", turnCostUsd: 0.01 });
  assert.equal(idle.state.activity, "idle");
  assert.deepEqual(findEff(idle.effects, "emit").payload, { type: "status", phase: "running", activity: "idle" });
});

test("result at the turn cap ends the session (turn_cap) + P3 calm capped lifecycle", () => {
  const s = { ...running({ turnCap: 2 }), turns: 1 };
  const r = sessionReducer(s, { type: "result", turnCostUsd: 0.01 });
  assert.equal(r.state.turns, 2);
  assert.equal(r.state.phase, "ended");
  // P3: a real cap end now posts a calm lifecycle BEFORE settling. No usage emit (item 6).
  assert.deepEqual(effTypes(r.effects), ["abortQuery", "lifecycle", "emit", "settle"]);
  assert.ok(!r.effects.some((e) => e.type === "emit" && e.payload.type === "usage"), "no usage emit at the cap");
  const lc = findEff(r.effects, "lifecycle");
  assert.equal(lc.kind, "task_failed");
  assert.deepEqual(lc.extra, { capped: true }, "turn cap rides extra:{capped:true}");
  // ⚠ AND IT NAMES THE NUMBER (2026-09-05, task 9(c)). The cap is read off the ENDED RECORD —
  // `state.turnCap`, the cap this session really counted against — never re-derived from
  // `settings.getTurnCap()`, which since task 9(a) answers a default that depends on WHO
  // launched and would name the wrong tier on the one card that exists to explain the end.
  assert.equal(lc.body, "Turn limit reached (2 turns)");
  const ended = r.effects.filter((e) => e.type === "emit").find((e) => e.payload.type === "ended");
  assert.equal(ended.payload.reason, "turn_cap");
  assert.equal(findEff(r.effects, "settle").outcome, "ended");
});

test("result crossing the cost cap ends (cost_cap) + P3 calm capped lifecycle", () => {
  const s = running({ turnCap: 99, costCapUsd: 0.05 });
  const r = sessionReducer(s, { type: "result", turnCostUsd: 0.06 });
  assert.equal(r.state.phase, "ended");
  assert.deepEqual(effTypes(r.effects), ["abortQuery", "lifecycle", "emit", "settle"]);
  const lc = findEff(r.effects, "lifecycle");
  assert.deepEqual(lc.extra, { capped: true });
  assert.equal(lc.body, "Cost limit reached");
  const ended = r.effects.find((e) => e.type === "emit" && e.payload.type === "ended");
  assert.equal(ended.payload.reason, "cost_cap");
});

test("cost cap of 0 is disabled — a large turn cost does not end the session", () => {
  const s = running({ costCapUsd: 0 });
  const r = sessionReducer(s, { type: "result", turnCostUsd: 999 });
  assert.equal(r.state.phase, "running");
});

// ── inbound: the universal gate + its two auto-accept bypasses (v2.5 D1/D4) ──────

test("inbound_arrived with AXIS B auto-accepting: feeds the reply (counterparty + pushInbound)", () => {
  // v2.5 D1: the opt-in decides, not `autonomous`; the fed effects stay byte-equivalent.
  const s = { ...running({ mode: "autonomous" }), messageMode: "auto_inbound" };
  const r = sessionReducer(s, { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.activity, "working");
  // FIX 3: ...plus the idle re-arm, because a turn was just pushed.
  assert.deepEqual(effTypes(r.effects), ["emit", "pushInbound", "scheduleIdle"]);
  assert.deepEqual(findEff(r.effects, "emit").payload, { type: "counterparty", from: "Bob", text: "hi" });
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "hi", authorName: "Bob", addressing: null });
});

test("inbound_arrived under the STANDING task grant from awaiting_peer clears back to working", () => {
  const s = { ...running({ mode: "autonomous" }), inboundForTask: true, activity: "awaiting_peer" };
  const r = sessionReducer(s, { type: "inbound_arrived", message: "reply", authorName: "Bob" });
  assert.equal(r.state.activity, "working");
  assert.deepEqual(effTypes(r.effects), ["emit", "pushInbound", "emit", "scheduleIdle"]);
  const status = r.effects.filter((e) => e.type === "emit").find((e) => e.payload.type === "status");
  assert.deepEqual(status.payload, { type: "status", phase: "running", activity: "working" });
});

test("inbound_arrived with no opt-in: HOLDS the reply at the gate (every mode)", () => {
  const s = running({ mode: "interactive" });
  const r = sessionReducer(s, { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  assert.equal(r.state.phase, "awaiting_inbound");
  assert.equal(r.state.activity, "awaiting_inbound"); // item 3: rides the phase
  assert.equal(r.state.hasPendingInbound, true);
  // FIX #1: the card AND a status (the pill only ever moves on a `status`).
  assert.deepEqual(effTypes(r.effects), ["emit", "emit"]);
  assert.deepEqual(r.effects[0].payload, { type: "inbound_pending", pendingId: "p1", from: "Bob", text: "hi" });
  assert.deepEqual(r.effects[1].payload, { type: "status", phase: "awaiting_inbound", activity: "awaiting_inbound" });
});

test("inbound_released: -> running, pushes the framed reply, clears the pending flag", () => {
  const s = { ...running({ mode: "interactive" }), phase: "awaiting_inbound", hasPendingInbound: true };
  const r = sessionReducer(s, { type: "inbound_released", message: "go", authorName: "Bob" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.hasPendingInbound, false);
  assert.deepEqual(effTypes(r.effects), ["pushInbound", "emit", "scheduleIdle"]); // FIX 3
});

// ── steer / interrupt ───────────────────────────────────────────────────────────

test("steer priority 'now' interrupts first, then pushes; default just pushes next", () => {
  const s = running();
  const now = sessionReducer(s, { type: "steer", text: "stop", priority: "now" });
  // FIX 3: a steer is the operator being present, so it restarts the idle TTL too.
  assert.deepEqual(effTypes(now.effects), ["interruptQuery", "pushTurn", "scheduleIdle"]);
  assert.equal(findEff(now.effects, "pushTurn").priority, "now");
  const next = sessionReducer(s, { type: "steer", text: "later" });
  assert.deepEqual(effTypes(next.effects), ["pushTurn", "scheduleIdle"]);
  assert.equal(findEff(next.effects, "pushTurn").priority, "next");
});

test("steer / inbound_released from a waiting activity clear back to working (item 3)", () => {
  // Steering while awaiting a peer reply re-activates the turn + emits a status.
  const steered = sessionReducer({ ...running(), activity: "awaiting_peer" }, { type: "steer", text: "nudge" });
  assert.equal(steered.state.activity, "working");
  assert.deepEqual(effTypes(steered.effects), ["pushTurn", "emit", "scheduleIdle"]);
  assert.deepEqual(steered.effects[1].payload, { type: "status", phase: "running", activity: "working" });
  // inbound_released always returns to working with a status carrying the activity.
  const released = sessionReducer(
    { ...running({ mode: "interactive" }), phase: "awaiting_inbound", activity: "awaiting_inbound", hasPendingInbound: true },
    { type: "inbound_released", message: "go", authorName: "Bob" }
  );
  assert.equal(released.state.activity, "working");
  assert.deepEqual(findEff(released.effects, "emit").payload, { type: "status", phase: "running", activity: "working" });
});

test("interrupt (Stop): -> interrupted, interruptQuery + status emit", () => {
  const s = running();
  const r = sessionReducer(s, { type: "interrupt" });
  assert.equal(r.state.phase, "interrupted");
  assert.deepEqual(effTypes(r.effects), ["interruptQuery", "emit"]);
  assert.deepEqual(findEff(r.effects, "emit").payload, { type: "status", phase: "interrupted" });
});

// ── ends ───────────────────────────────────────────────────────────────────────

test("end (operator End): -> ended + a NON-TERMINAL session_ended signal, task stays open", () => {
  const s = running();
  const r = sessionReducer(s, { type: "end" });
  assert.equal(r.state.phase, "ended");
  // P3: the operator End posts a lifecycle BEFORE settle.
  assert.deepEqual(effTypes(r.effects), ["abortQuery", "lifecycle", "emit", "settle"]);
  const lc = findEff(r.effects, "lifecycle");
  // P1-7 (decision 3, 2026-08-04): it used to be `task_failed` + { ended: true }.
  // The flag kept the CHIP calm, but the KIND is terminal — group-thread folds a
  // task_failed into `endEvent` and reads it as the exchange's OUTCOME — so one
  // member parking their own window painted the SHARED thread as failed on the
  // peer's card. `task_progress` cannot become an outcome at all, which is the
  // property being pinned here rather than the string.
  assert.equal(lc.kind, "task_progress");
  assert.deepEqual(lc.extra, { session_ended: true });
  assert.equal(lc.body, "Session ended");
  assert.ok(!["task_failed", "task_finished"].includes(lc.kind), "never a terminal kind");
  const ended = r.effects.find((e) => e.type === "emit" && e.payload.type === "ended");
  assert.equal(ended.payload.reason, "operator");
  assert.equal(findEff(r.effects, "settle").outcome, "ended");
});

// ⚠ TWO `close_task` CASES ENDED HERE (wiring plan Phase 4, 2026-08-18). They pinned the
// operator's Close in the session window: a `closeTask` effect flipping `channel_tasks.status`,
// then abort, a task_finished/task_failed lifecycle echo, an `ended` emit carrying the summary,
// and a settle on the chosen outcome. Threads do not close, so the branch is deleted.
//
// What replaces them is the pin that it stays deleted, driven through the reducer rather than
// asserted about the source: an UNKNOWN event is inert here, so a resurrected renderer sending
// `close_task` changes nothing and settles nothing rather than half-ending a live session.
test("close_task is no longer an event: it changes nothing and emits nothing", () => {
  const s = running();
  const r = sessionReducer(s, { type: "close_task", outcome: "completed", summary: "done" });
  assert.equal(r.state.phase, "running", "the session is untouched");
  assert.deepEqual(r.effects, [], "no closeTask, no lifecycle, no settle");
});

test("cost_cap event ends the session directly (reason cost_cap) + capped lifecycle", () => {
  const s = running();
  const r = sessionReducer(s, { type: "cost_cap" });
  assert.equal(r.state.phase, "ended");
  assert.deepEqual(findEff(r.effects, "lifecycle").extra, { capped: true });
  const ended = r.effects.find((e) => e.type === "emit" && e.payload.type === "ended");
  assert.equal(ended.payload.reason, "cost_cap");
});

// NOTE: P1 idle-park + lazy-resume reducer transitions live in the sibling
// test/session-reducer-park.test.mjs (split to respect the 500-line §2 cap).
test("crash: abortQuery FIRST, then settle(interrupted) + lifecycle + error emit", () => {
  const s = running();
  const r = sessionReducer(s, { type: "crash" });
  assert.equal(r.state.phase, "ended");
  // C3 (CRITICAL), RE-PINNED DELIBERATELY: the old list started at "settle", which pinned the
  // bug — a crash settled the session while its SDK query was still live, orphaning a process
  // that could keep posting behind a window that already said "ended". Every other terminal
  // path aborts first; this one does now too.
  assert.deepEqual(effTypes(r.effects), ["abortQuery", "settle", "lifecycle", "emit"]);
  assert.equal(findEff(r.effects, "settle").outcome, "interrupted");
  const lc = findEff(r.effects, "lifecycle");
  assert.equal(lc.kind, "task_failed");
  assert.deepEqual(lc.extra, { interrupted: true });
  assert.equal(findEff(r.effects, "emit").payload.type, "error");
});

// ── terminal idempotency ─────────────────────────────────────────────────────────

test("a settled (ended) session ignores every later event — no re-emit, no re-post", () => {
  const ended = sessionReducer(running(), { type: "end" }).state;
  for (const ev of [
    { type: "result", turnCostUsd: 1 },
    { type: "crash" },
    { type: "end" },
    { type: "close_task", outcome: "completed" },
    { type: "interrupt" },
  ]) {
    const r = sessionReducer(ended, ev);
    assert.equal(r.state, ended, "ended state is returned unchanged");
    assert.deepEqual(r.effects, [], "no effects fire from a terminal state");
  }
});

// ── pure helpers ─────────────────────────────────────────────────────────────────

test("nextIdleMs returns the state's idleMs; cap predicates read turns/cost", () => {
  const s = initialSessionState({ idleMs: 12345, turnCap: 3, costCapUsd: 1 });
  assert.equal(nextIdleMs(s), 12345);
  assert.equal(turnCapReached({ ...s, turns: 2 }), false);
  assert.equal(turnCapReached({ ...s, turns: 3 }), true);
  assert.equal(costCapReached({ ...s, costUsd: 0.5 }), false);
  assert.equal(costCapReached({ ...s, costUsd: 1 }), true);
  assert.equal(costCapReached({ ...s, costCapUsd: 0, costUsd: 999 }), false, "cost cap 0 is disabled");
});
