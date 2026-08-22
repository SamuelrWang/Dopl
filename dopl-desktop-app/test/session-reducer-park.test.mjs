// Tests for the v1.7.4 P1 park transitions in the pure session reducer
// (main/session-reducer.js). Split out of session-reducer.test.mjs to keep BOTH files
// under the §2 500-line cap. SAME source-extraction idiom: slice the reducer's
// BEGIN/END sentinel block and evaluate it verbatim, so these can never drift from what
// ships. Covers: idle PARKS (never settles), the deny-close of pending permissions on
// park, park idempotency, and the two — and only two — lazy-resume triggers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer, REDUCER_SRC } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// §2 SPLIT (H1): the pure block now spans session-effects.js + session-reducer.js;
// test/_reducer-block.mjs slices BOTH sentinel pairs and evaluates them as one program.
const { initialSessionState, sessionReducer, nextIdleMs, idleTimeout, turnCapReached, costCapReached,
        DEFAULT_TURN_CAP, DEFAULT_IDLE_MS, DEFAULT_COST_CAP_USD, ABANDONED_MS,
        AWAITING_PEER_IDLE_MS, INACTIVE_NOTE } = loadReducer();

const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const effTypes = (effects) => effects.map((e) => e.type);
const findEff = (effects, type) => effects.find((e) => e.type === type);

// ── idle PARKS (does not end) ─────────────────────────────────────────────────────

// M2 (2026-08-05) — THE PARK'S EFFECT SET CHANGED, and both changes are the requirement change:
// the modes echo is GONE (nothing is reset, so there is nothing to echo — the header goes on
// showing what the operator set, which is now the truth), and `clearIdle` became `scheduleIdle`,
// which on a state whose `parked` is already true arms the hours-scale ABANDONMENT bound
// (session-state.idleTimeout) rather than another idle TTL.
test("idle_timeout PARKS the session — no settle/destroy/delete, sdkSessionId retained", () => {
  const s = running();
  const r = sessionReducer(s, { type: "idle_timeout" });
  // P1: NOT ended, NOT settled. The park effect set tears the query down but keeps the
  // session object + window alive (no `settle`, so the engine never destroys/deletes it).
  assert.equal(r.state.phase, "parked");
  assert.equal(r.state.parked, true);
  assert.equal(r.state.turns, s.turns, "turn count is preserved across a park");
  assert.deepEqual(effTypes(r.effects), ["denyPending", "abortQuery", "scheduleIdle", "persist", "emit", "emit"]);
  assert.ok(!r.effects.some((e) => e.type === "emit" && e.payload.type === "modes"),
    "M2: a park that takes no posture away echoes no posture change");
  assert.ok(!r.effects.some((e) => e.type === "settle"), "park NEVER settles (no destroy/delete)");
  assert.equal(findEff(r.effects, "persist").phase, "parked");
  const status = r.effects.find((e) => e.type === "emit" && e.payload.type === "status");
  assert.deepEqual(status.payload, { type: "status", phase: "parked" });
  assert.ok(r.effects.some((e) => e.type === "emit" && e.payload.type === "paused"), "emits the inline paused note");
});

// ── M2: the ABANDONMENT bound, and what it ends ───────────────────────────────────

test("M2: the park ARMS the abandonment bound (hours), not another idle TTL (minutes)", () => {
  const r = sessionReducer(running(), { type: "idle_timeout" });
  assert.ok(r.effects.some((e) => e.type === "scheduleIdle"), "the park re-arms rather than clearing");
  // session-engine's scheduleIdle asks idleTimeout(s.state) AFTER dispatch has stored the new
  // state, so the arm a park produces can only ever be the abandonment one.
  assert.deepEqual(idleTimeout(r.state), { ms: ABANDONED_MS, type: "abandon_timeout" });
  assert.ok(ABANDONED_MS > DEFAULT_IDLE_MS * 40, "far above the park TTL, so the two cannot be confused");
});

