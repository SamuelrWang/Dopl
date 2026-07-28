// Tests for the v1.9 Session Window pure state machine (main/session-reducer.js,
// Track T1). SOURCE EXTRACTION: the reducer's BEGIN/END sentinel block contains no
// electron / SDK / fs references, so we slice it from the real source and evaluate
// it verbatim in a plain Node context — the test can never drift from what ships
// (same idiom as classify / tool-profiles / the consent-watcher WATCHER-PURE block).
//
// What matters: every phase transition and its effects; the turn / idle / cost caps;
// the interactive-vs-autonomous inbound split; the allow-for-task permission
// short-circuit; and terminal idempotency (a settled session ignores later events).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-reducer.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-REDUCER";
const END = "// ─── END SESSION-REDUCER";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-REDUCER sentinel missing");
assert.notEqual(to, -1, "END SESSION-REDUCER sentinel missing");
assert.ok(to > from, "session-reducer sentinels out of order");
const BLOCK = SRC.slice(from, to);

const {
  initialSessionState,
  sessionReducer,
  nextIdleMs,
  turnCapReached,
  costCapReached,
  DEFAULT_TURN_CAP,
  DEFAULT_IDLE_MS,
  DEFAULT_COST_CAP_USD,
} = new Function(
  `${BLOCK}
   return { initialSessionState, sessionReducer, nextIdleMs, turnCapReached,
            costCapReached, DEFAULT_TURN_CAP, DEFAULT_IDLE_MS, DEFAULT_COST_CAP_USD };`
)();

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
  assert.equal(s.hasPendingInbound, false);
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
  assert.deepEqual(r.state.pendingPermissions, ["r1"]);
  assert.deepEqual(effTypes(r.effects), ["emit"]);
});

test("permission_request short-circuits when the tool is already allowed for the task", () => {
  const s = { ...running(), allowForTask: ["Bash"] };
  const r = sessionReducer(s, { type: "permission_request", requestId: "r9", name: "Bash", payload: {} });
  // No button: the reducer resolves allow immediately and does NOT change phase.
  assert.equal(r.state.phase, "running");
  assert.deepEqual(r.effects, [{ type: "resolvePermission", requestId: "r9", decision: "allow" }]);
});

test("permission_decision allow-once -> running + resolvePermission(allow) + permission_resolved", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1"] };
  const r = sessionReducer(s, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: "Bash" });
  assert.equal(r.state.phase, "running");
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

// ── result / caps ────────────────────────────────────────────────────────────────

test("result: accumulates cost + turns, emits usage, reschedules idle below caps", () => {
  const s = running({ turnCap: 5 });
  const r = sessionReducer(s, { type: "result", turnCostUsd: 0.02, model: "m" });
  assert.equal(r.state.turns, 1);
  assert.equal(r.state.costUsd, 0.02);
  assert.equal(r.state.phase, "running");
  assert.deepEqual(effTypes(r.effects), ["emit", "scheduleIdle"]);
  assert.deepEqual(findEff(r.effects, "emit").payload, {
    type: "usage", turnCostUsd: 0.02, totalCostUsd: 0.02, turns: 1, model: "m",
  });
});

test("result at the turn cap ends the session (reason turn_cap) with the end effect triple", () => {
  const s = { ...running({ turnCap: 2 }), turns: 1 };
  const r = sessionReducer(s, { type: "result", turnCostUsd: 0.01 });
  assert.equal(r.state.turns, 2);
  assert.equal(r.state.phase, "ended");
  assert.deepEqual(effTypes(r.effects), ["emit", "abortQuery", "emit", "settle"]);
  const ended = r.effects.filter((e) => e.type === "emit").find((e) => e.payload.type === "ended");
  assert.equal(ended.payload.reason, "turn_cap");
  assert.equal(findEff(r.effects, "settle").outcome, "ended");
});

test("result crossing the cost cap ends the session (reason cost_cap)", () => {
  const s = running({ turnCap: 99, costCapUsd: 0.05 });
  const r = sessionReducer(s, { type: "result", turnCostUsd: 0.06 });
  assert.equal(r.state.phase, "ended");
  const ended = r.effects.find((e) => e.type === "emit" && e.payload.type === "ended");
  assert.equal(ended.payload.reason, "cost_cap");
});

test("cost cap of 0 is disabled — a large turn cost does not end the session", () => {
  const s = running({ costCapUsd: 0 });
  const r = sessionReducer(s, { type: "result", turnCostUsd: 999 });
  assert.equal(r.state.phase, "running");
});

// ── inbound (interactive vs autonomous) ─────────────────────────────────────────

test("inbound_arrived autonomous: shows the reply and pushes it as the next turn", () => {
  const s = running({ mode: "autonomous" });
  const r = sessionReducer(s, { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  assert.equal(r.state.phase, "running");
  assert.deepEqual(effTypes(r.effects), ["emit", "pushInbound"]);
  assert.deepEqual(findEff(r.effects, "emit").payload, { type: "inbound", from: "Bob", text: "hi" });
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "hi", authorName: "Bob" });
});

