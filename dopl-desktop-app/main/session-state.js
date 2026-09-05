// Session STATE SHAPE — the fields a session carries, their defaults, and the caps read off
// them (v1.9 Session Window, Track T1).
//
// §2 SPLIT (2026-07-31): session-reducer.js sits in the ENGINEERING.md §2 zero-headroom
// cluster ("any edit to one of these is a split. Do not repeat the pattern of trimming a
// comment to buy back the line you need"), and the inbound gate needed one more conjunct. This
// is the same seam session-effects.js took: a PURE block, required by the reducer at module
// scope ABOVE its own sentinel, so inside the reducer's block these are free vars and
// test/_reducer-block.mjs concatenates the three blocks back into exactly the standalone
// program the truth tables have always evaluated.
//
// WHAT LIVES HERE is everything that answers "what does a fresh session look like, and when
// has it run out of room": the loop-safety defaults, `initialSessionState`, the three cap /
// timer readers, and the two MODE TABLES the state defends itself with. WHAT DOES NOT is
// every decision — `sessionReducer` and its helpers stay in session-reducer.js, because a
// state shape and a state machine are two different things to change.
//
// PURE: no electron / SDK / fs / path / crypto reference anywhere in the block below.

// ─── BEGIN SESSION-STATE (pure; unit-tested via source extraction) ───────────

// Loop-safety defaults (contract §A.2). turn cap bounds a two-agent exchange; idle TTL parks a
// stalled session (task stays open, resumable); cost cap is opt-in (0 => disabled).
//
// ⚠ THE TURN CAP IS ISSUER-KEYED (2026-09-05, task 9a), AND BOTH NUMBERS ARE DECLARED HERE, ONCE
// EACH. 24 was sized for the runaway a CHAIN produces — an agent that spawned an agent, the two
// of them talking with nobody watching — and it was then applied to every spawn shape, the one a
// human starts and sits in front of included. That is the observed failure: long operator
// sessions ending mid-analysis at 24 with the work half done.
// THE ISSUER KEY IS `launchDepth`, and it is not a new field: `session-launch-op.js` is the ONLY
// lane that may set 0 (the New Agent button, a human at the keyboard), everything above it is
// agent-issued through `session-own-launch.js › MAX_LAUNCH_DEPTH`, and a guard already stops any
// other lane copying the 0.
// ⚠ ABSENT IS THE AGENT NUMBER — the same fail-closed direction the launch bound reads this field
// in ("absent is the cap"). A resume, a recreate and the peer-triggered responder all pass no
// depth, and the responder is precisely the two-agent exchange 24 exists for. Only a strict
// `=== 0` widens; "0" the string does not.
const DEFAULT_TURN_CAP = 24; // agent-issued (depth > 0) — and every lane that names no issuer
const OPERATOR_TURN_CAP = 200; // depth 0 — the operator's own button lane, a human in front of it
function defaultTurnCap(launchDepth) {
  return launchDepth === 0 ? OPERATOR_TURN_CAP : DEFAULT_TURN_CAP;
}

// ⚠ WHAT "UNLIMITED" IS, AND WHY IT IS `Infinity` AND NOT 0 (2026-09-05, task 9b). The operator's
// setting spells no-cap as 0 (`settings.js`), because that is what a person types into a box and
// what an empty store key coerces from. It CANNOT be 0 in here: `turnCapReached` is
// `turns >= turnCap`, so a 0 in the state would end every session on its first result — the
// strictest possible cap wearing the word "unlimited". `Infinity` is the same comparison read
// honestly, needs no branch at the enforcement site, and cannot be reached by a counter.
// ⚠ IT IS NOT DURABLE, ON PURPOSE. `JSON.stringify(Infinity)` is `null`, so
// `session-store.js › durableSessionRecord` coerces it to 0 = "no stored cap" and a resume
// re-reads the setting — which is still unlimited if the operator has not changed it, and is the
// operator's NEW answer if they have. The setting is the authority; a persisted copy of a
// non-number would only ever be a second, staler one.
const UNLIMITED_TURN_CAP = Infinity;
const DEFAULT_IDLE_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_COST_CAP_USD = 0; // 0 => disabled