test("M2: abandon_timeout ENDS a parked session — terminal, so no peer can ever wake it", () => {
  const parked = sessionReducer({ ...running(), toolMode: "bypass", messageMode: "auto_both" },
    { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "abandon_timeout" });
  assert.equal(r.state.phase, "ended", "ending is the honest state for a session nobody came back to");
  assert.ok(r.effects.some((e) => e.type === "settle" && e.outcome === "ended"));
  assert.ok(r.effects.some((e) => e.type === "abortQuery"));
  // C-5 (2026-08-08, Samuel's call) — IT NOW POSTS, AND THE OLD ASSERTION HERE WAS THE BUG.
  //
  // This line used to read "It posts NO lifecycle: an unwatched machine must not write to the
  // shared thread on a timer." That argument is about who is at the KEYBOARD, and the cost
  // falls on somebody else entirely: the abandonment is the COMMON path (request →
  // task_started → 15min idle → silent park → 12h → silent end), so the requester on the OTHER
  // machine was left watching a card pulse "Working…" indefinitely, for the ending that
  // happens most often. Nobody being present to decide it is the reason the peer cannot find
  // out any other way, not a reason to stay quiet.
  //
  // What it writes is a STATUS NOTE, not an outcome: `task_progress` + the reserved
  // `session_ended` marker, which `group-thread.ts` treats as an ENTRY and never as an
  // `endEvent`, so it can reach `calmEndStatus` and nothing else. The shared thread's outcome
  // is untouched and the exchange stays open and resumable.
  const lc = r.effects.find((e) => e.type === "lifecycle");
  assert.ok(lc, "the person still waiting is told the session went inactive");
  assert.equal(lc.kind, "task_progress", "NEVER a terminal kind — this is not the thread failing");
  assert.deepEqual(lc.extra, { session_ended: true });
  assert.equal(lc.body, INACTIVE_NOTE);
  assert.ok(!/—/.test(lc.body) && !/error|fail/i.test(lc.body), "a status note, not a fault");
  // ...and the end really is terminal — every later event is inert, wake triggers included.
  for (const evt of [{ type: "steer", text: "hello" }, { type: "inbound_arrived", message: "hi", authorName: "B" }]) {
    assert.deepEqual(sessionReducer(r.state, evt).effects, [], `${evt.type} cannot revive an ended session`);
  }
});

test("M2: abandon_timeout is a NO-OP on a live session (a stale timer never ends real work)", () => {
  const live = running();
  const r = sessionReducer(live, { type: "abandon_timeout" });
  assert.equal(r.state, live);
  assert.deepEqual(r.effects, []);
  // And a woken session is live again, so the arm it carries is the ordinary TTL once more.
  const woken = sessionReducer(sessionReducer(live, { type: "idle_timeout" }).state, { type: "steer", text: "go" }).state;
  assert.deepEqual(idleTimeout(woken), { ms: DEFAULT_IDLE_MS, type: "idle_timeout" });
  assert.deepEqual(sessionReducer(woken, { type: "abandon_timeout" }).effects, []);
});

test("idle_timeout clears any awaited permission (denyPending) and empties pendingPermissions", () => {
  const s = { ...running(), phase: "awaiting_permission", pendingPermissions: ["r1", "r2"] };
  const r = sessionReducer(s, { type: "idle_timeout" });
  assert.equal(r.state.phase, "parked");
  assert.deepEqual(r.state.pendingPermissions, [], "no awaited permission survives a park");
  assert.equal(effTypes(r.effects)[0], "denyPending", "denyPending runs BEFORE abort (fail closed)");
  // FIX #6: park also clears the RENDERER's dock — a permission_resolved{deny} per pending id
  // so a query-less parked session never shows a live-looking (clickable, lying) prompt.
  const resolved = r.effects.filter((e) => e.type === "emit" && e.payload.type === "permission_resolved");
  assert.deepEqual(resolved.map((e) => e.payload), [
    { type: "permission_resolved", requestId: "r1", decision: "deny" },
    { type: "permission_resolved", requestId: "r2", decision: "deny" },
  ]);
});

// ── FIX F6 (v2.7): the per-turn POST counters must not survive a park either ─────────
// A park deny-closes every awaited card, so a gated post reads "Not sent" — but
// postedThisTurn / postedToolUseIds stayed set, and the pill's turn-end transition would then
// pick `awaiting_peer` ("Waiting for reply") right beside that stopped draft.