test("inbound_arrived interactive: holds the reply as a pending inbound for release", () => {
  const s = running({ mode: "interactive" });
  const r = sessionReducer(s, { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  assert.equal(r.state.phase, "awaiting_inbound");
  assert.equal(r.state.hasPendingInbound, true);
  assert.deepEqual(effTypes(r.effects), ["emit"]);
  assert.deepEqual(findEff(r.effects, "emit").payload, {
    type: "inbound_pending", pendingId: "p1", from: "Bob", text: "hi",
  });
});

test("inbound_released: -> running, pushes the framed reply, clears the pending flag", () => {
  const s = { ...running({ mode: "interactive" }), phase: "awaiting_inbound", hasPendingInbound: true };
  const r = sessionReducer(s, { type: "inbound_released", message: "go", authorName: "Bob" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.hasPendingInbound, false);
  assert.deepEqual(effTypes(r.effects), ["pushInbound", "emit"]);
});

// ── steer / interrupt ───────────────────────────────────────────────────────────

test("steer priority 'now' interrupts first, then pushes; default just pushes next", () => {
  const s = running();
  const now = sessionReducer(s, { type: "steer", text: "stop", priority: "now" });
  assert.deepEqual(effTypes(now.effects), ["interruptQuery", "pushTurn"]);
  assert.equal(findEff(now.effects, "pushTurn").priority, "now");
  const next = sessionReducer(s, { type: "steer", text: "later" });
  assert.deepEqual(effTypes(next.effects), ["pushTurn"]);
  assert.equal(findEff(next.effects, "pushTurn").priority, "next");
});

test("interrupt (Stop): -> interrupted, interruptQuery + status emit", () => {
  const s = running();
  const r = sessionReducer(s, { type: "interrupt" });
  assert.equal(r.state.phase, "interrupted");
  assert.deepEqual(effTypes(r.effects), ["interruptQuery", "emit"]);
  assert.deepEqual(findEff(r.effects, "emit").payload, { type: "status", phase: "interrupted" });
});

// ── ends ───────────────────────────────────────────────────────────────────────

test("end (operator End): -> ended with abortQuery/ended-emit/settle, task stays open", () => {
  const s = running();
  const r = sessionReducer(s, { type: "end" });
  assert.equal(r.state.phase, "ended");
  assert.deepEqual(effTypes(r.effects), ["abortQuery", "emit", "settle"]);
  assert.equal(findEff(r.effects, "emit").payload.reason, "operator");
  assert.equal(findEff(r.effects, "settle").outcome, "ended");
});

test("close_task completed: closeTask + abort + lifecycle(task_finished) + ended + settle(completed)", () => {
  const s = running();
  const r = sessionReducer(s, { type: "close_task", outcome: "completed", summary: "done" });
  assert.equal(r.state.phase, "ended");
  assert.deepEqual(effTypes(r.effects), ["closeTask", "abortQuery", "lifecycle", "emit", "settle"]);
  assert.equal(findEff(r.effects, "lifecycle").kind, "task_finished");
  assert.deepEqual(findEff(r.effects, "closeTask"), { type: "closeTask", outcome: "completed", summary: "done" });
  const ended = findEff(r.effects, "emit");
  assert.equal(ended.payload.reason, "close_task");
  assert.equal(ended.payload.summary, "done");
  assert.equal(findEff(r.effects, "settle").outcome, "completed");
});

test("close_task failed maps to lifecycle(task_failed) + settle(failed)", () => {
  const s = running();
  const r = sessionReducer(s, { type: "close_task", outcome: "failed", summary: "nope" });
  assert.equal(findEff(r.effects, "lifecycle").kind, "task_failed");
  assert.equal(findEff(r.effects, "settle").outcome, "failed");
});

test("idle_timeout ends the session (reason idle, outcome idle) — task stays open", () => {
  const s = running();
  const r = sessionReducer(s, { type: "idle_timeout" });
  assert.equal(r.state.phase, "ended");
  const ended = r.effects.find((e) => e.type === "emit" && e.payload.type === "ended");
  assert.equal(ended.payload.reason, "idle");
  assert.equal(ended.payload.outcome, "idle");
});

test("cost_cap event ends the session directly (reason cost_cap)", () => {
  const s = running();
  const r = sessionReducer(s, { type: "cost_cap" });
  assert.equal(r.state.phase, "ended");
  const ended = r.effects.find((e) => e.type === "emit" && e.payload.type === "ended");
  assert.equal(ended.payload.reason, "cost_cap");
});

test("crash: settle(interrupted) + lifecycle(task_failed interrupted:true) + error emit", () => {
  const s = running();
  const r = sessionReducer(s, { type: "crash" });
  assert.equal(r.state.phase, "ended");
  assert.deepEqual(effTypes(r.effects), ["settle", "lifecycle", "emit"]);
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
