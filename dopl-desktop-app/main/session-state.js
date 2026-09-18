// Session STATE SHAPE — the fields a session carries, their defaults, and the caps read off
// them (v1.9 Session Window, Track T1).
//
// §2 SPLIT (2026-07-31): session-reducer.js sits in the ENGINEERING.md §2 zero-headroom cluster
// and the inbound gate needed one more conjunct. Same seam session-effects.js took: a PURE block,
// required by the reducer at module scope ABOVE its own sentinel, so inside the reducer's block
// these are free vars and test/_reducer-block.mjs concatenates the three blocks back into exactly
// the standalone program the truth tables have always evaluated.
//
// WHAT LIVES HERE is what a fresh session looks like and when it has run out of room: the
// loop-safety defaults, `initialSessionState`, the three cap / timer readers, and the two MODE
// TABLES the state defends itself with. Every DECISION stays in session-reducer.js, because a
// state shape and a state machine are two different things to change.
//
// PURE: no electron / SDK / fs / path / crypto reference anywhere in the block below.

// ─── BEGIN SESSION-STATE (pure; unit-tested via source extraction) ───────────

// Loop-safety defaults (contract §A.2). The idle TTL parks a stalled session (task stays open,
// resumable). It is the only one of the three left.
//
// THE TURN CAP AND THE COST CAP ARE DELETED (2026-09-07, Samuel's ruling): nothing in this app now
// ends a session for running too long or spending too much. Removed with them, so nobody rebuilds
// it by halves: `DEFAULT_TURN_CAP`, `OPERATOR_TURN_CAP`, `defaultTurnCap`, `UNLIMITED_TURN_CAP`,
// `DEFAULT_COST_CAP_USD`, the `turnCap` / `costCapUsd` state fields, `turnCapReached` /
// `costCapReached`, and their enforcement at every `result` event in `session-reducer.js`.
//
// The one bound that survives is not a ceiling and must not be turned back into one:
// `runtime/claude/launch-spec.js › SESSION_MAX_TURNS` is the SDK runaway backstop for the case the
// reducer never could see — a query that stops producing `result` events. It was DERIVED from
// `OPERATOR_TURN_CAP` and is now a literal 8000; left derived, this deletion would have made it
// `NaN`, and `maxTurns: NaN` is no bound at all.
const DEFAULT_IDLE_MS = 15 * 60 * 1000; // 15 minutes

// M1 (2026-08-05) — A SESSION WAITING ON THE PEER IS NOT AN IDLE SESSION. Every turn end armed the
// 15-minute TTL, including the turn that had just posted into the channel — the one the reducer
// itself labels `awaiting_peer`. A counterparty's agent routinely takes longer than fifteen
// minutes, so the exchange parked mid-flight, the park reset the posture, the peer's reply woke it,
// and the next tool call asked: the whole of "I set bypass and it still asks me".
//
// A LONGER BOUND AND NOT SUPPRESSION: suppressing the timer while awaiting a peer leaves a live SDK
// query, its push iterator and its awaited `canUseTool` promises alive FOREVER when the reply never
// comes. Four hours is ~16x the 15-minute TTL and one to two orders of magnitude above a real agent
// turn, so it cannot fire inside a live exchange.
const AWAITING_PEER_IDLE_MS = 4 * 60 * 60 * 1000; // 4 hours

// M2 (2026-08-05) — what a GENUINELY abandoned session does, measured from the park. The park used
// to reset both axes and every standing grant; Samuel's contract is that operator intent survives
// the session, so the reset is gone (see session-reducer's `idle_timeout` branch for where that
// reasoning was re-sited). This replacement is a STRICTER guard: a session nobody has come back to
// does not sit dormant at bypass waiting to be woken by a peer, it ENDS. `phase: 'ended'` is
// terminal in the reducer, so nothing can wake it; a later peer reply recreates a dormant shell
// from the durable record, starting at manual/ask like every other wake nobody approved (FIX 1b).
// Twelve hours is 48x the park TTL and 3x the awaiting-peer bound, so a session parked at the end
// of a working day ends overnight and one parked over a lunch break is still there, still armed.
const ABANDONED_MS = 12 * 60 * 60 * 1000; // 12 hours