test("FIX F6: parking clears postedThisTurn + postedToolUseIds (no 'Waiting for reply' on a stopped post)", () => {
  const posted = sessionReducer(running(), {
    type: "outbound_post",
    payload: { type: "outbound_post", toolUseId: "t1", to: "David", text: "draft", pending: true, ownChannel: true },
  }).state;
  assert.equal(posted.postedThisTurn, true, "set at stream time, as before");
  assert.deepEqual(posted.postedToolUseIds, ["t1"]);

  const r = sessionReducer({ ...posted, pendingPermissions: ["r1"] }, { type: "idle_timeout" });
  assert.equal(r.state.parked, true);
  assert.equal(r.state.postedThisTurn, false, "nothing is awaiting a reply — the post was denied");
  assert.deepEqual(r.state.postedToolUseIds, []);
  // The park still deny-closes the card itself, which is what makes the counters wrong to keep.
  const echo = r.effects.find((e) => e.type === "emit" && e.payload.type === "permission_resolved");
  assert.deepEqual(echo.payload, { type: "permission_resolved", requestId: "r1", decision: "deny" });
  // The effect SET (M2: `scheduleIdle` arms the abandonment bound where `clearIdle` used to sit,
  // and there is no `modes` echo because the idle park no longer takes a posture away).
  assert.deepEqual(effTypes(r.effects), ["denyPending", "abortQuery", "scheduleIdle", "persist", "emit", "emit", "emit"]);
});

test("FIX F6: a woken session still counts a NEW post normally", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const woken = sessionReducer(parked, { type: "steer", text: "carry on" }).state;
  assert.equal(woken.parked, false);
  const again = sessionReducer(woken, {
    type: "outbound_post", payload: { type: "outbound_post", toolUseId: "t2", to: "David", text: "next" },
  }).state;
  assert.equal(again.postedThisTurn, true, "the park reset the counters, it did not disable them");
  assert.deepEqual(again.postedToolUseIds, ["t2"]);
});

// ── M2 (2026-08-05): THE PARK NO LONGER DISARMS ANYTHING ────────────────────────────
// THE REQUIREMENT CHANGE, and it INVERTS this test. It used to assert FIX #3 (both axes) +
// MEDIUM-3/C9 (inboundForTask) + FIX F1 (allowForTask) reset on park. Samuel's contract is that a
// posture he set holds for the session, the for-task grants included; fifteen quiet minutes is
// not evidence he left (he may be reading, in another window, or — before M1 — waiting on the
// peer). The AWAY threat those three fixes named is answered by the abandonment END above, which
// is strictly stronger than the downgrade was (an ended session cannot be woken at all), and by
// the PROFILE hard-deny, which no posture and no grant has ever been able to widen.

test("M2: parking keeps BOTH axes, inboundForTask AND every standing grant", () => {
  const s = { ...running(), toolMode: "bypass", messageMode: "auto_both", inboundForTask: true,
    allowForTask: ["Bash#ls#abc"] };
  const r = sessionReducer(s, { type: "idle_timeout" });
  assert.equal(r.state.parked, true);
  assert.equal(r.state.toolMode, "bypass", "AXIS A is the operator's for the session");
  assert.equal(r.state.messageMode, "auto_both", "and so is AXIS B");
  assert.equal(r.state.inboundForTask, true, "and the standing inbound grant");
  assert.deepEqual(r.state.allowForTask, ["Bash#ls#abc"], "and the scoped for-task grants");
  // ...and the operator is told nothing was taken away, because nothing was.
  assert.ok(!r.effects.some((e) => e.type === "emit" && e.payload.type === "notice"),
    "no posture-reset note: the park revoked nothing");
});

test("M2: a woken session behaves as the operator set it — the whole point of the change", () => {
  const armed = { ...running(), toolMode: "bypass", messageMode: "auto_both" };
  const parked = sessionReducer(armed, { type: "idle_timeout" }).state;
  const woken = sessionReducer(parked, { type: "steer", text: "carry on" }).state;
  assert.deepEqual({ t: woken.toolMode, m: woken.messageMode }, { t: "bypass", m: "auto_both" },
    "a park/resume cycle inside one session changes no posture");
});

