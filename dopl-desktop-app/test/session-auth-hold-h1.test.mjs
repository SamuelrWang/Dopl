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
  // Now the peer's follow-up arrives. The gate refuses it (`session-gate.js › feedInbound`); if one
  // reached the reducer anyway it must neither wake nor feed nor claim the session (the belt).
  const arrived = sessionReducer(s.state, { type: "inbound_arrived", message: "any update?", authorName: "David" });
  assert.deepEqual(arrived.effects, [], "NO SDK spawn and no turn for an agent that cannot run");
  assert.equal(arrived.state, s.state, "and the session is untouched, still held");
  // Even a forced wide posture cannot re-open the wake path while held.
  const again = sessionReducer({ ...s.state, messageMode: "auto_both" }, { type: "inbound_arrived", message: "still there?", authorName: "David" });
  assert.deepEqual(again.effects, [], "belt: still no spawn");
});

test("H1(a) TWO CONCURRENT RESUMES: the claim of `s.authHold` is the ticket", async () => {
  // A resume is a release plus the ordinary lazy wake (a steer); whoever claims the hold proceeds.
  const h = harness({ usable: true });
  const s = session({ state: { phase: "running", parked: false, activity: "working" } });
  h.holdIfAuthFailure(s, "401");
  await Promise.all([h.resumeAfterSignIn(s), h.resumeAfterSignIn(s)]);
  assert.equal(h.calls.dispatch.filter((e) => e.type === "auth_release").length, 1, "released exactly once");
  assert.equal(h.calls.dispatch.filter((e) => e.type === "steer").length, 1, "and woken once");
  assert.deepEqual(h.calls.startQuery, [], "a resume never assembles a second query");
  assert.equal(s.authHold, null, "a third caller finds nothing to resume");
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
  assert.equal(h.holdIfAuthFailure(s, "401 again"), true, "still reports handled");
  assert.deepEqual([s.state.phase, s.state.parked, s.state.authHeld], ["parked", true, true],
    "and it really is parked now, not 'running' forever");
  assert.equal(s.pushIterator.closed, true, "the prompt stream is closed");
  assert.equal(s.abortController.aborted, true, "the query is torn down");
  assert.ok(h.calls.denyPending.length >= 1, "awaited tool promises fail closed");
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
  // The kill, the stream close, the handle close and the supersede are `session-handles.js`'s,
  // driven in test/session-handles.test.mjs.
  assert.match(teardown, /teardownHandles\(s, \{ supersede: true \}\);/, "the previous child is torn down and superseded");
});

// A held session must never have an inbound turn fed into it: the gate refuses it
// (`session-gate.js › feedInbound`, pinned in session-gate.test.mjs) and the reducer is inert to
// one that got past ("H1(a) A PEER WAKE CANNOT RESUME A HELD SESSION" above).
