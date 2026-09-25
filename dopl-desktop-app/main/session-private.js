// THE PRIVATE TURN — a 1:1 exchange between the operator and their own agent (2026-08-22,
// Samuel's ruling).
//
// The operator types into the agent view's composer; `session-reopen.js › messageByTask` dispatches
// a `steer`. The agent's answer to THAT turn is for the operator alone and must not become a
// channel post. The framing says so (`session-seed.js › frameOperatorTurn`) — and a prompt is a
// request, so this file is the ENFORCEMENT. An accidental public reply to a private question is the
// operator's private words answered in front of the counterparty, and it cannot be recalled.
//
// THE GATE: while a private turn is active, AXIS B's OUTBOUND widening is withdrawn — `auto_both`
// reads as `auto_inbound`, `auto_outbound` as `ask` — so any `dopl_channel` post or milestone
// reaches `grantDecision`'s `return 'gate'`, which on a windowless session bridges to an outbound
// consent row plus a notification. Not "cannot post", but "cannot post WITHOUT you". One standing
// exception since 2026-08-31 (stated in full at `effectiveMessageMode`): an out-half posture is the
// operator's explicit channel-wide consent and defeats the withdrawal.
//
// THE IN HALF IS DELIBERATELY LEFT ALONE, a considered deviation from "as if message mode were
// `ask`": `ask` gates own-channel READS too, and in a windowless session a gated read is a DENIED
// read, so an agent asked "what did they say in that thread?" would be unable to look. The ruling
// is about what LEAVES the machine; reads send nothing.
//
// THE WINDOW IS A DEPTH, NOT A FLAG. A `steer` is pushed with `priority: 'next'`, so it QUEUES
// behind a turn already in flight; a boolean set at dispatch time would gate the wrong turn and
// then be CLEARED by that turn's `result`, leaving the private turn itself ungated.
//   agent IDLE      +1  the pushed message IS the next turn; its `result` closes the window.
//   agent WORKING   +2  the in-flight turn's `result` spends one, leaving the private turn
//                       covered by the second.
// The `+2` over-covers by one turn, in the safe direction: a channel turn that happened to be in
// flight when the operator typed also has its posts held for approval.

// `floorWindowlessMessage` joined 2026-09-06 (item 8) — the SAME function `channel-prefs.js`
// applies at launch, asked here rather than re-spelled, because the live read of the channel's
// Messaging value gets an UNFLOORED posture and a windowless session cannot run on one.
// `autoOutboundMode` joined the same day — the SAME predicate `grantDecision` asks about the out
// half, so "does this posture consent to posting" has one answer on both sides of the gate.
const {
  privateTurnMessageMode, floorWindowlessMessage, autoOutboundMode,
  normalizeToolMode, normalizeMessageMode, toolModesFor,
} = require('./session-profiles');
// C2 "narrower sticks": a per-agent pick is held under the channel's live value by the SAME rules a
// directive's request is clamped by (a ladder for Axis A, capability bits for Axis B).
const { narrowTo, narrowMessageMode } = require('./launch-posture');

// ─── BEGIN SESSION-PRIVATE-PURE (pure; unit-tested via source extraction) ────────

/** Is a turn running right now? ⚠ `awaiting_permission` counts: the SDK is blocked mid-turn on
 *  a `canUseTool` promise, so the turn has not ended and its `result` is still to come. */
function turnInFlight(state) {
  const a = (state || {}).activity;
  return a === 'working' || a === 'awaiting_permission';
}

/**
 * OPEN the window for a message just pushed. Returns the new depth. It ADDS rather than SETS, so
 * two 1:1 messages in a row each get their own covered turn.
 *
 * The `+2` DOUBLE-COUNTED when the in-flight turn was already private (2026-08-22, the confirmed
 * root cause of the posture degradation): the extra unit exists to cover a CHANNEL turn that
 * happened to be running, but when the turn in flight is itself private its own depth already pays
 * for it, and the surplus never drains — leaving every later CHANNEL turn with Axis B's outbound
 * widening withdrawn on a session nobody had made private. The remaining over-cover for a
 * NON-private turn in flight stands: the alternative failure is a private answer posted in public.
 */
// A push into a running turn that the runtime may JOIN to it, remembered by its framed text so the
// join can pay back the unit opened for the push's own turn. Bounded; stale entries go oldest-first.
const PRIVATE_JOIN_MAX = 16;

