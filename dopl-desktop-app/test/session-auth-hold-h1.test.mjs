// H1 (2026-07-31) — THE AUTH HOLD IS A STATE THE REST OF THE ENGINE UNDERSTANDS.
//
// ⚠ ITS OWN FILE SINCE 2026-08-20 (F-226). It was §4 of `session-auth-recovery.test.mjs`, which
// stood at EXACTLY 500 of the cap — so neither of that file's subjects could gain a case, and
// this is the half most likely to need one: it drives the REDUCER end to end, so every new wake
// path has to be held against it. Split on the seam INVARIANTS §1 names (one file per reason to
// change) rather than at the moment a lint failed.
//
// WHAT IT IS ABOUT. Two failure modes shipped together and they COMPOSE, which is why they are
// driven end to end rather than unit-tested apart:
//   (a) the hold lived only as `s.authHold`, so `session-reducer.wakeEffects` saw nothing but
//       `parked` and RESUMED held sessions. A peer follow-up on a channel whose preset seeded
//       auto_both was enough: inbound -> auto-accepted -> wake -> a query spawned on a Mac with
//       no credential, and a later sign-in then started a SECOND query beside it.
//   (b) `holdIfAuthFailure`'s "already held" branch returned "handled" having done nothing, so
//       the session (a) had dragged back to 'running' stayed there forever: no query, no idle
//       timer, nothing to park or settle it, and a peer awaiting a reply that never came.
//
// ⚠ THE HOLD IS THE ONE PARK THAT RESETS BOTH AXES (INVARIANTS §11), and that is asserted here
// rather than assumed: a session that cannot run must not come back wearing the posture it had.
//
// The harness (`_auth-hold-harness.mjs`) is shared with `session-auth-recovery.test.mjs`, so
// the two suites cannot drift into driving different holds.
//
// Run: `node --test dopl-desktop-app/test/session-auth-hold-h1.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  M, harness, session, sessionReducer, initialSessionState, ENGINE, AUTH_SRC,
} from "./_auth-hold-harness.mjs";

// §3 SPLIT: `startQuery` / `consume` live in session-query.js, and the supersede backstop below
// is a structural read of the real one.
const QUERY = readFileSync(M("session-query.js"), "utf8");

test("H1(a) A PEER WAKE CANNOT RESUME A HELD SESSION, even under an auto_both posture", () => {
  const h = harness({ usable: false });
  const s = session();
  // The exact pre-condition the H2 preset used to create: both axes wide open at launch.
  s.state = { ...s.state, messageMode: "auto_both", toolMode: "bypass" };
  assert.equal(h.holdIfNoCredential(s), true);
  assert.deepEqual([s.state.authHeld, s.state.messageMode, s.state.toolMode], [true, "ask", "manual"],
    "a hold disarms both axes on the way in, exactly as a park does");
  // Now the peer's follow-up arrives. It must NOT be auto-accepted and must NOT wake anything.
  const arrived = sessionReducer(s.state, {
    type: "inbound_arrived", pendingId: "p1", message: "any update?", authorName: "David",
  });
  const effects = arrived.effects.map((e) => e.type);
  assert.ok(!effects.includes("resumeQuery"), "NO SDK spawn on a credential-less machine");
  assert.ok(!effects.includes("pushInbound"), "and the turn never reaches an agent that cannot run");
  assert.equal(arrived.state.hasPendingInbound, true, "it is HELD for the operator instead");
  assert.equal(arrived.state.authHeld, true, "and the session is still held");
  // Even a forced auto-accept posture cannot re-open the wake path while held.
  const forced = { ...arrived.state, messageMode: "auto_both", inboundForTask: true };
  const again = sessionReducer(forced, {
    type: "inbound_arrived", pendingId: "p2", message: "still there?", authorName: "David",
  });
  assert.ok(!again.effects.map((e) => e.type).includes("resumeQuery"), "belt: still no spawn");
});

test("H1(a) A RESUME AFTER A WAKE ALREADY RESUMED IT: one query, never two", async () => {
  const h = harness({ usable: false });
  const s = session();
  h.holdIfNoCredential(s);
  // Simulate the pre-fix world reaching this point anyway: something resumed the session, so a
  // query IS live under the hold. The relaunch must SUPERSEDE it, not layer a second one.
  s.abortController = { aborted: false, abort() { this.aborted = true; } };
  s.pushIterator = { closed: false, close() { this.closed = true; } };
  await h.resumeAfterSignIn(s);
  assert.equal(h.calls.startQuery.length, 1, "exactly ONE relaunch, never one per caller");
  assert.equal(s.state.authHeld, false, "released before the relaunch");
});

