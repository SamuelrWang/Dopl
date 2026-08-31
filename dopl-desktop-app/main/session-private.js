// THE PRIVATE TURN — a 1:1 exchange between the operator and their own agent (2026-08-22,
// Samuel's ruling).
//
// WHAT IT IS. The operator types into the agent view's composer; `session-reopen.js ›
// messageByTask` dispatches a `steer`. The agent's answer to THAT turn is for the operator
// alone: it is the turn's final text, rendered in the agent view, and it must not become a
// channel post. The framing says so (`session-seed.js › frameOperatorTurn`) — and a prompt is a
// request, so this file is the ENFORCEMENT.
//
// ⚠ THE PROMPT IS NOT THE GATE, AND THAT DISTINCTION IS THE WHOLE RULING. Every other
// "the agent must not X" in this tree that mattered has ended up with a mechanism behind it:
// the forced thread tag exists because "a correct prompt is not enough — the agent simply
// omitted the argument" (`session-outbound-tag.js`'s incident header). An accidental public
// reply to a private question is worse than an untagged post: it is the operator's private words
// answered in front of the counterparty, and it cannot be recalled.
//
// ── THE GATE: SUSPEND THE OUT-HALF WIDENING, KEEP THE IN-HALF ────────────────────────────
//
// While a private turn is active, AXIS B's OUTBOUND widening is withdrawn: `auto_both` reads as
// `auto_inbound`, `auto_outbound` reads as `ask`. Any `dopl_channel` post or milestone the agent
// attempts therefore reaches `grantDecision`'s `return 'gate'`, and in a windowless session a
// gate BRIDGES to an outbound consent row (`session-windowless.js › bridgeOutbound`) plus a
// notification. So an accidental public reply is impossible, while a post the operator ASKED for
// is still possible — they approve the bytes they were shown. That is the shape the ruling wants:
// not "cannot post", but "cannot post WITHOUT you".
//
// ⚠ ONE STANDING EXCEPTION SINCE 2026-08-31 (Samuel's ruling, stated in full at
// `autoSendMessageMode`): a channel whose durable AUTO-SEND toggle is ON has consented,
// channel-wide and explicitly, to its agents posting with no click — so `effectiveMessageMode`
// reads that toggle LIVE and FIRST, and the withdrawal below applies only while it is off.
//
// ⚠ THE IN-HALF IS DELIBERATELY LEFT ALONE, WHICH IS A CONSIDERED DEVIATION FROM "as if message
// mode were `ask`". `ask` gates own-channel READS too (`isOwnChannelRead` follows the INBOUND
// half), and in a windowless session a gated read is a DENIED read — there is no surface to
// answer it on. An agent asked "what did they say in that thread?" would be unable to look. The
// ruling is about what LEAVES the machine; reads send nothing.
//
// ── THE WINDOW: WHICH TURNS ARE COVERED, AND WHY IT IS A DEPTH RATHER THAN A FLAG ─────────
//
// A `steer` is pushed with `priority: 'next'`, so it QUEUES behind a turn already in flight
// rather than interrupting it. A plain boolean set at dispatch time would therefore gate the
// wrong turn — the channel turn in flight — and then be CLEARED by that turn's `result`, leaving
// the private turn itself ungated. That is the exact failure this exists to prevent, arrived at
// by being careless about ordering.
//
// So the window is a DEPTH, decremented by each turn end:
//   agent IDLE      +1  the pushed message IS the next turn; its `result` closes the window.
//   agent WORKING   +2  the in-flight turn's `result` spends one, leaving the private turn
//                       covered by the second.
// ⚠ THE `+2` DELIBERATELY OVER-COVERS BY ONE TURN, and the direction is the safe one: a channel
// turn that happened to be in flight when the operator typed also has its posts held for
// approval. It is bounded to that single turn, the operator is by definition at the keyboard,
// and the alternative failure is a private answer posted in public.

const { privateTurnMessageMode } = require('./session-profiles');

// ─── BEGIN SESSION-PRIVATE-PURE (pure; unit-tested via source extraction) ────────

/** Is a turn running right now? ⚠ `awaiting_permission` counts: the SDK is blocked mid-turn on
 *  a `canUseTool` promise, so the turn has not ended and its `result` is still to come. */
