// THE SESSION TIMER — what "idle" means, and what a park is a bound on.
//
// §2 SPLIT (2026-08-05) out of test/session-posture-sticks.test.mjs, which hit the 500-line cap
// when M1/M2 landed. Same subject as FIX 3 there ("the idle timer measured time since the last
// turn ENDED, not idleness"), carried forward two more steps:
//
//   FIX 3  (2026-08-02) an open CARD is not idle: a request the operator was reading for sixteen
//          minutes parked the session underneath them and reset both axes.
//   M1     (2026-08-05, THE ROOT CAUSE of "I set bypass and it still asks me") an exchange
//          BLOCKED ON THE PEER is not idle either. Every turn end armed the 15-minute TTL,
//          including the turn the reducer itself labels `awaiting_peer` two lines earlier, so a
//          counterparty agent doing an hour of real work parked the session mid-flight. The state
//          distinction already existed; nothing consulted it where the timer was scheduled.
//   M2     (2026-08-05) a park no longer revokes the operator's posture or their standing grants,
//          and a session nobody comes back to ENDS instead of sitting dormant and wakeable.
//
// THE HARNESS is a virtual clock over the REAL reducer: `scheduleIdle` asks the real
// `idleTimeout(s.state)` AFTER dispatch has stored the new state, which is exactly what
// session-engine.scheduleIdle does (one clearTimeout + one setTimeout over that answer), and it
// answers BOTH the bound and the event. So this is the timer, not a model of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadReducer } from "./_reducer-block.mjs";

const { initialSessionState, sessionReducer, POSTURE_RESET_NOTE, idleTimeout,
        AWAITING_PEER_IDLE_MS, ABANDONED_MS } = loadReducer();


// M1/M2 (2026-08-05): the clock now models what session-engine's scheduleIdle really does — it
// asks `idleTimeout(s.state)` AFTER dispatch has stored the new state, and that answers BOTH the
// bound and the event. So an `awaiting_peer` turn arms hours instead of minutes (M1) and a park
// arms the abandonment bound firing `abandon_timeout` (M2), from one arming path with one handle.
function clock(state) {
  const s = { state };
  const emitted = [];
  let now = 0;
  let fireAt = null;
  let fireType = null;
  function dispatch(event) {
    const r = sessionReducer(s.state, event);
    s.state = r.state;
    for (const eff of r.effects) {
      if (eff.type === "scheduleIdle") {
        const t = idleTimeout(s.state);
        fireAt = now + t.ms;
        fireType = t.type;
      } else if (eff.type === "clearIdle") { fireAt = null; fireType = null; }
      else if (eff.type === "emit") emitted.push(eff.payload);
    }
    return r;
  }
  function advance(ms) {
    now += ms;
    if (fireAt !== null && now >= fireAt) { const t = fireType; fireAt = null; fireType = null; dispatch({ type: t }); }
  }
  return { s, emitted, dispatch, advance, armed: () => fireAt !== null, armedFor: () => (fireAt === null ? null : fireAt - now), armedType: () => fireType };
}

const TTL = initialSessionState({}).idleMs;
const armedRunning = (patch) => clock({ ...initialSessionState({}), phase: "running", activity: "working", ...patch });
const card = (id) => ({ type: "permission_request", requestId: id, name: "Bash", payload: { type: "permission_request", requestId: id } });

test("FIX 3: a session with an OPEN CARD is never idle — the TTL restarts when it opens", () => {
  const c = armedRunning({ toolMode: "bypass", messageMode: "auto_both" });
  c.dispatch({ type: "launched", payload: {} }); // the only re-arm that existed before
  c.advance(TTL - 1);
  c.dispatch(card("r1")); // the operator is now reading a request
  c.advance(TTL - 1); // ...for almost another full TTL
  assert.equal(c.s.state.parked, false, "before FIX 3 this parked, deny-closing the very card on screen");
  assert.equal(c.s.state.toolMode, "bypass", "and took the posture with it");
  assert.deepEqual(c.s.state.pendingPermissions, ["r1"], "the request is still answerable");
});

test("FIX 3: answering the card restarts the TTL again (the decision is activity too)", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.dispatch(card("r1"));
  c.advance(TTL - 1);
  c.dispatch({ type: "permission_decision", requestId: "r1", decision: "allow-once", name: "Bash" });
  c.advance(TTL - 1);
  assert.equal(c.s.state.parked, false);
});