test("H1(a) TWO CONCURRENT RESUMES: the resume is single-flight", async () => {
  // ⚠ RE-POINTED FROM "DOUBLE SIGN-IN CLICK" (F-228). The clicks were on the in-window button and the
  // race was between two `runSignIn` calls, each spawning its own pty — hence the old "one sign-in
  // flow, not two ptys" assertion. The RACE did not go with the button: whatever notices a credential
  // calls `resumeAfterSignIn`, and defences 1 and 2 (the `authResuming` latch taken before the first
  // await, and the CLAIM of `s.authHold` as the ticket) are what stop two callers producing two
  // claude children. The gate moved to `getSdk`, the only await left in the preflight branch.
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ usable: false, gate });
  const s = session();
  h.holdIfNoCredential(s);
  const a = h.resumeAfterSignIn(s);
  const b = h.resumeAfterSignIn(s);
  release();
  await Promise.all([a, b]);
  assert.equal(h.calls.sdk, 1, "the loser returns before it can even ask for the SDK");
  assert.equal(h.calls.startQuery.length, 1, "and ONE query — this is the two-children bug");
  assert.equal(h.calls.dispatch.filter((e) => e.type === "auth_release").length, 1, "released exactly once");
  assert.equal(s.authHold, null, "the ticket is claimed, so a third caller finds nothing to resume");
  assert.equal(s.authResuming, false, "and the latch is released in a finally, not leaked");
});

test("H1(b) A SECOND AUTH FAILURE CONVERGES TO PARKED — it never leaves a session 'running'", () => {
  const h = harness({ usable: true });
  const s = session({ state: undefined });
  s.state = initialSessionState({ mode: "interactive", side: "responder" });
  s.abortController = { aborted: false, abort() { this.aborted = true; } };
  s.pushIterator = { closed: false, close() { this.closed = true; } };
  assert.equal(h.holdIfAuthFailure(s, "401"), true);
  assert.equal(s.state.authHeld, true);
  // Now force the exact pre-fix state: something dragged the held session back to 'running'
  // with no query behind it (what H1(a)'s wake used to do). The next auth failure MUST park it.
  s.state = { ...s.state, phase: "running", parked: false, activity: "working", authHeld: false };
  const emitted = h.calls.emit.length;
  assert.equal(h.holdIfAuthFailure(s, "401 again"), true, "still reports handled");
  assert.deepEqual([s.state.phase, s.state.parked, s.state.authHeld], ["parked", true, true],
    "and it really is parked now, not 'running' forever");
  assert.equal(s.pushIterator.closed, true, "the prompt stream is closed");
  assert.equal(s.abortController.aborted, true, "the query is torn down");
  assert.ok(h.calls.denyPending.length >= 1, "awaited tool promises fail closed");
  assert.equal(h.calls.emit.length, emitted, "but the status is NOT re-emitted");
});

test("H1(b) the hold is idempotent in the reducer: two holds, one park", () => {
  const held = sessionReducer(initialSessionState(), { type: "auth_hold" });
  assert.ok(held.effects.length > 0, "the first hold parks");
  const again = sessionReducer(held.state, { type: "auth_hold" });
  assert.deepEqual(again.effects, [], "the second is inert — no second banner, no second sweep");
  assert.equal(again.state, held.state, "and the state object is not even rebuilt");
  // Release is idempotent in the same way.
  const rel = sessionReducer(held.state, { type: "auth_release" });
  assert.equal(rel.state.authHeld, false);
  assert.deepEqual(sessionReducer(rel.state, { type: "auth_release" }).effects, []);
});

test("H1 startQuery SUPERSEDES before it assembles — the real backstop for two children", () => {
  // The layered guards above are in session-auth; this one holds whatever the caller does.
  const fn = QUERY.slice(QUERY.indexOf("async function startQuery("), QUERY.indexOf("async function consume("));
  const abortFirst = fn.indexOf("abortInFlight(s);");
  const newController = fn.indexOf("s.abortController = new AbortController();");
  assert.ok(abortFirst !== -1, "startQuery tears down before it builds");
  assert.ok(abortFirst < newController, "and it does so BEFORE overwriting the handles");
  const teardown = QUERY.slice(QUERY.indexOf("function abortInFlight("), QUERY.indexOf("async function startQuery("));
  assert.match(teardown, /s\.abortController\.abort\(\)/, "the previous child is really killed");
  assert.match(teardown, /s\.pushIterator\.close\(\)/, "its prompt stream is closed");
  assert.match(teardown, /s\.query = null;/, "and its consume loop is superseded (s.query !== q)");
});

// ⚠ "H1 an auth-held session refuses an inbound ACCEPT at the gate, keeping the card live" STOOD HERE
// AND IS DELETED (F-228). It sliced `session-gate.decideInbound` and pinned its hold guard's ORDER:
// an ACCEPT on a held session was refused BEFORE `io.shiftInbound(s)`, so the message stayed on the
// queue rather than being consumed into a session with no credential to answer it — while a DECLINE
// still worked, because dropping needs no agent. ⚠ NOT A LOST GUARD: `decideInbound` answered a gate
// CARD in the session window and is deleted with the hold it answered (a windowless session's
// message axis is floored at `auto_inbound`, INVARIANTS §11, so nothing is ever held for a human).
// What it protected — a held session must not have an inbound turn fed into it — did NOT move to the
// gate's remaining code; it lives one layer down in the reducer, and "H1(a) A PEER WAKE CANNOT
// RESUME A HELD SESSION" above drives it end to end against the REAL reducer rather than by reading
// source order — so the property is better covered after this deletion than before it.