// M1 (2026-08-05) — A SESSION WAITING ON THE PEER IS NOT AN IDLE SESSION.
// THE DEFECT: every turn end armed the 15-minute TTL, INCLUDING the turn that had just posted
// into the channel — the one turn the reducer itself labels `awaiting_peer` two lines earlier.
// A counterparty's agent routinely takes longer than fifteen minutes doing real work, so the
// exchange parked mid-flight, the park reset the posture, the peer's reply then woke it, and the
// next tool call asked. That is the whole of "I set bypass and it still asks me": the timer could
// not tell "the operator walked away" from "the other agent is thinking", and it guessed wrong on
// the one state where the difference matters.
//
// WHY A LONGER BOUND AND NOT SUPPRESSION. Suppressing the timer entirely while awaiting a peer
// leaves a live SDK query, its push iterator and its awaited canUseTool promises alive FOREVER
// when the reply never comes (the peer is offline, their agent crashed, they abandoned the
// thread) — an unbounded resource commitment with nobody watching, which is the exact class of
// thing the idle timer exists to bound. A bound far above the exchange-latency range keeps the
// guarantee ("nothing runs unattended forever") while making the timer stop lying about what
// idle means. Four hours is ~16x the 15-minute TTL and one to two orders of magnitude above a
// real agent turn (seconds to tens of minutes), so it cannot fire inside a live exchange.
const AWAITING_PEER_IDLE_MS = 4 * 60 * 60 * 1000; // 4 hours

// M2 (2026-08-05) — and what a GENUINELY abandoned session does, measured from the park.
// The park used to reset both axes and every standing grant, because a parked session stays
// WAKEABLE by the counterparty and "a counterparty-driven lazy resume must not run
// pre-authorized while the operator is away" (v2.9 FIX #3 / C9 / F1). Samuel's contract is that
// operator intent survives the session, so the reset is gone — see session-reducer's
// idle_timeout branch for where that reasoning was re-sited. This is the replacement, and it is
// a STRICTER guard than the reset was: a session nobody has come back to does not sit dormant at
// bypass waiting to be woken by a peer, it ENDS. `phase: 'ended'` is terminal in the reducer, so
// nothing can wake it at all; a later peer reply recreates a dormant shell from the durable
// record, which starts at manual/ask like every other wake nobody approved (FIX 1b).
// TWELVE HOURS is 48x the park TTL and 3x the awaiting-peer bound, so it can never be confused
// with either: a session parked at the end of a working day ends overnight, and one parked over
// a lunch break is still there, still armed, when the operator comes back.
const ABANDONED_MS = 12 * 60 * 60 * 1000; // 12 hours

// C-4 (2026-08-08) — THE LAUNCH WATCHDOG, and where its number comes from.
//
// THE DEFECT: `startSession` set `idleTimer: null` and the timer was armed ONLY by reducer
// effects that require `launched` — which only the SDK's `system/init` dispatches. A child
// that boots and never emits one therefore sat at phase 'launching' with NO timer at all:
// `hasLiveSession` stayed true, every retry into that slot answered `{skipped:'busy'}`, the
// slot counted against MAX_WINDOWS forever, and no `task_started` was ever posted, so the
// peer had nothing to look at either. There was no path out except quitting the app.
//
// THE BOUND IS FIVE MINUTES, and it is NOT a guess — three constants already in this tree
// bracket it, and the test pins the relations rather than the literal (the
// mcp-client-timeout.test.mjs precedent):
//   `mcp-config.MCP_CLIENT_TIMEOUT_MS` = 290s — the longest a single MCP request may hold
//     before this process's own client aborts it. The watchdog must sit ABOVE it, or a
//     launch could be declared dead while the transport's own abort was still the thing
//     about to unstick it.
//   `mcp-config.HOLD_MARGIN_MS` = 60s — this repo's own price for "auth + MCP boot +
//     the workspace handshake", i.e. exactly the work between spawning the child and
//     `system/init`. Five minutes is 5x that, so a slow-but-healthy first turn (cold model
//     start behind a slow handshake) can never trip it.
//   `session-spawner.MAX_RUNTIME_MS` = 300s — the headless lane's existing statement that a
//     `claude` child which has produced nothing in five minutes has failed. Matching it
//     keeps ONE answer to that question across both lanes.
// And it is 1/3 of DEFAULT_IDLE_MS, so a launch timeout can never be confused with the
// idleness of a session that DID start.
const LAUNCHING_MS = 5 * 60 * 1000; // 5 minutes

