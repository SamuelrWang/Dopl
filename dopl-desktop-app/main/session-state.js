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

// Loop-safety defaults (contract §A.2). turn cap bounds a two-agent exchange; idle TTL ends a
// stalled session (task stays open, resumable); cost cap is opt-in (0 => disabled).
const DEFAULT_TURN_CAP = 24;
const DEFAULT_IDLE_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_COST_CAP_USD = 0; // 0 => disabled

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
  const turnCap = Number.isFinite(o.turnCap) && o.turnCap > 0 ? o.turnCap : DEFAULT_TURN_CAP;
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

// Idle timer duration (§A.2). Constant today; a hook for phase-aware backoff later.
function nextIdleMs(state) {
  return state.idleMs;
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
  DEFAULT_IDLE_MS,
  DEFAULT_COST_CAP_USD,
  TOOL_MODES,
  MESSAGE_MODES,
  coerceMode,
  initialSessionState,
  nextIdleMs,
  turnCapReached,
  costCapReached,
};