// Two windows share one arithmetic: PRIVATE (a 1:1 panel turn withdraws Axis B's out half) and PEER
// (a turn the operator did not originate refuses their own tools, `operator-tools.js`).
const PRIVATE_WINDOW = { depth: 'privateDepth', join: 'privateJoinable' };
const PEER_WINDOW = { depth: 'peerDepth', join: 'peerJoinable' };

const windowOpen = (s, w) => (Number(s && s[w.depth]) || 0) > 0;

function openWindow(s, w, wasInFlight, prompt) {
  if (!s) return 0;
  // THE WINDOW IS OPENED AFTER THE DISPATCH SINCE 2026-08-31, AND `wasInFlight` IS WHAT MAKES THAT
  // POSSIBLE (F-372). A `steer` at a PARKED session makes the reducer emit `resumeQuery` BEFORE
  // `pushTurn`, and `session-park.js › resumeParked` calls `resetPrivateTurn` — so a window opened
  // before the dispatch was WIPED by the wake that same message triggered, and the turn ran with
  // Axis B's outbound widening intact.
  //
  // Opening afterwards is still before any `result` can arrive: `dispatch` is synchronous and only
  // PUSHES onto the iterator. The caller must read `wasInFlight` BEFORE the dispatch, because the
  // dispatch moves activity to `working` and the state can no longer answer the question. Absent
  // falls back to reading the state, so the pre-2026-08-31 one-argument call is unchanged.
  const inFlight = wasInFlight === undefined ? turnInFlight(s.state) : wasInFlight === true;
  const add = (inFlight && !windowOpen(s, w)) ? 2 : 1;
  s[w.depth] = (Number(s[w.depth]) || 0) + add;
  if (inFlight && typeof prompt === 'string' && prompt) {
    const list = Array.isArray(s[w.join]) ? s[w.join] : [];
    list.push(prompt);
    while (list.length > PRIVATE_JOIN_MAX) list.shift();
    s[w.join] = list;
  }
  return s[w.depth];
}

function joinWindow(s, w, pushedText) {
  const list = s && Array.isArray(s[w.join]) ? s[w.join] : [];
  const text = typeof pushedText === 'string' ? pushedText : '';
  const i = text ? list.findIndex((p) => text.includes(p)) : -1;
  if (i === -1) return Number((s && s[w.depth]) || 0);
  list.splice(i, 1);
  return closeWindow(s, w);
}

function resetWindow(s, w) {
  if (!s) return 0;
  s[w.depth] = 0;
  s[w.join] = null;
  return 0;
}

// Floored at zero: a stray `result` (a superseded query's drained tail) must never make the NEXT turn
// read as already closed.
function closeWindow(s, w) {
  if (!s) return 0;
  const next = (Number(s[w.depth]) || 0) - 1;
  s[w.depth] = next > 0 ? next : 0;
  if (!s[w.depth]) s[w.join] = null; // no turn left for a join to belong to
  return s[w.depth];
}

function openPrivateTurn(s, wasInFlight, prompt) {
  return openWindow(s, PRIVATE_WINDOW, wasInFlight, prompt);
}

/**
 * The runtime JOINED a push into the running turn (Codex `turn/steer`, Claude's mid-turn fold), so
 * one `result` answers both and the unit opened for the push's own turn is paid back — else the next
 * channel turn runs with the out half withdrawn. Either order against that `result` pays back one.
 */
function privatePushJoined(s, pushedText) {
  return joinWindow(s, PRIVATE_WINDOW, pushedText);
}

/**
 * A QUERY WAS TORN DOWN: the window closes outright. A torn-down query OWES NO RESULTS — its
 * consume loop is superseded by `session-query.js`'s `s.query !== q` guard, so the `result` events
 * that would have spent this depth are dropped on the floor, and without this a park, an auth hold,
 * a crash or an operator End left the surplus behind for the NEXT private turn to open on top of.
 */
function resetPrivateTurn(s) {
  return resetWindow(s, PRIVATE_WINDOW);
}

/** A turn ENDED: spend one of the window. */
function closePrivateTurn(s) {
  return closeWindow(s, PRIVATE_WINDOW);
}

/** Is the CURRENT turn private? The one question the gate and the narration tag both ask. */
function isPrivateTurn(s) {
  return windowOpen(s, PRIVATE_WINDOW);
}