// C-4 (2026-08-08) — THE LAUNCH WATCHDOG. `startSession` set `idleTimer: null` and the timer was
// armed ONLY by reducer effects that require `launched`, which only the SDK's `system/init`
// dispatches. A child that booted and never emitted one therefore sat at phase 'launching' with NO
// timer: `hasLiveSession` stayed true, every retry answered `{skipped:'busy'}`, the slot counted
// against MAX_WINDOWS forever, and no `task_started` was posted — no path out but quitting the app.
//
// FIVE MINUTES IS NOT A GUESS. Three constants already in this tree bracket it, and the test pins
// the relations rather than the literal (the mcp-client-timeout.test.mjs precedent):
//   `mcp-config.MCP_CLIENT_TIMEOUT_MS` = 290s — the longest a single MCP request may hold before
//     this process's own client aborts it. The watchdog must sit ABOVE it, or a launch could be
//     declared dead while the transport's own abort was the thing about to unstick it.
//   `mcp-config.HOLD_MARGIN_MS` = 60s — this repo's price for "auth + MCP boot + the workspace
//     handshake", i.e. the work between spawning the child and `system/init`. Five minutes is 5x.
//   `session-spawner.MAX_RUNTIME_MS` = 300s — the headless lane's existing answer to the same
//     question; matching it keeps ONE answer across both lanes.
// And it is 1/3 of DEFAULT_IDLE_MS, so a launch timeout can never be confused with the idleness of
// a session that DID start.
const LAUNCHING_MS = 5 * 60 * 1000; // 5 minutes