// v2.9 THE MODE TABLES, duplicated ON PURPOSE: session-profiles.js is canonical, but this block is
// evaluated standalone (source extraction) and is the STATE OWNER, so it defends its own field fail-
// closed — for a mid-session change AND for the v3.1 preset it starts from. test/session-permission-
// axes pins the copies (here, session-profiles, the preload, the renderer).
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];
function coerceMode(list, value) {
  return list.indexOf(value) === -1 ? list[0] : value; // [0] is the most restrictive
}

// Fresh state for a launching session. `mode` is the task's declared engagement mode (display + the
// durable record); as of v2.5 D1 it NO LONGER gates the inbound path — every counterparty turn waits
// on an Accept unless AXIS B or the standing grant says otherwise. Caps (and, v3.1, both axes) fall
// back to the documented defaults on an absent or invalid value.
function initialSessionState(opts) {
  const o = opts || {};
  // 9b: UNLIMITED passes through as itself — it is the one non-finite value this coercion may
  // accept, and only by identity, so a NaN or a hand-edited "Infinity" string still lands on the
  // documented default like every other piece of junk.
  const turnCap = o.turnCap === UNLIMITED_TURN_CAP ? UNLIMITED_TURN_CAP
    : Number.isFinite(o.turnCap) && o.turnCap > 0 ? o.turnCap : DEFAULT_TURN_CAP;
  const costCapUsd = Number.isFinite(o.costCapUsd) && o.costCapUsd > 0 ? o.costCapUsd : DEFAULT_COST_CAP_USD;
  const idleMs = Number.isFinite(o.idleMs) && o.idleMs > 0 ? o.idleMs : DEFAULT_IDLE_MS;
  return {
    phase: 'launching',
    mode: o.mode === 'autonomous' ? 'autonomous' : 'interactive',
    side: o.side === 'requester' ? 'requester' : 'responder',
    turns: 0,
    costUsd: 0,
    turnCap: turnCap,
    costCapUsd: costCapUsd,
    idleMs: idleMs,
    pendingPermissions: [], // requestIds awaiting a button (models a Set)
    allowForTask: [], // scoped grant KEYS granted for the task (models a Set); cleared on park
    // v2.9 THE TWO AXES (session-profiles owns the tables + the resolution). toolMode = AXIS A
    // (manual|accept_edits|auto|bypass): what MY agent may do on THIS machine, NEVER a message op;
    // messageMode = AXIS B (ask|auto_inbound|auto_outbound|auto_both): what crosses between machines,
    // NEVER a work tool. Per-session, never persisted, RESET on park (v2.3 FIX #3). v3.1: the START
    // may come from the channel preset (channel-context.startingModes), coerced fail-closed here.
    toolMode: coerceMode(TOOL_MODES, o.toolMode),
    messageMode: coerceMode(MESSAGE_MODES, o.messageMode),
    // v2.5 D1/D4: the standing INBOUND grant ("Accept for this session") — when true an inbound turn
    // is fed with no Accept. Like allowForTask it lives for the life of the in-memory session
    // object and is NEVER persisted. MEDIUM-3 (C9): it is now reset on park with the two axes, so
    // a peer cannot restart a parked query and drive turns with the operator away.
    inboundForTask: false,
    hasPendingInbound: false,
    // P1 (v1.7.4): true while the session is PARKED — the live SDK query is torn down but the
    // session object + window survive, so an inbound turn or operator input can lazily resume it
    // (options.resume). Never persisted. Distinct from `phase` because a parked session HOLDING a
    // reply sits at phase 'awaiting_inbound' (FIX #6) yet still needs a resume on Accept.
    parked: false,
    // H1: TRUE while this session is held on the "Sign in to Claude" action (the preflight
    // found no Claude Code credential, or a live query failed auth-shaped). A held session is
    // PARKED but, unlike an idle park, must NOT be woken by an inbound turn — there is no
    // credential to spawn with. It lives HERE rather than on the session object because
    // wakeEffects and inboundAutoAccepted, the two places that decide whether to spawn, can
    // only see state. Never persisted: a credential is a fact about the machine, not a record.
    authHeld: false,
    // Item 3: the coarse activity the status pill shows (working|idle|awaiting_peer|awaiting_
    // permission|awaiting_inbound). A launching/running session is `working`; `postedThisTurn`
    // records whether the agent posted this turn, so turn-end can pick `awaiting_peer` vs `idle`.
    activity: 'working',
    postedThisTurn: false,
    // ── THE CONTEXT METER (2026-08-02) ──────────────────────────────────────────────────
    // What the last finished turn measured, so a window RELOAD and a P2 recreate repaint from
    // one place. `model` is the model the SDK says is really running (never the operator's
    // PICK, which lives on the session object as `s.model` and may be 'default'); it moves
    // mid-session when the picker calls Query.setModel. `contextWindow` is null whenever this
    // build does not know that model's size, and the renderer then shows tokens with NO
    // percentage — a made-up denominator on the gauge that decides "start a fresh session" is
    // worse than no gauge. None of the three is persisted: a new run measures its own.
    model: null,
    contextTokens: 0,
    contextWindow: null,
    // FIX F3: the tool_use ids of the posts that streamed THIS turn. The outbound bubble is
    // emitted BEFORE canUseTool resolves, so a denied post must be un-counted when its failing
    // tool_result lands; else the turn ends "Waiting for reply" on a message that never left.
    postedToolUseIds: [],
  };
}