// The PEER window: opened by every push the operator did not author, spent by the same `result` and
// teardown clocks, so a turn it covers can never outlive its own answer.
const openPeerTurn = (s, wasInFlight, prompt) => openWindow(s, PEER_WINDOW, wasInFlight, prompt);
const peerPushJoined = (s, pushedText) => joinWindow(s, PEER_WINDOW, pushedText);
const resetPeerTurn = (s) => resetWindow(s, PEER_WINDOW);
const closePeerTurn = (s) => closeWindow(s, PEER_WINDOW);
const isPeerTurn = (s) => windowOpen(s, PEER_WINDOW);

// `autoSendMessageMode` stood here and is DELETED (2026-09-06, item 8). It forced Axis B's OUT half
// on over whatever the stored posture said — the mechanism by which the auto-send toggle overrode
// Messaging. There is nothing left to force: Messaging IS the posture now, so an operator who wants
// the out half picks it and `effectiveMessageMode` reads that pick live. Deleted alongside
// `channel-prefs.getAutoSend` / `setAutoSend`, the two `channels:*AutoSend` IPC handlers and the
// web hook.

/**
 * AXIS B AS THE GATE SHOULD SEE IT for this session, right now.
 *
 * `session-io.js › grantArgs` is the ONE caller, so this is the single point where a private turn
 * changes what a tool call is allowed to do. AXIS A is not consulted here at all, which keeps the
 * v2.9 invariant intact: a message op branches to Axis B and never reaches Axis A.
 *
 * THE STORED CHANNEL VALUE IS READ LIVE AND FIRST, with `state.messageMode` as the FALLBACK
 * (2026-08-31, carried through the 2026-09-06 fold of auto-send into Messaging — the ruling's real
 * content was that the switch takes effect IMMEDIATELY for all agents in the channel, which is a
 * property of the READ SITE, not of the record). A posture frozen at launch has four silent ways to
 * not be in effect: a reopened/recreated shell drops its startModes (H2), a crash resume floors
 * them, a running session never re-reads the store, and a private turn withdrew the half it
 * granted. The two controls could not both survive because they set the same axis and disagreed by
 * construction. An unreadable store falls back to the frozen value rather than to a grant.
 *
 * AUTO MEANS FULL AUTO (Samuel, 2026-09-06): an OUT-half posture (`auto_outbound` / `auto_both`)
 * DEFEATS the 2026-08-22 private-turn withdrawal, so a reply drafted inside a private panel turn
 * leaves the machine with no Send click. This overturned the fold's own first draft, whose argument
 * — recorded because it is a real cost — was that the operator's private words leaving unclicked is
 * the narrowest consent point there is; Samuel ruled that a posture saying "auto" and then holding
 * a draft is the worse surprise.
 *
 * WHAT IS NOT WIDENED: only the OUT half defeats the withdrawal. `ask` and `auto_inbound` carry no
 * out-half consent, so a private turn on those postures withdraws exactly as 2026-08-22 wrote it,
 * and the IN half is preserved on every path.
 */
function effectiveMessageMode(s) {
  const st = (s && s.state) || {};
  const frozen = st.messageMode || 'ask';
  const stored = channelMessageMode(s && s.channelId);
  // THE WINDOWLESS FLOOR IS RE-APPLIED HERE; leaving it off would be F-236 from the other end. The
  // stored value is the operator's PICK and carries no floor, where the frozen value had one applied
  // at launch. A windowless session has no Accept surface, so an un-floored `ask` here would gate
  // its own-channel READS — and a gated read there is a DENIED read — making every windowless agent
  // unable to look at the thread it was answering on `ask` channels, which is the default. ONE
  // STATEMENT OF THE FLOOR: the same function `channel-prefs.js` applies at launch, pinned by
  // `test/session-mode-floor.test.mjs`.
  const floor = (m) => (m && s && s.windowless ? floorWindowlessMessage(m) : m);
  const live = floor(stored);
  // C2: a per-agent pick holds under the channel's live value, never above it.
  const mode = (live && st.messageModeSet === true ? floor(narrowMessageMode(st.messagePick || frozen, live)) : live) || frozen;
  // Samuel's ruling, 2026-09-06 — auto means full auto. An OUT-half posture is the operator's
  // explicit, visible, channel-wide consent to their agents posting with no click, so it defeats
  // the private-turn withdrawal below.
  //
  // It is the CHANNEL'S LIVE VALUE that defeats the withdrawal, not the resolved mode, and the
  // difference is a grant: `live` is the setting the operator can SEE and change, where `mode` may
  // be the session's FROZEN snapshot, reached only when the store answered nothing. Testing `mode`
  // here would let an unreadable store hand a private turn FULL AUTO.
  if (live && autoOutboundMode(live)) return mode;
  return isPrivateTurn(s) ? privateTurnMessageMode(mode) : mode;
}

