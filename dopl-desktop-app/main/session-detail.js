// SESSION DETAIL — the FINER activity signal beside the pill state (2026-08-20).
//
// ⚠ WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A FOURTH PILL STATE. session-summary.js's
// header carried a paragraph headed "NO 'thinking' PILL" whose diagnosis was exactly
// right: *"`pillState`'s entire input is the reducer's `{ phase, activity, parked }`,
// which says nothing about what has been RENDERED this turn. A fourth state needs that
// fact lifted into the reducer or a second source spliced in here."* This module is that
// second source, and the fact turned out to be free: session-engine's ONE dispatch funnel
// already sees every reducer event before any effect runs, and already calls
// `sessionSummary.noteActivity(s)` on that same line. It now passes the event.
//
// ⚠ THE PILL STATE IS UNCHANGED AND MUST STAY UNCHANGED. `state` is three-valued because
// the SERVER's vocabulary is three-valued: session-state-push.js hands it to
// `channel_sessions.state`, whose CHECK constraint and whose zod enum
// (`src/features/channels/schema-sessions.ts`) both admit exactly working/idle/ended.
// Zod validates the ARRAY, so ONE entry carrying a fourth value 400s the WHOLE payload;
// `retryable(400)` is false, so the digest is never recorded and EVERY LATER PUSH for that
// workspace fails identically — `read_sessions` answers [] for the machine and stale rows
// are never cleared. `detail` is therefore additive and LOCAL-ONLY, which costs nothing:
// `session-state-push.js › reportRow` picks the row's columns BY NAME, the same property
// that let the five runtime metrics ride this wire without widening the table
// (INVARIANTS §11).
//
// ⚠ THE THINKING RULE IS A PORT, NOT AN INVENTION. `renderer/session/session-chrome.js ›
// thinkingVisible` has always answered this question for the session window — "a turn is
// in flight and the agent has rendered NOTHING for it yet" — WITHOUT a token stream
// (`includePartialMessages: false` is load-bearing elsewhere and was never the obstacle;
// F-146 corrected that wrong reason in four places). That whole renderer tree is
// unreachable code awaiting deletion (F-228), so this is a rule being rehomed before its
// only home goes, not a second answer to a live question.
//
// PURE below the sentinel: `mcpShortName` is the ONE tool-name normalizer this tree has
// (INVARIANTS §11 — never a second matcher over a raw tool name) and is a free var inside
// the block, so test/session-detail.test.mjs evaluates the real code verbatim.

const { mcpShortName } = require('./mcp-tool-names');

// ─── BEGIN SESSION-DETAIL-PURE (injectable; unit-tested via source extraction) ────────
// `mcpShortName` is a free var from here down.

// The vocabulary. A closed set, like PILL_STATES — the renderer maps these to copy
// (`components/channels-v2/agents-model.ts › agentDetailLabel`) and an unknown value there
// renders NOTHING rather than a raw key.
const DETAIL_THINKING = 'thinking';
const DETAIL_TOOL = 'tool';
const DETAIL_POSTING = 'posting';
const DETAIL_PERMISSION = 'permission';
const DETAIL_AWAITING_PEER = 'awaiting_peer';
const DETAIL_AWAITING_INBOUND = 'awaiting_inbound';
const DETAIL_KINDS = [
  DETAIL_THINKING, DETAIL_TOOL, DETAIL_POSTING, DETAIL_PERMISSION,
  DETAIL_AWAITING_PEER, DETAIL_AWAITING_INBOUND,
];

// A tool label is peer-adjacent text on its way to a renderer, so it gets the same
// discipline every other display string on this wire gets: one line, collapsed, bounded.
// 32 is a caption-sized budget — a name longer than that is noise at this size.
const TOOL_LABEL_CAP = 32;

/**
 * WHAT THE AGENT LAST DID, from one reducer event. Two fields, and nothing else: this
 * runs inside `dispatch`, on EVERY SDK event, so anything more expensive than an
 * assignment here is a cost paid inside the SDK event loop.
 * ⚠ It records the event kind even for events that change no reducer state
 * (`assistant` / `tool_use` / `tool_result` are pass-throughs) — that is the entire point,
 * since those are exactly the events that say what has been RENDERED this turn.
 */
function noteEvent(s, event) {
  if (!s || !event || typeof event.type !== 'string') return;
  s.lastEventKind = event.type;
  if (event.type !== 'tool_use') return;
  s.lastToolLabel = toolLabel(event.payload && event.payload.name);
}

/**
 * The tool's SHORT name, bounded, or null.
 * ⚠ `mcpShortName` is the gate's own normalizer and the only one this tree may have — a
 * local regex here would be a second answer to "what is this tool called under any
 * client" (F-139). Over-matching is the safe direction for a display label as it is for
 * the gate.
 */
function toolLabel(name) {
  if (typeof name !== 'string') return null;
  const short = mcpShortName(name).replace(/\s+/g, ' ').trim().slice(0, TOOL_LABEL_CAP).trim();
  return short || null;
}

/**
 * THE TABLE. `(reducer state, last event kind) -> detail key`, or `null` for "nothing
 * finer to say".
 *
 * ⚠ IT ONLY EVER SPEAKS OVER A `working` PILL, and that ordering is deliberate rather than
 * incidental: a detail is a refinement OF the pill, so an ended, parked or idle session
 * answers `null` and the surface falls back to the pill's own word. A detail that outlived
 * its pill would be the two-readers-one-fact defect in miniature.
 *
 *   ENGINE / LAST EVENT                     DETAIL          WHY
 *   activity 'awaiting_permission'          permission      a human decision is the block,
 *                                                           and it outranks what the agent
 *                                                           was doing when it hit the gate
 *   activity 'awaiting_peer'                awaiting_peer   posted; the other machine has it
 *   activity 'awaiting_inbound'             awaiting_inbound reply HELD for an Accept
 *   last event 'tool_use'                   tool            a tool card is the newest thing
 *                                                           rendered
 *   last event 'outbound_post'              posting         the agent is sending to the peer
 *   last event 'assistant'                  null            AGENT OUTPUT — the thinking chip
 *                                                           clears on the first artifact,
 *                                                           exactly as thinkingVisible does
 *   anything else, incl. absent             thinking        a turn is in flight and nothing
 *                                                           has been rendered for it yet:
 *                                                           a fresh steer / accepted inbound
 *                                                           (no event yet), or a tool_result
 *                                                           the model is now reading
 *
 * ⚠ THE FALLBACK IS 'thinking' AND NOT null, which is the opposite direction from
 * `pillState`'s idle fallback, and for a reason that does not contradict it: this branch is
 * only reached when the pill ALREADY says `working`, so something is running by
 * construction. `pillState` guesses about whether there is a session at all; this only
 * refines a session already known to be mid-turn.
 */
function detailFor(state, lastEventKind, pill) {
  if (pill !== 'working') return null;
  const st = state || {};
  if (st.activity === 'awaiting_permission') return DETAIL_PERMISSION;
  if (st.activity === 'awaiting_peer') return DETAIL_AWAITING_PEER;
  if (st.activity === 'awaiting_inbound') return DETAIL_AWAITING_INBOUND;
  if (lastEventKind === 'tool_use') return DETAIL_TOOL;
  if (lastEventKind === 'outbound_post') return DETAIL_POSTING;
  if (lastEventKind === 'assistant') return null;
  return DETAIL_THINKING;
}

// ─── END SESSION-DETAIL-PURE ─────────────────────────────────────────────────────────

module.exports = {
  DETAIL_KINDS,
  TOOL_LABEL_CAP,
  noteEvent,
  toolLabel,
  detailFor,
};