test("FIX 3: a steer restarts it, so a session being typed at never parks mid-conversation", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL - 1);
  c.dispatch({ type: "steer", text: "keep going" });
  c.advance(TTL - 1);
  assert.equal(c.s.state.parked, false);
});

test("FIX 3: an accepted inbound turn restarts it (a turn was just pushed)", () => {
  const c = armedRunning({ messageMode: "auto_inbound" });
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL - 1);
  c.dispatch({ type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  c.advance(TTL - 1);
  assert.equal(c.s.state.parked, false);
});

test("FIX 3 / M2: NO card and genuinely quiet past the TTL still PARKS, and keeps the posture", () => {
  // The park itself is kept: it exists for cost, and a session nobody is watching should stop
  // BURNING. M2 (2026-08-05) inverts what it does to the posture — see the reducer's idle_timeout
  // branch. Stopping the query is about cost; revoking consent the operator gave is not, and
  // fifteen quiet minutes was never evidence they had gone.
  const c = armedRunning({ toolMode: "bypass", messageMode: "auto_both", inboundForTask: true, allowForTask: ["Bash"] });
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  assert.equal(c.s.state.parked, true);
  assert.equal(c.s.state.toolMode, "bypass");
  assert.equal(c.s.state.messageMode, "auto_both");
  assert.equal(c.s.state.inboundForTask, true, "the standing grants outlive the park too");
  assert.deepEqual(c.s.state.allowForTask, ["Bash"]);
  // ...and NOTHING is said, because nothing was taken: no modes echo, no reset note.
  assert.ok(!c.emitted.some((p) => p.type === "modes"), "the header was never dragged back");
  assert.ok(!c.emitted.some((p) => p.type === "notice" && p.text === POSTURE_RESET_NOTE));
  assert.doesNotMatch(POSTURE_RESET_NOTE, /—/, "house voice: no em dashes (the AUTH HOLD still uses it)");
});

test("M2: the park re-arms the ABANDONMENT bound, and reaching it ENDS the session", () => {
  const c = armedRunning({ toolMode: "bypass", messageMode: "auto_both" });
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  assert.equal(c.s.state.parked, true);
  assert.equal(c.armedType(), "abandon_timeout", "a parked shell waits on abandonment, not on another park");
  assert.equal(c.armedFor(), ABANDONED_MS);
  // Come back inside it and the posture is still there — this is the operator's whole complaint.
  const back = armedRunning({ toolMode: "bypass", messageMode: "auto_both" });
  back.dispatch({ type: "launched", payload: {} });
  back.advance(TTL);
  back.advance(ABANDONED_MS - 1);
  back.dispatch({ type: "steer", text: "still here" });
  assert.equal(back.s.state.parked, false);
  assert.deepEqual({ t: back.s.state.toolMode, m: back.s.state.messageMode }, { t: "bypass", m: "auto_both" });
  assert.equal(back.armedType(), "idle_timeout", "and a live session is back on the ordinary TTL");
  // Do not come back, and it ends.
  c.advance(ABANDONED_MS);
  assert.equal(c.s.state.phase, "ended", "a session nobody came back to stops existing, honestly");
});

test("FIX 3 / M2: the AUTH HOLD still resets, still says so, and still clears the timer", () => {
  // The note and the modes echo did not die with the idle park's reset; they moved to the one
  // park that still revokes. A held session arms nothing: it is waiting on a human.
  const c = armedRunning({ toolMode: "bypass", messageMode: "auto_both", allowForTask: ["Bash"] });
  c.dispatch({ type: "launched", payload: {} });
  c.dispatch({ type: "auth_hold" });
  assert.deepEqual({ t: c.s.state.toolMode, m: c.s.state.messageMode }, { t: "manual", m: "ask" });
  assert.deepEqual(c.s.state.allowForTask, []);
  assert.ok(c.emitted.some((p) => p.type === "modes" && p.tool === "manual" && p.message === "ask"));
  const note = c.emitted.find((p) => p.type === "notice" && p.text === POSTURE_RESET_NOTE);
  assert.ok(note && note.level === "info", "the hold says what it took away");
  assert.equal(c.armed(), false, "and it arms no abandonment timer over the Sign in button");
});

test("FIX 3: a park from an ALREADY restrictive posture says nothing (it took nothing away)", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  assert.equal(c.s.state.parked, true);
  assert.ok(!c.emitted.some((p) => p.type === "notice" && p.text === POSTURE_RESET_NOTE),
    "the line must never claim a change that did not happen");
});