/**
 * AXIS A AS THE GATE SHOULD SEE IT for this session, right now — the TOOLS half of what
 * {@link effectiveMessageMode} does for MESSAGES. It exists because for three weeks only one of the
 * two axes had it (2026-09-16, the permission-inheritance report).
 *
 * THE ASYMMETRY WAS THE DEFECT, NOT A DESIGN. `effectiveMessageMode` fixed all four ways a durable
 * setting fails to be in effect for Axis B by reading the store at DECISION time; Axis A stayed
 * frozen at `state.toolMode`, so an operator with `bypass` stored for the channel was still
 * prompted for `Bash` by any session that was recreated, resumed, woken by a peer or abandoned and
 * rebuilt. `manual` allows NO work tool, so every call gated — which reads exactly like a setting
 * that did not stick, because it is one.
 *
 * H2 IS NOT REPEALED. H2 forbids an AMBIENT posture read at a SPAWN no human is attending; the
 * construction site still reads nothing and `spec.startModes` is still the only thing that seeds
 * `state.toolMode`. This is a read at DECISION time of a setting the operator can see and change
 * right now. It is SUPERVISION, never CONTAINMENT: `SESSION_HARD_DENY`, the container-only path
 * rules, the profile's `disallowedTools` and the Axis-A/Axis-B split are all checked BEFORE
 * `grantDecision` consults this value.
 *
 * A PER-AGENT PICK NARROWS, ON BOTH AXES (Samuel's ruling 3, "narrower sticks"): the agent view or
 * an orchestrator can pin ONE session's posture (`session-reopen.js › setModeByTask` with `pinned`,
 * or a pinned start posture), and the gate then enforces the narrower of that pick and the channel's
 * live value. It can never be wider than the channel. `state.toolModeSet` / `messageModeSet` are
 * stamped only by a pinned set; a channel fan-out never stamps one.
 *
 * NO FLOOR IS APPLIED HERE, deliberately: the windowless Axis-A floor is the RUNTIME's
 * (`floorWindowlessTool`) and is applied at the single read site in `session-io.js › grantArgs`;
 * re-applying it here would be the second spelling `session-mode-floor.test.mjs` exists to prevent.
 *
 * An unreadable store falls back to the frozen value, never to a grant — `channelToolMode` answers
 * `''` for "no opinion", exactly as `channelMessageMode` does.
 */
function effectiveToolMode(s) {
  const st = (s && s.state) || {};
  const list = Array.isArray(st.toolModes) ? st.toolModes : [];
  const frozen = st.toolMode || list[0] || '';
  // The channel's value for THIS session's runtime, in that runtime's words (X-01).
  const live = channelToolMode(s && s.channelId, s && s.runtimeId);
  if (!live) return frozen;
  // C2: a per-agent pick holds under the channel's live value, never above it.
  if (st.toolModeSet === true) return list.length ? narrowTo(st.toolPick || frozen, live, list) : frozen;
  return live;
}

// ─── END SESSION-PRIVATE-PURE ────────────────────────────────────────────────────

/**
 * THE LIVE HALF — the channel's durable MESSAGING value, read at DECISION time, or `''` when there
 * is none to read (2026-09-06, item 8; successor to `channelAutoSend`).
 *
 * LAZY-REQUIRED: `channel-prefs.js` instantiates an electron-store at load, and this module is
 * required by plain-node tests that must keep working. A failed require answers `''`.
 *
 * IT ANSWERS `''`, NOT A MODE, WHEN IT CANNOT READ. An unreadable store, an absent channel id and a
 * channel that has never been configured are all "no opinion", and the caller falls back to the
 * session's frozen value; answering a MODE here would make an unreadable store into a posture, and
 * the narrowest would be as wrong as the widest.
 *
 * Validated by the store on write (`launch-selection.js › patchRejections`), so what comes back is a
 * `MESSAGE_MODES` member or nothing.
 */