// v2.9 THE MODE TABLES, duplicated ON PURPOSE: session-profiles.js is canonical, but this block is
// evaluated standalone (source extraction) and is the STATE OWNER, so it defends its own field
// fail-closed — for a mid-session change AND for the v3.1 preset it starts from.
// test/session-permission-axes pins the copies (here, session-profiles, the preload, the renderer).
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
  // 2026-09-07: `o.turnCap` / `o.costCapUsd` from an older persisted record are ignored rather than
  // migrated, because nothing reads them any more.
  const idleMs = Number.isFinite(o.idleMs) && o.idleMs > 0 ? o.idleMs : DEFAULT_IDLE_MS;
  return {
    phase: 'launching',
    mode: o.mode === 'autonomous' ? 'autonomous' : 'interactive',
    side: o.side === 'requester' ? 'requester' : 'responder',
    // Still COUNTED, no longer enforced (2026-09-07): the window and the context meter read these;
    // nothing ends a session on either number now.
    turns: 0,
    costUsd: 0,
    idleMs: idleMs,
    pendingPermissions: [], // requestIds awaiting a button (models a Set)
    allowForTask: [], // scoped grant KEYS granted for the task (models a Set); cleared on park
    // v2.9 THE TWO AXES (session-profiles owns the tables + the resolution). toolMode = AXIS A
    // (manual|accept_edits|auto|bypass): what MY agent may do on THIS machine, NEVER a message op.
    // messageMode = AXIS B (ask|auto_inbound|auto_outbound|auto_both): what crosses between
    // machines, NEVER a work tool. Per-session, never persisted, RESET on park (v2.3 FIX #3). v3.1:
    // the START may come from the channel preset, coerced fail-closed here.
    toolMode: coerceMode(TOOL_MODES, o.toolMode),
    // 2026-09-16: FALSE AT EVERY SPAWN, including one handed a posture. `spec.startModes` is a
    // launch DEFAULT (the operator's stored pair, or a directive's narrower request); this flag
    // marks only a LIVE `set_tool_mode` from the agent view, which is what makes an inherited
    // posture re-readable from the channel record and a deliberate per-agent pick sticky. The
    // reducer's `set_tool_mode` arm is its one producer. Never persisted, like both axes.
    toolModeSet: false,
    messageMode: coerceMode(MESSAGE_MODES, o.messageMode),
    // v2.5 D1/D4: the standing INBOUND grant ("Accept for this session") — when true an inbound turn
    // is fed with no Accept. Never persisted, and reset on park with the two axes (MEDIUM-3 / C9),
    // so a peer cannot restart a parked query and drive turns with the operator away.
    inboundForTask: false,
    hasPendingInbound: false,
    // P1 (v1.7.4): true while the session is PARKED — the live SDK query is torn down but the
    // session object + window survive, so an inbound turn or operator input can lazily resume it.
    // Never persisted. Distinct from `phase` because a parked session HOLDING a reply sits at phase
    // 'awaiting_inbound' (FIX #6) yet still needs a resume on Accept.
    parked: false,
    // H1: TRUE while the session is held on "Sign in to Claude". A held session is PARKED but,
    // unlike an idle park, must NOT be woken by an inbound turn — there is no credential to spawn
    // with. It lives on STATE because wakeEffects and inboundAutoAccepted, the two places that
    // decide whether to spawn, can only see state. Never persisted.
    authHeld: false,
    // Item 3: the coarse activity the status pill shows (working|idle|awaiting_peer|awaiting_
    // permission|awaiting_inbound). A launching/running session is `working`; `postedThisTurn`
    // records whether the agent posted this turn, so turn-end can pick `awaiting_peer` vs `idle`.
    activity: 'working',
    postedThisTurn: false,
    // ── THE CONTEXT METER (2026-08-02) ──────────────────────────────────────────────────
    // What the last finished turn measured, so a window RELOAD and a P2 recreate repaint from one
    // place. `model` is what the SDK says is really running (never the operator's PICK, which lives
    // on the session object as `s.model`) and moves mid-session when the picker calls
    // Query.setModel. `contextWindow` is null whenever this build does not know that model's size,
    // and the renderer then shows tokens with NO percentage — a made-up denominator on the gauge
    // that decides "start a fresh session" is worse than no gauge. None of the three is persisted.
    model: null,
    contextTokens: 0,
    contextWindow: null,
    // FIX F3: the tool_use ids of the posts that streamed THIS turn. The outbound bubble is
    // emitted BEFORE canUseTool resolves, so a denied post must be un-counted when its failing
    // tool_result lands; else the turn ends "Waiting for reply" on a message that never left.
    postedToolUseIds: [],
  };
}

// Idle timer duration (§A.2). M1 (2026-08-05): `awaiting_peer` is set by the reducer's `result`
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
// scheduleIdle is one clearTimeout + one setTimeout over exactly this, so a PARKED session can only
// be armed with the abandonment bound and a live one only with the idle TTL — no second timer to
// leak. C-4: `launching` is checked FIRST because `parked` is false and `activity` is 'working' on
// a launching state, so both branches below would otherwise arm a fifteen-minute idle TTL for a
// child that may never speak. `inactive` is the calm terminal (session-effects.endLifecycle).
function idleTimeout(state) {
  if (state.phase === 'launching') return { ms: LAUNCHING_MS, type: 'inactive' };
  return state.parked === true
    ? { ms: nextAbandonMs(state), type: 'abandon_timeout' }
    : { ms: nextIdleMs(state), type: 'idle_timeout' };
}
// 2026-09-07: `turnCapReached` and `costCapReached` are deleted with the caps. `state.turns` and
// `state.costUsd` are STILL COUNTED — the context meter's and the window's numbers — but end
// nothing.

// ─── END SESSION-STATE ───────────────────────────────────────────────────────

module.exports = {
  // 2026-09-07: the five cap exports are deleted with the caps themselves.
  DEFAULT_IDLE_MS,
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
};
