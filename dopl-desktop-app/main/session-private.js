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

// ⚠ `floorWindowlessMessage` JOINED ON 2026-09-06 (item 8) — the SAME function
// `channel-prefs.js` applies at launch, asked here rather than re-spelled, because the live
// read of the channel's Messaging value gets an UNFLOORED posture and a windowless session
// cannot run on one. Two spellings of one floor is how one lane starts holding messages the
// other lane releases (`session-profiles.js`'s own warning over that function).
// ⚠ `autoOutboundMode` JOINED ON 2026-09-06 (Samuel's full-auto ruling) — the SAME predicate
// `grantDecision` asks about the out half, so "does this posture consent to posting" has one
// answer on both sides of the gate rather than a local re-spelling here.
const {
  privateTurnMessageMode, floorWindowlessMessage, autoOutboundMode,
} = require('./session-profiles');

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
// ⚠ **`autoSendMessageMode` IS DELETED (2026-09-06, item 8), WITH THE RECORD IT SERVED.**
//
// It forced Axis B's OUT half on over whatever the stored posture said — the mechanism by which
// the auto-send toggle overrode Messaging. There is nothing left to force: Messaging IS the
// posture now, so an operator who wants the out half picks it, and `effectiveMessageMode` reads
// that pick live. A function that widens a posture the operator did not choose is exactly what
// this item removed, and keeping it "for the tests" would leave the mechanism one call away.
//
// Deleted alongside `channel-prefs.getAutoSend` / `setAutoSend`, the two `channels:*AutoSend`
// IPC handlers and the web hook. `test/session-autosend-live.test.mjs` is rewritten against
// `effectiveMessageMode`'s live read of Messaging in the same change.

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
/**
 * ── ⚠ 2026-09-06: THE AUTO-SEND TOGGLE IS GONE AND **MESSAGING** IS THE LIVE READ ──────────
 *
 * (Samuel's settings overhaul, item 8: the separate Replies toggle is removed and folds into
 * the Messaging control.) The LIVE-read seam this function is built on is UNCHANGED — that is
 * the whole point of the fold, and it is why the fold is safe: the 2026-08-31 ruling's real
 * content was *"if a user toggles auto-send, that goes into effect for ALL their agents in that
 * channel, IMMEDIATELY"*, and that property belonged to the READ SITE, not to the record. So the
 * record changes and the site does not.
 *
 * ⚠ WHY THE TWO CONTROLS COULD NOT BOTH SURVIVE. They set the same axis and disagreed by
 * construction: Messaging was frozen into `state.messageMode` at launch, auto-send was read here
 * at decision time, and `autoSendMessageMode` FORCED the out half on over whatever Messaging
 * said. An operator could set Messaging to `ask` and still have agents posting unattended, with
 * nothing on the tab explaining which one was in force.
 *
 * ⚠ THE STORED CHANNEL VALUE IS READ FIRST, AND `state.messageMode` IS THE FALLBACK, NOT THE
 * OTHER WAY ROUND. The stored value is what the operator can see and change RIGHT NOW; the
 * frozen one is a snapshot of what they had set when this session spawned. Preferring the
 * snapshot would re-introduce the four silent ways this function's own header lists for a
 * setting to not be in effect (a reopened shell drops its startModes, a crash resume floors
 * them, a running session never re-reads the store). An unreadable store falls back to the
 * frozen value rather than to a grant.
 *
 * ── ⚠ **AUTO MEANS FULL AUTO — SAMUEL'S RULING, 2026-09-06** ────────────────────────────────
 *
 * *"If the user puts auto let's just have it full auto."*
 *
 * An OUT-half posture (`auto_outbound` / `auto_both`) DEFEATS the 2026-08-22 private-turn
 * withdrawal, exactly as the deleted auto-send toggle did. A reply drafted inside a private panel
 * turn leaves the machine with no Send click.
 *
 * ⚠ THIS OVERTURNS THE FOLD'S OWN FIRST DRAFT, AND THE ARGUMENT AGAINST IT IS RECORDED RATHER
 * THAN DELETED — it is a real cost and a later reader is owed it. Item 8 shipped for one day with
 * the withdrawal applying ALWAYS, on the reasoning that the operator's own private words leaving
 * the machine unclicked is the narrowest consent point there is, and that the LEGIBILITY argument
 * behind the 2026-08-31 trade was spent once there was a single live control. Samuel weighed that
 * and ruled the other way: a posture that says "auto" and then holds a draft is the surprise, and
 * the surprise is worse than the exposure. The setting is explicit, it is the operator's own, and
 * it is one control now — so "auto" means what it says on every lane.
 *
 * ⚠ WHAT IS *NOT* WIDENED, AND THIS IS WHY THE RULING IS NARROW RATHER THAN A REPEAL. Only the
 * OUT half defeats the withdrawal. `ask` and `auto_inbound` carry no out-half consent, so a
 * private turn on those postures still withdraws exactly as 2026-08-22 wrote it — and the IN half
 * is preserved on every path, so an agent asked a private question about a thread can still go
 * and look at it.
 */