function turnInFlight(state) {
  const a = (state || {}).activity;
  return a === 'working' || a === 'awaiting_permission';
}

/**
 * OPEN the window for a message just pushed. Returns the new depth.
 * ⚠ IT ADDS RATHER THAN SETS, so two 1:1 messages in a row each get their own covered turn.
 *
 * ⚠ THE `+2` DOUBLE-COUNTED WHEN THE IN-FLIGHT TURN WAS ALREADY PRIVATE (2026-08-22, the confirmed
 * root cause of the posture degradation). The extra unit exists to cover a CHANNEL turn that
 * happened to be running when the operator typed — that turn's `result` spends one, leaving the
 * private turn covered by the second. But when the turn in flight is ITSELF private, its own
 * depth is already paying for it: adding two spends one on a turn that was already counted, and
 * the surplus never drains. Two 1:1 messages sent while the agent was working therefore left the
 * session at depth 3 with two turns to run, and every CHANNEL turn after that had AXIS B's
 * outbound widening withdrawn — the agent silently unable to auto-send, on a session nobody had
 * made private.
 * ⚠ THE DIRECTION OF THE REMAINING OVER-COVER IS UNCHANGED AND STILL DELIBERATE: a NON-private
 * turn in flight still costs +2, because the alternative failure is a private answer posted in
 * public.
 */
function openPrivateTurn(s, wasInFlight) {
  if (!s) return 0;
  // 🔒 **THE WINDOW IS OPENED AFTER THE DISPATCH SINCE 2026-08-31, AND `wasInFlight` IS WHAT
  // MAKES THAT POSSIBLE** (adversarial review; F-372).
  //
  // THE DEFECT: a `steer` at a PARKED session makes the reducer emit `resumeQuery` BEFORE
  // `pushTurn`, and `session-park.js › resumeParked` calls `resetPrivateTurn` — so a window
  // opened before the dispatch was WIPED by the wake that same message triggered, and the turn
  // ran with AXIS B's outbound widening intact. An accidental public reply became possible,
  // which is the one thing this file exists to prevent. An IDLE agent is the ordinary target of
  // both the operator's composer and a direction, so this was the common path.
  //
  // ⚠ OPENING AFTERWARDS IS STILL BEFORE ANY `result` CAN ARRIVE: `dispatch` is synchronous and
  // only PUSHES onto the iterator, so the SDK cannot have answered by then.
  // ⚠ THE CALLER MUST READ `wasInFlight` BEFORE the dispatch, because the dispatch moves
  // activity to `working` and the state can no longer answer the question afterwards.
  // ⚠ ABSENT FALLS BACK TO READING THE STATE, so the pre-2026-08-31 one-argument call keeps its
  // exact behaviour and no other caller had to move.
  const inFlight = wasInFlight === undefined ? turnInFlight(s.state) : wasInFlight === true;
  const add = (inFlight && !isPrivateTurn(s)) ? 2 : 1;
  s.privateDepth = (Number(s.privateDepth) || 0) + add;
  return s.privateDepth;
}

/**
 * A QUERY WAS TORN DOWN: the window closes outright. ⚠ A torn-down query OWES NO RESULTS — its
 * consume loop is superseded by `session-query.js`'s `s.query !== q` guard, so the `result` events
 * that would have spent this depth are dropped on the floor. Without this, a park, an auth hold, a
 * crash or an operator End left the surplus behind on a session that is resumable, and the NEXT
 * private turn opened on top of it. Called from the `abortQuery` / `denyPending` effects
 * (`session-engine.js`) and from `session-park.js › resumeParked`, which rebuilds the query.
 */
function resetPrivateTurn(s) {
  if (!s) return 0;
  s.privateDepth = 0;
  return 0;
}

/**
 * A turn ENDED: spend one of the window. ⚠ Floored at zero — a stray `result` (the drained tail
 * of a superseded query) must never push the depth negative and make the NEXT private turn read
 * as already closed.
 */
function closePrivateTurn(s) {
  if (!s) return 0;
  const next = (Number(s.privateDepth) || 0) - 1;
  s.privateDepth = next > 0 ? next : 0;
  return s.privateDepth;
}

