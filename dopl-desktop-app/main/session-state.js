// The session STATE SHAPE: defaults, `initialSessionState`, the timer readers and the mode tables. Every
// decision stays in session-reducer.js; this pure block is prepended to the reducer's by the extraction tests.

// ─── BEGIN SESSION-STATE (pure; unit-tested via source extraction) ───────────

// The idle TTL parks a stalled session (resumable). There are no turn or cost caps; the SDK's own
// `maxTurns` backstop lives in the Claude launch spec.
const DEFAULT_IDLE_MS = 15 * 60 * 1000;

// A session waiting on the peer is not idle: a longer bound, not suppression (a reply may never come) (M1).
const AWAITING_PEER_IDLE_MS = 4 * 60 * 60 * 1000;

// A PARKED session nobody comes back to ENDS (terminal, so nothing can wake it) (M2).
const ABANDONED_MS = 12 * 60 * 60 * 1000;

// The launch watchdog (C-4): a child that never emits init must end. It must exceed
// `mcp-config.MCP_CLIENT_TIMEOUT_MS` (290s) so a launch is never declared dead while the transport can recover.
const LAUNCHING_MS = 5 * 60 * 1000;

// Axis A is the SESSION runtime's list, handed in at spawn as `toolModes` (narrowest first); this is only the
// fallback for a caller that names none (the default runtime's list). Axis B is Dopl's on every runtime.
const TOOL_MODES = ['manual', 'accept_edits', 'auto', 'bypass'];
const MESSAGE_MODES = ['ask', 'auto_inbound', 'auto_outbound', 'auto_both'];
function coerceMode(list, value) {
  // [0] is the most restrictive.
  return list.indexOf(value) === -1 ? list[0] : value;
}
function toolModesOf(state) {
  const list = state && state.toolModes;
  return Array.isArray(list) && list.length ? list : TOOL_MODES;
}

// The runtime's native launch settings, copied (never aliased), string values only: an absent or junk
// entry is dropped so the runtime's own default applies. Core never looks inside.
function nativeBag(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw)) if (typeof raw[key] === 'string' && raw[key]) out[key] = raw[key];
  return out;
}

// Fresh state for a launching session; an absent or invalid value falls back to the fail-closed default.
function initialSessionState(opts) {
  const o = opts || {};
  const toolModes = toolModesOf(o).slice();
  // C2: a PINNED start posture is the session's own pick (a directive's narrower ask); the caller clamps it.
  const pinTools = o.pinned === true || !!(o.pinned && o.pinned.tools === true);
  const pinMessages = o.pinned === true || !!(o.pinned && o.pinned.messages === true);
  const toolMode = coerceMode(toolModes, o.toolMode);
  const messageMode = coerceMode(MESSAGE_MODES, o.messageMode);
  const idleMs = Number.isFinite(o.idleMs) && o.idleMs > 0 ? o.idleMs : DEFAULT_IDLE_MS;
  return {
    phase: 'launching',
    mode: o.mode === 'autonomous' ? 'autonomous' : 'interactive',
    side: o.side === 'requester' ? 'requester' : 'responder',
    turns: 0,
    idleMs: idleMs,
    pendingPermissions: [],
    allowForTask: [],
    // The two axes as stamped: Axis A in the session runtime's words (never a message op), Axis B what crosses
    // between machines (never a work tool). The gate reads live on top (`session-private.js`). Never persisted.
    toolModes: toolModes,
    toolMode: toolMode,
    // C2 "narrower sticks": `*ModeSet` marks a per-agent pick held in `*Pick`; a channel fan-out never sets it.
    toolModeSet: pinTools,
    toolPick: pinTools ? toolMode : '',
    messageMode: messageMode,
    messageModeSet: pinMessages,
    messagePick: pinMessages ? messageMode : '',
    // Stamped at spawn, never read live: a sandbox that could change under a running turn is not a fence.
    native: nativeBag(o.native),
    // The standing inbound grant ("Accept for this session"); never persisted.
    inboundForTask: false,
    hasPendingInbound: false,
    // P1: the query is torn down but the session object survives, so a turn can lazily resume it. Distinct from
    // `phase` because a parked session holding a reply sits at `awaiting_inbound` (FIX #6).
    parked: false,
    // H1: held on a sign-in; parked but NOT woken by an inbound turn (no credential to spawn with).
    authHeld: false,
    activity: 'working',
    postedThisTurn: false,
    // FIX F3: this turn's post ids, so a denied post's failing result un-counts it.
    postedToolUseIds: [],
  };
}

// `awaiting_peer` is set for exactly the turn that posted; Math.max so a longer configured TTL still wins.
function nextIdleMs(state) {
  return state.activity === 'awaiting_peer' ? Math.max(state.idleMs, AWAITING_PEER_IDLE_MS) : state.idleMs;
}
function nextAbandonMs(state) {
  return Math.max(state.idleMs, ABANDONED_MS);
}

// THE timer decision: how long, and which event it produces. `launching` is checked FIRST (a launching
// state is neither parked nor idle-looking), so a child that never speaks gets the watchdog, not the TTL.
function idleTimeout(state) {
  if (state.phase === 'launching') return { ms: LAUNCHING_MS, type: 'inactive' };
  return state.parked === true
    ? { ms: nextAbandonMs(state), type: 'abandon_timeout' }
    : { ms: nextIdleMs(state), type: 'idle_timeout' };
}

// ─── END SESSION-STATE ───────────────────────────────────────────────────────

module.exports = {
  DEFAULT_IDLE_MS,
  AWAITING_PEER_IDLE_MS,
  ABANDONED_MS,
  LAUNCHING_MS,
  TOOL_MODES,
  MESSAGE_MODES,
  coerceMode,
  toolModesOf,
  initialSessionState,
  nextIdleMs,
  nextAbandonMs,
  idleTimeout,
};