test("M2: the AUTH HOLD still disarms — it is the one park that does", () => {
  // H1's reasoning is untouched: a hold is a session with no CREDENTIAL, which relaunches through
  // startQuery on sign-in rather than resuming in place, so its arm belongs to the run that ended.
  const s = { ...running(), toolMode: "bypass", messageMode: "auto_both", inboundForTask: true,
    allowForTask: ["Bash#ls#abc"] };
  const r = sessionReducer(s, { type: "auth_hold" });
  assert.deepEqual({ t: r.state.toolMode, m: r.state.messageMode }, { t: "manual", m: "ask" });
  assert.equal(r.state.inboundForTask, false);
  assert.deepEqual(r.state.allowForTask, []);
  const modes = r.effects.find((e) => e.type === "emit" && e.payload.type === "modes");
  assert.deepEqual(modes.payload, { type: "modes", tool: "manual", message: "ask" }, "and it says so");
  // A held session arms NO abandonment bound: the window carries the Sign in button.
  assert.ok(r.effects.some((e) => e.type === "clearIdle"), "the hold CLEARS the timer, it does not re-arm");
  assert.ok(!r.effects.some((e) => e.type === "scheduleIdle"));
});

// ── FIX #5: a parked session is INERT to buffered SDK messages ──────────────────────

test("FIX #5: a late `result` while parked runs NO effects (no cap end, no idle re-arm)", () => {
  const parked = sessionReducer(running({ turnCap: 1 }), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "result", turnCostUsd: 5 });
  assert.equal(r.state, parked, "state is unchanged");
  assert.deepEqual(r.effects, [], "a drained result must not run endEffects or scheduleIdle on a parked session");
});

test("FIX #5: late render pass-throughs while parked are inert (no emit)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  for (const type of ["assistant", "tool_use", "tool_result", "outbound_post"]) {
    const r = sessionReducer(parked, { type, payload: { type, x: 1 } });
    assert.deepEqual(r.effects, [], `${type} is inert while parked`);
    assert.equal(r.state, parked);
  }
});

test("FIX #5: a late permission_request while parked stashes NO resolver (inert)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "permission_request", requestId: "rZ", name: "Bash", payload: {} });
  assert.deepEqual(r.effects, [], "no emit, no pending stash on a parked session");
  assert.deepEqual(r.state.pendingPermissions, [], "the resolver is never tracked");
  assert.equal(r.state.phase, "parked");
});

// ── FIX #6: a stale dock click on a parked session must not resume it ────────────────

test("FIX #6: permission_decision while parked keeps phase parked (only steer/inbound resume)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "permission_decision", requestId: "r1", decision: "allow-once", name: "Bash" });
  assert.equal(r.state.phase, "parked", "a stale dock click never flips a parked session to running");
  assert.equal(r.state.activity, "parked");
  assert.ok(!r.effects.some((e) => e.type === "resumeQuery"), "no resume from a dock click");
});

// ── FIX #1a: a crash on a parked session is inert (park aborted the query, not settled) ─

test("FIX #1a: a `crash` while parked is a NO-OP (a stray non-abort rejection can't settle it)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "crash" });
  assert.equal(r.state, parked, "the parked session survives — no settle/destroy");
  assert.deepEqual(r.effects, [], "no settle, no interrupted lifecycle, no error emit");
  assert.equal(r.state.phase, "parked");
});

test("FIX #1a: a genuine crash on a RESUMED (not parked) session still settles interrupted", () => {
  // Wake the parked session (steer clears the parked flag) — a real crash now settles.
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const woke = sessionReducer(parked, { type: "steer", text: "go" }).state;
  assert.equal(woke.parked, false);
  const r = sessionReducer(woke, { type: "crash" });
  assert.equal(r.state.phase, "ended");
  assert.ok(r.effects.some((e) => e.type === "settle" && e.outcome === "interrupted"));
});

test("a parked session ignores a stale idle_timeout (idempotent, no double-park)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "idle_timeout" });
  assert.equal(r.state, parked);
  assert.deepEqual(r.effects, []);
});

// ── the two lazy-resume triggers ──────────────────────────────────────────────────