test("FIX 3 / M2: a parked shell does not re-park on a loop (the re-arm is the far bound)", () => {
  const c = armedRunning({ toolMode: "auto" });
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  assert.equal(c.s.state.parked, true);
  // The defect this guards is a 15-minute PARK loop. The single arming path makes it impossible:
  // whatever a parked session arms is the abandonment bound, and a stale `idle_timeout` is inert.
  assert.equal(c.armedFor(), ABANDONED_MS, "never another idle TTL");
  assert.deepEqual(sessionReducer(c.s.state, { type: "idle_timeout" }).effects, [],
    "and a stale idle_timeout on a parked session is still the no-op it always was");
});

test("FIX 3: a PARKED session is not re-armed by a stale dock click", () => {
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  c.advance(TTL);
  const armedAt = c.armedFor();
  c.dispatch({ type: "permission_decision", requestId: "r1", decision: "deny", name: "Bash" });
  assert.equal(c.armedFor(), armedAt, "a dormant shell's bound is untouched by a stale click");
  assert.equal(c.armedType(), "abandon_timeout", "and the click never shortens it back to a park TTL");
});

// ── M1: THE ROOT CAUSE — an exchange blocked on the peer was treated as idle ──────
// Every turn end armed the 15-minute TTL, including the turn the reducer itself labels
// `awaiting_peer` two lines earlier. A counterparty's agent routinely takes longer than that
// doing real work, so the exchange parked MID-FLIGHT, and (before M2) the park reset the posture
// underneath it: the peer's reply then woke the session and the next tool call asked.

const postTurn = (c) => {
  c.dispatch({ type: "outbound_post", payload: { type: "outbound_post", toolUseId: "t1", to: "David", text: "over to you" } });
  return c.dispatch({ type: "result", turnCostUsd: 0.1 });
};

test("M1: a turn that POSTED is awaiting_peer, and awaiting_peer does NOT park within the idle window", () => {
  const c = armedRunning({ toolMode: "bypass", messageMode: "auto_both" });
  c.dispatch({ type: "launched", payload: {} });
  postTurn(c);
  assert.equal(c.s.state.activity, "awaiting_peer", "the distinction the timer was not consulting");
  assert.equal(c.armedFor(), AWAITING_PEER_IDLE_MS, "hours, not minutes");
  // THE REPRODUCTION: a peer agent doing an hour of real work. Before M1 this parked at 15:00.
  c.advance(60 * 60 * 1000);
  assert.equal(c.s.state.parked, false, "the session was never idle; it was blocked on I/O");
  assert.deepEqual({ t: c.s.state.toolMode, m: c.s.state.messageMode }, { t: "bypass", m: "auto_both" });
});

test("M1: a turn that did NOT post is genuinely idle and keeps the ordinary 15-minute TTL", () => {
  const c = armedRunning({ toolMode: "bypass" });
  c.dispatch({ type: "launched", payload: {} });
  c.dispatch({ type: "result", turnCostUsd: 0.1 });
  assert.equal(c.s.state.activity, "idle");
  assert.equal(c.armedFor(), TTL, "M1 widens ONE state, not the timer");
  c.advance(TTL);
  assert.equal(c.s.state.parked, true);
});

test("M1: the peer's reply puts it back on the ordinary TTL (the bound is not sticky)", () => {
  const c = armedRunning({ messageMode: "auto_both" });
  c.dispatch({ type: "launched", payload: {} });
  postTurn(c);
  assert.equal(c.armedFor(), AWAITING_PEER_IDLE_MS);
  c.dispatch({ type: "inbound_arrived", pendingId: "p1", message: "here you go", authorName: "David" });
  assert.equal(c.s.state.activity, "working");
  assert.equal(c.armedFor(), TTL, "working again means the ordinary idle rules again");
});

test("M1: awaiting_peer is still BOUNDED — a reply that never comes does eventually park", () => {
  // Suppression would have left a live query, its push iterator and its awaited promises alive
  // forever when the peer is offline. The bound is far above exchange latency, not absent.
  const c = armedRunning({});
  c.dispatch({ type: "launched", payload: {} });
  postTurn(c);
  c.advance(AWAITING_PEER_IDLE_MS);
  assert.equal(c.s.state.parked, true, "nothing runs unattended forever");
  assert.ok(AWAITING_PEER_IDLE_MS > TTL * 15, "but far enough out that no real exchange reaches it");
});