function effectiveMessageMode(s) {
  const frozen = (s && s.state && s.state.messageMode) || 'ask';
  const stored = channelMessageMode(s && s.channelId);
  // ⚠ **THE WINDOWLESS FLOOR IS RE-APPLIED HERE, AND LEAVING IT OFF WOULD HAVE BEEN F-236
  // REACHED FROM THE OTHER END.** The stored value is the operator's PICK and carries no floor;
  // the frozen value had one applied at launch (`channel-prefs.js › windowlessMessageMode`).
  // A windowless session has no Accept surface, so an un-floored `ask` here would gate its
  // own-channel READS — and in a windowless session a gated read is a DENIED read. Reading the
  // store live without re-flooring would therefore have made every windowless agent unable to
  // look at the thread it was answering, on channels whose posture is `ask`, which is the
  // default. ⚠ ONE STATEMENT OF THE FLOOR: `session-profiles.js › floorWindowlessMessage` is
  // the same function `channel-prefs.js` applies at launch, asked here rather than re-spelled
  // (`test/session-mode-floor.test.mjs` pins the two lanes against each other).
  const live = stored && s && s.windowless ? floorWindowlessMessage(stored) : stored;
  const mode = live || frozen;
  // ⚠ SAMUEL'S RULING, 2026-09-06 — *"If the user puts auto let's just have it full auto."* An
  // OUT-half posture is the operator's explicit, visible, channel-wide consent to their agents
  // posting with no click, so it defeats the private-turn withdrawal below. See the block above
  // for the argument this overturned and why it is recorded rather than deleted.
  //
  // ⚠ **IT IS THE CHANNEL'S LIVE VALUE THAT DEFEATS THE WITHDRAWAL, NOT THE RESOLVED MODE**, and
  // the difference is a grant. `live` is the setting the operator can SEE and change — the same
  // channel-wide consent the deleted auto-send toggle was, read at the same decision point.
  // `mode` may be the session's FROZEN snapshot, reached only when the store answered nothing:
  // an unreadable store, or a channel nobody has configured. Testing `mode` here would let an
  // unreadable store hand a private turn FULL AUTO — the one thing this whole function's header
  // rules out ("an unreadable store falls back to the frozen value rather than to a grant"), and
  // the exposure the 2026-08-22 withdrawal exists to prevent. So the carve-out needs the consent
  // to be present, not merely inherited.
  if (live && autoOutboundMode(live)) return mode;
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
/**
 * THE LIVE HALF — the channel's durable MESSAGING value, read at DECISION time, or `''` when
 * there is none to read (2026-09-06, item 8; successor to `channelAutoSend`).
 *
 * ⚠ LAZY-REQUIRED for its predecessor's reason, unchanged: `channel-prefs.js` instantiates an
 * electron-store at load and this module is required by plain-node tests that must keep working.
 *
 * ⚠ **IT ANSWERS `''`, NOT A MODE, WHEN IT CANNOT READ.** An unreadable store, an absent channel
 * id and a channel that has never been configured are all "no opinion", and the caller falls back
 * to the session's frozen value. Answering a MODE here would make an unreadable store into a
 * posture — and the narrowest mode would be just as wrong as the widest, because it would
 * silently gag a correctly-configured channel the moment the store hiccuped.
 *
 * ⚠ IT IS COERCED BY THE STORE, NOT HERE. `channel-prefs.js › normalizePreset` validates the
 * axis against the frozen `MESSAGE_MODES` list on WRITE, so what comes back is already a member
 * or nothing. A second coercion here would be the two-readers-one-fact defect with a PERMISSION
 * AXIS as the thing that drifts.
 */
function channelMessageMode(channelId) {
  if (!channelId) return '';
  try {
    // ⚠ **PRESENCE FIRST, AND WITHOUT IT THIS FUNCTION CANNOT KEEP ITS OWN CONTRACT.**
    // `getLaunchPosture` NEVER ANSWERS NULL — it answers the stored pair or the RESTRICTIVE
    // DEFAULT (`channel-prefs.js`: "a durable setting that is absent IS manual/ask, and saying
    // so is the truth"), which is right for the Settings tab and wrong here. Read alone it makes
    // an UNCONFIGURED channel indistinguishable from one the operator deliberately set to `ask`,
    // so the default would win over the session's frozen launch posture on every channel nobody
    // has opened Settings for — the frozen value would be dead code and a session launched at
    // `auto_both` would gate. That is why the presence check comes first: it is the deleted
    // `getAutoSend`'s "no row = no opinion" property, restored on the record that replaced it.
    if (!require('./channel-prefs').hasLaunchPosture(channelId)) return '';
    const preset = require('./channel-prefs').getLaunchPosture(channelId);
    const mode = preset && preset.messages;
    return typeof mode === 'string' && mode ? mode : '';
  } catch (_err) {
    return '';
  }
}

module.exports = {
  turnInFlight,
  openPrivateTurn,
  closePrivateTurn,
  resetPrivateTurn, // 2026-08-22: a torn-down query owes no results — the window closes with it
  isPrivateTurn,
  // ⚠ `autoSendMessageMode` REMOVED 2026-09-06 (item 8) — see the block above it.
  effectiveMessageMode,
  channelMessageMode, // 2026-09-06: the live read of the channel's Messaging value, for the suite
};