// v2.5 D1: an inbound turn only wakes a parked session when it is AUTO-ACCEPTED (AXIS B, or
// the standing task grant). Without that opt-in the reply is held and the session stays
// parked — the two cases below. M2 (2026-08-05): a park no longer disarms either, so an opt-in
// set BEFORE the park survives it; this case starts from a session that never had one, and
// grants it, so it still proves the wake rather than the survival (which M2's own tests cover).
test("LAZY RESUME (a): an AUTO-ACCEPTED inbound turn wakes a parked session (resumeQuery FIRST)", () => {
  const parked = sessionReducer(running({ mode: "autonomous" }), { type: "idle_timeout" }).state;
  assert.equal(parked.parked, true);
  assert.equal(parked.messageMode, "ask", "this session never opted in, so the gate holds");
  assert.equal(parked.inboundForTask, false);
  const granted = { ...parked, inboundForTask: true }; // the operator's standing grant
  const r = sessionReducer(granted, { type: "inbound_arrived", message: "back", authorName: "Bob" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.parked, false, "the wake clears the parked flag");
  // resumeQuery MUST precede pushInbound so the fresh push iterator exists first.
  assert.equal(effTypes(r.effects)[0], "resumeQuery");
  const pushIdx = effTypes(r.effects).indexOf("pushInbound");
  assert.ok(pushIdx > 0, "pushInbound follows the resume");
  assert.deepEqual(findEff(r.effects, "pushInbound"), { type: "pushInbound", message: "back", authorName: "Bob", addressing: null });
});

test("LAZY RESUME (b): operator steer wakes a parked session (resumeQuery, no interrupt)", () => {
  const parked = sessionReducer(running(), { type: "idle_timeout" }).state;
  const r = sessionReducer(parked, { type: "steer", text: "keep going", priority: "now" });
  assert.equal(r.state.phase, "running");
  assert.equal(r.state.parked, false);
  // A parked query has nothing live to interrupt, so a priority:'now' wake skips it.
  assert.deepEqual(effTypes(r.effects), ["resumeQuery", "pushTurn", "emit", "scheduleIdle"]); // FIX 3
  assert.ok(!r.effects.some((e) => e.type === "interruptQuery"), "no interrupt while waking");
  const status = r.effects.find((e) => e.type === "emit" && e.payload.type === "status");
  assert.deepEqual(status.payload, { type: "status", phase: "running", activity: "working" });
});

test("interactive park holds an inbound reply (stays parked); the RELEASE wakes it", () => {
  const parked = sessionReducer(running({ mode: "interactive" }), { type: "idle_timeout" }).state;
  // A held reply does not wake a parked query — it stays parked, phase awaiting_inbound.
  const held = sessionReducer(parked, { type: "inbound_arrived", pendingId: "p1", message: "hi", authorName: "Bob" });
  assert.equal(held.state.phase, "awaiting_inbound");
  assert.equal(held.state.parked, true, "still parked until the operator releases");
  assert.ok(!held.effects.some((e) => e.type === "resumeQuery"), "holding a reply does not resume");
  // Releasing it is the wake trigger.
  const released = sessionReducer(held.state, { type: "inbound_released", message: "hi", authorName: "Bob" });
  assert.equal(released.state.phase, "running");
  assert.equal(released.state.parked, false);
  assert.equal(effTypes(released.effects)[0], "resumeQuery");
});

test("a live (not parked) inbound / steer / release NEVER emits resumeQuery", () => {
  const auto = sessionReducer(running({ mode: "autonomous" }), { type: "inbound_arrived", message: "x", authorName: "B" });
  assert.ok(!auto.effects.some((e) => e.type === "resumeQuery"));
  const steer = sessionReducer(running(), { type: "steer", text: "x" });
  assert.ok(!steer.effects.some((e) => e.type === "resumeQuery"));
  const rel = sessionReducer(
    { ...running({ mode: "interactive" }), phase: "awaiting_inbound", hasPendingInbound: true },
    { type: "inbound_released", message: "go", authorName: "B" }
  );
  assert.ok(!rel.effects.some((e) => e.type === "resumeQuery"));
});