// Idle timer duration (§A.2). M1 (2026-08-05) — this WAS the "hook for phase-aware backoff
// later" and now uses it, because the phase distinction already existed and simply was not
// consulted where the timer got scheduled. `awaiting_peer` is set by the reducer's `result`
// branch for exactly the turn that posted, and dispatch stores the new state BEFORE running the
// effects, so the scheduleIdle this very turn emits reads the activity this very turn produced.
// Math.max, not a replacement, so a configured idleMs longer than the peer bound still wins.
function nextIdleMs(state) {
  return state.activity === 'awaiting_peer' ? Math.max(state.idleMs, AWAITING_PEER_IDLE_MS) : state.idleMs;
}
// M2 — how long a PARKED session waits to be come back to before it ends (see ABANDONED_MS).
// Same Math.max discipline: the abandonment bound can never come in under the idle TTL.
function nextAbandonMs(state) {
  return Math.max(state.idleMs, ABANDONED_MS);
}

// M2 — THE WHOLE TIMER DECISION, in one place, because it is a fact about the STATE and not about
// the timer plumbing: how long to wait, and which event that wait produces. session-engine's
// scheduleIdle is one clearTimeout + one setTimeout over exactly this, so a PARKED session can
// only ever be armed with the abandonment bound and a live one only ever with the idle TTL —
// there is no second timer to leak, and a wake's own scheduleIdle overwrites a park's arm.
// C-4: a session that has not yet emitted `system/init` is neither idle nor parked — it is
// LAUNCHING, and the only honest bound for it is "how long may a launch take". It is checked
// FIRST because `parked` is false and `activity` is 'working' on a launching state, so both
// branches below would otherwise arm a fifteen-minute idle TTL for a child that may never
// speak. `inactive` is the calm terminal (see session-effects.endLifecycle): it settles the
// session the way every other terminal path does, posts the status note, and frees the slot.
function idleTimeout(state) {
  if (state.phase === 'launching') return { ms: LAUNCHING_MS, type: 'inactive' };
  return state.parked === true
    ? { ms: nextAbandonMs(state), type: 'abandon_timeout' }
    : { ms: nextIdleMs(state), type: 'idle_timeout' };
}
function turnCapReached(state) {
  return state.turns >= state.turnCap;
}
function costCapReached(state) {
  return state.costCapUsd > 0 && state.costUsd >= state.costCapUsd;
}

// ─── END SESSION-STATE ───────────────────────────────────────────────────────

module.exports = {
  DEFAULT_TURN_CAP,
  OPERATOR_TURN_CAP, // 9a: the depth-0 default; also what the SDK runaway backstop is sized against
  defaultTurnCap, // 9a: issuer -> default cap. `settings.js › getTurnCap` is still the authority
  UNLIMITED_TURN_CAP, // 9b: what the operator's 0 means INSIDE the engine (never on disk)

  DEFAULT_IDLE_MS,
  DEFAULT_COST_CAP_USD,
  AWAITING_PEER_IDLE_MS, // M1: the bound a turn that posted waits under
  ABANDONED_MS, // M2: the bound a PARKED session ends under
  LAUNCHING_MS, // C-4: the bound a launch that never emitted system/init ends under
  TOOL_MODES,
  MESSAGE_MODES,
  coerceMode,
  initialSessionState,
  nextIdleMs,
  nextAbandonMs,
  idleTimeout, // M2: {ms, type} — the ONE timer decision the engine arms
  turnCapReached,
  costCapReached,
};