function channelMessageMode(channelId) {
  if (!channelId) return '';
  try {
    // PRESENCE FIRST, or this function cannot keep its own contract. `getLaunchPosture` NEVER
    // answers null — it answers the stored pair or the RESTRICTIVE DEFAULT, which is right for the
    // Settings tab and wrong here: read alone it makes an UNCONFIGURED channel indistinguishable
    // from one deliberately set to `ask`, so the default would win over the session's frozen launch
    // posture on every channel nobody has opened Settings for. This is the deleted `getAutoSend`'s
    // "no row = no opinion" property, restored on the record that replaced it.
    if (!require('./channel-prefs').hasLaunchPosture(channelId)) return '';
    const preset = require('./channel-prefs').getLaunchPosture(channelId);
    const mode = preset && preset.messages;
    return typeof mode === 'string' && mode ? mode : '';
  } catch (_err) {
    return '';
  }
}

/**
 * THE LIVE HALF OF AXIS A — the channel's durable TOOLS value for the SESSION'S runtime, read at
 * DECISION time, or `''` when there is none to read. `channelMessageMode`'s twin, and every clause
 * of that function's header applies here for the same reasons: LAZY-REQUIRED, `''` rather than a
 * mode when it cannot read, the PRESENCE check first, and coerced by the store (validated against
 * that runtime's own words on write). ⚠ Never the SELECTED runtime's record: a Codex session in a
 * Claude-selected room reads the Codex record (X-01).
 */
function channelToolMode(channelId, runtimeId) {
  if (!channelId) return '';
  try {
    if (!require('./channel-prefs').hasLaunchPosture(channelId)) return '';
    const preset = require('./channel-prefs').launchPostureFor(channelId, sessionRuntimeId(runtimeId));
    const mode = preset && preset.tools;
    return typeof mode === 'string' && mode ? mode : '';
  } catch (_err) {
    return '';
  }
}

/** A session's runtime id; an absent one (a pre-port record) is the DEFAULT runtime, never the
 *  channel's selected one. */
function sessionRuntimeId(runtimeId) {
  if (runtimeId) return runtimeId;
  try { return require('./runtime').DEFAULT_ID || ''; } catch (_err) { return ''; }
}

/**
 * C2: validate a per-axis mode against the SESSION's own words (Axis A: its runtime's list; Axis B:
 * Dopl's four) and, for a PINNED pick, clamp it to the channel's current value for that runtime.
 * Answers `{ mode, clamped }`. An unreadable store clamps to the narrowest, never to a grant.
 */
function pickForSession(s, axis, asked, pinned) {
  const rt = sessionRuntimeId(s && s.runtimeId);
  const tools = axis === 'tools';
  const want = tools ? normalizeToolMode(asked, rt) : normalizeMessageMode(asked);
  if (pinned !== true) return { mode: want, clamped: false };
  const list = toolModesFor(rt);
  let ceiling = { tools: list[0], messages: 'ask' };
  try {
    ceiling = require('./channel-prefs').launchPostureFor(s && s.channelId, rt) || ceiling;
  } catch (_err) { /* the narrowest stands */ }
  const got = tools ? narrowTo(want, ceiling.tools, list) : narrowMessageMode(want, ceiling.messages);
  return { mode: got, clamped: got !== want };
}

module.exports = {
  turnInFlight,
  openPrivateTurn,
  privatePushJoined,
  closePrivateTurn,
  resetPrivateTurn, // 2026-08-22: a torn-down query owes no results — the window closes with it
  isPrivateTurn,
  openPeerTurn, peerPushJoined, resetPeerTurn, closePeerTurn, isPeerTurn,
  // ⚠ `autoSendMessageMode` REMOVED 2026-09-06 (item 8) — see the block above it.
  effectiveMessageMode,
  channelMessageMode, // 2026-09-06: the live read of the channel's Messaging value, for the suite
  effectiveToolMode, // 2026-09-16: Axis A's decision-time read — the half that was missing
  channelToolMode, //  ...and its live half, exported on `channelMessageMode`'s precedent
  pickForSession, // C2: a live mode change, in the session's words, clamped when it is a pick
};