/** Is the CURRENT turn private? The one question the gate and the narration tag both ask. */
function isPrivateTurn(s) {
  return (Number(s && s.privateDepth) || 0) > 0;
}

/**
 * THE CHANNEL AUTO-SEND TOGGLE, APPLIED LIVE — the OUT half forced on, the IN half kept
 * (2026-08-31, Samuel's ruling: "if a user toggles auto-send, that goes into effect for ALL
 * their agents in that channel, IMMEDIATELY").
 *
 * ⚠ THE RULING THIS SUPERSEDES, STATED RATHER THAN BURIED: while the channel's toggle is ON,
 * the 2026-08-22 private-turn withdrawal below DOES NOT APPLY — a post drafted inside a 1:1
 * panel turn leaves the machine with no Send click, which is exactly the accident case that
 * ruling closed. Samuel chose it with the trade-off on the table: the toggle is the channel-wide
 * consent ("my agents in this room post without me"), it is OFF by default, and OFF restores
 * the withdrawal in full. What made the old layering worse than the exposure was that it was
 * ILLEGIBLE — the operator flipped a switch that then did not apply on the very lane (panel
 * direction) they actually drive agents from, and nothing anywhere said why.
 *
 * ⚠ IN-HALF PRESERVED, JUNK FAIL-CLOSED: an unknown mode maps to `auto_outbound`, whose IN half
 * is `ask` — the toggle's whole meaning is the OUT half and it must not smuggle inbound consent.
 */
function autoSendMessageMode(mode) {
  return (mode === 'auto_inbound' || mode === 'auto_both') ? 'auto_both' : 'auto_outbound';
}

/**
 * AXIS B AS THE GATE SHOULD SEE IT for this session, right now.
 * ⚠ `session-io.js › grantArgs` is the ONE caller, so this is the single point where a private
 * turn changes what a tool call is allowed to do — every other posture read is untouched, and
 * AXIS A (the TOOL axis) is not consulted here at all, which keeps the v2.9 invariant intact:
 * a message op branches to Axis B and never reaches Axis A.
 *
 * ⚠ THE CHANNEL TOGGLE IS READ **LIVE AND FIRST** (2026-08-31). Auto-send used to be frozen
 * into `state.messageMode` at launch (`channel-prefs.js › windowlessMessageMode`), which gave
 * the toggle FOUR silent ways to not be in effect: a reopened/recreated shell drops its
 * startModes (H2), a crash resume floors them, a running session never re-reads the store, and
 * a private turn withdrew the half the toggle had granted. Reading it here — the single Axis-B
 * read at decision time — makes the switch mean what it says on every spawn shape and every
 * turn shape at once, ON and OFF alike. `channelAutoSend` is the live half below the pure
 * block; in an environment with no store it answers false, which is not a grant.
 */
function effectiveMessageMode(s) {
  const mode = (s && s.state && s.state.messageMode) || 'ask';
  if (channelAutoSend(s && s.channelId)) return autoSendMessageMode(mode);
  return isPrivateTurn(s) ? privateTurnMessageMode(mode) : mode;
}

// ─── END SESSION-PRIVATE-PURE ────────────────────────────────────────────────────

/**
 * THE LIVE HALF — the channel's durable auto-send switch, read at DECISION time.
 * ⚠ LAZY-REQUIRED, exactly like `session-directed.js › observe` reaches `agent-directions.js`:
 * `channel-prefs.js` instantiates an electron-store at load, and this module is required by
 * plain-node tests that must keep working. A failed require answers `false` — an unreadable
 * store is not a grant, the same rule every reader of that store follows.
 */
function channelAutoSend(channelId) {
  if (!channelId) return false;
  try {
    return require('./channel-prefs').getAutoSend(channelId) === true;
  } catch (_err) {
    return false;
  }
}

module.exports = {
  turnInFlight,
  openPrivateTurn,
  closePrivateTurn,
  resetPrivateTurn, // 2026-08-22: a torn-down query owes no results — the window closes with it
  isPrivateTurn,
  autoSendMessageMode, // 2026-08-31: the toggle's OUT-half widening, one spelling
  effectiveMessageMode,
};
