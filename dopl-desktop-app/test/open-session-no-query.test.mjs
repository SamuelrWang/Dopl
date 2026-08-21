// A5 (contract v3.0) — NOTHING BUT A WAKE TRIGGER STARTS A PARKED SESSION'S QUERY.
//
// WHAT THIS FILE WAS. "Open session" opens this member's own view on a shared THREAD and starts
// NOTHING, pinned end to end: the reopen bridge (a live window shown, never driven), the
// parked-shell recreate it fell back to, the engine's early return in front of `startQuery`, and
// then the REDUCER's wake rules — the only things that may actually start work.
//
// ⚠ THE FIRST THREE LAYERS ARE DELETED — 2026-08-20, F-228, and they were all one mechanism.
// `session-reopen.reopenByTask` no longer shows a window (no session has one) and no longer
// falls back to `session-park.recreateParkedShell` (deleted, with `emitParkedShell` and the
// `renderer/session/**` tree it painted into); `session-engine.startSession` no longer carries
// `if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }`, because nothing
// produces a parked shell to return early for. A live session's VIEW is `main/agent-window.js`,
// which reads the narration ring and mints no session.
//
// ⚠ THE FOURTH LAYER IS THE WHOLE POINT AND IT IS UNCHANGED. The wake rules are what make an
// opened view SAFE — a surface that started a query would silently spend tokens and run gated
// tools for a thread the operator only wanted to LOOK at, on a machine they may have walked away
// from. That argument did not depend on the window; it depends on the REDUCER refusing to
// produce `resumeQuery` for anything but a steer or an ACCEPTED inbound, and on `resumeQuery`
// being the one effect that reaches `session-park.resumeParked`. Both are live, so all five
// rules below still run (INVARIANTS §14).
//
// Same source-extraction idiom as session-reducer's own suite: the three PURE blocks are sliced
// from the shipping files and evaluated together, so this pins the real code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "..", "main", name), "utf8");

function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

// §2 SPLITS: the effect builders moved to session-effects.js and the state shape to
// session-state.js; the reducer block calls both as free vars, so the three slices must be
// evaluated together (effects and state FIRST).
// ⚠ THE `SESSION-REOPEN-PURE` AND `SESSION-PARK-PURE` SLICES WENT WITH THE THREE DELETED LAYERS
// above — this file no longer reads either file, nor session-engine.js.
const REDUCER = [
  slice(read("session-effects.js"), "SESSION-EFFECTS"),
  slice(read("session-state.js"), "SESSION-STATE"),
  slice(read("session-reducer.js"), "SESSION-REDUCER"),
].join("\n");

// ⚠ THE REOPEN-BRIDGE PAIR STOOD HERE. "Open session on a LIVE session ONLY shows the window
// (no query, no turn, no dispatch)" built a session object whose `query` / `pushIterator` /
// `firstTurn` getters THREW, so touching the SDK was a test failure rather than a review
// question; and "with no live session recreates a PARKED shell, never a running one" pinned that
// the only fallback was the shell builder, marked `fromChannel: true` so the inbound gate could
// never reach it. Neither branch exists: `reopenByTask` answers a live session with
// `deps.openAgentWindow(...)` and everything else with `{ok:false, reason:'no-session'}`.
// The throwing-getter idiom is worth keeping in mind for whatever pins the agent window.

// ⚠ THE RECREATE PAIR STOOD HERE. "recreateParkedShell asks for parkedShell:true with NO first
// turn of any kind" (no rawFirstTurn, no firstMessage, no query, no consumer, no dispatch) and
// "the shell paints init + a calm note + the Paused pill, and emits nothing else". Both are
// properties of a window that does not exist; `emitParkedShell` synthesized the `init` a dormant
// window needed precisely because no SDK `system/init` was ever coming.

// ⚠ THE ENGINE'S EARLY-RETURN TEST STOOD HERE — a source read of
// `if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }` proving `startQuery` was
// only reachable after it. The line is gone with `emitParkedShell`. What survives of the flag —
// a `parkedShell` spec still boots DORMANT and still rehydrates its cap budget — is pinned
// behaviourally against the shipping preamble in test/main-audit-resume-budget.test.mjs, which
// is the stronger form of the same guard.

// ── the wake triggers: ONLY a steer or an ACCEPTED inbound resumes ────────────────

const { initialSessionState, sessionReducer } = new Function(
  `${REDUCER}\n return { initialSessionState, sessionReducer };`
)();

// The state a parked session is in: parked, nothing running (session-engine stamps exactly
// these three fields on a parkedShell spec, and `endEffects`' park path lands on the same set).
const parked = () => ({ ...initialSessionState(), phase: "parked", parked: true, activity: "parked" });
const effTypes = (r) => r.effects.map((e) => e.type);

test("A5: a STEER (the operator typed) is a wake trigger", () => {
  const r = sessionReducer(parked(), { type: "steer", text: "carry on" });
  assert.ok(effTypes(r).includes("resumeQuery"), "typing is what starts the agent, not opening");
  assert.equal(r.state.parked, false);
  assert.deepEqual(effTypes(r).slice(0, 2), ["resumeQuery", "pushTurn"], "wake FIRST, then the turn");
});

test("A5: an ACCEPTED inbound is the other wake trigger (all three accept spellings)", () => {
  for (const type of ["inbound_accept", "inbound_accept_for_task", "inbound_released"]) {
    const r = sessionReducer(parked(), { type, pendingId: "p1", message: "hi", authorName: "David" });
    assert.ok(effTypes(r).includes("resumeQuery"), `${type} wakes the shell`);
    assert.equal(r.state.parked, false, type);
  }
});

test("A5: an inbound that only ARRIVES is HELD — the shell stays parked, no query", () => {
  const r = sessionReducer(parked(), { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "David" });
  assert.ok(!effTypes(r).includes("resumeQuery"), "a message waiting is not an operator decision");
  assert.ok(!effTypes(r).includes("pushInbound"), "and it never reaches the agent");
  assert.equal(r.state.parked, true, "still parked, now showing a card");
  assert.equal(r.state.hasPendingInbound, true);
});

test("A5: a DECLINE is not a wake trigger either", () => {
  const held = sessionReducer(parked(), { type: "inbound_arrived", pendingId: "p1", message: "hi" }).state;
  const r = sessionReducer(held, { type: "inbound_decline", pendingId: "p1" });
  assert.ok(!effTypes(r).includes("resumeQuery"));
  assert.equal(r.state.parked, true);
  assert.equal(r.state.phase, "parked");
});

test("A5: the SDK tail of the torn-down query cannot wake an opened shell", () => {
  // FIX #5: a late assistant/tool/result from the query that was aborted at park must be
  // inert. Otherwise opening a view plus one straggler message would look like a resume.
  for (const type of ["assistant", "tool_use", "tool_result", "result", "permission_request", "outbound_post"]) {
    const r = sessionReducer(parked(), { type, text: "x", requestId: "r1" });
    assert.deepEqual(r.effects, [], `${type} must produce no effects on a parked shell`);
    assert.equal(r.state.parked, true, type);
  }
});
