// session-held-gates.js — WHAT THE OPERATOR IS BEING ASKED, for the calls this session is
// HELD on right now.
//
// `state.pendingPermissions` holds opaque requestIds only, so it cannot say what is being asked.
// The four facts that make a hold answerable are recorded here beside the id, at the one place a
// hold is created (`session-gate-bridge.js › gateCall`), and `heldGatesFor` intersects them with
// the reducer's live array.
//
// The reducer's array stays authoritative and this ledger is never consulted about what is live:
// an entry whose request was answered, timed out, parked or fail-closed is invisible by
// construction, so there is no forget/clear hook and no second "is it still pending" opinion.
// This file decides nothing — it records what an already-made decision needs in order to be
// shown, and cannot widen a posture, resolve a promise or reach a tool.
//
// NO REQUIRES, DELIBERATELY: `main/session-summary.js` reads this module source-extracted with
// injected dependencies, and a transitive require that opened an `electron-store` would cost the
// projection suites their loader. The one thing needing the gate's vocabulary — the short tool
// label and the `dopl_channel` op key — is computed by `session-gate-bridge.js` and handed over
// finished, so there is only ever one spelling of a label.

// Bounded per session, and it dies with the session object; every per-session structure
// multiplies against `MAX_CONCURRENT_SESSIONS` (INVARIANTS §11). 64 is
// `session-permissions.js › MAX_AUTO_DENIED`'s number, restated rather than imported for the
// no-requires rule above.
const MAX_HELD = 64;

// Shorter than the dock card's 140 (`session-io.js › summarizeInput`): a compact inline card on
// a 380px column. This re-caps a string that summarizer already bounded and never reads the raw
// input, so what may appear on a card stays `summarizeInput`'s rule.
const SUMMARY_CAP = 120;
const TOOL_CAP = 40; // `session-gate-bridge.js › DIAG_NAME_CAP`, the label it hands over
const OP_CAP = 24; //  `session-gate-bridge.js › DIAG_OP_CAP`, likewise
const REASON_CAP = 40; // a `GATE_REASONS` code; the renderer owns the copy, this bounds the key

/** One line of model-supplied text, made safe to put on a card. The value is already
 *  `summarizeInput`'s output — bounded and reviewed — so this is a re-cap, never a sanitizer. */
function oneLine(value, cap) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, cap);
}

/**
 * RECORD WHAT THIS HELD CALL IS. Called once, from the one place a resolver is parked
 * (`session-gate-bridge.js › gateCall`'s `park`), with the label and op key that file already
 * computed for the audit line. No-op without a request id: a hold that cannot be answered must
 * not occupy a slot in a bounded map.
 */
function note(s, entry) {
  if (!s || !entry) return;
  const requestId = String(entry.requestId || '');
  if (!requestId) return;
  if (!s.heldGates) s.heldGates = new Map();
  if (s.heldGates.size >= MAX_HELD && !s.heldGates.has(requestId)) {
    s.heldGates.delete(s.heldGates.keys().next().value); // oldest first, like every bounded set here
  }
  s.heldGates.set(requestId, {
    requestId: requestId,
    // WHAT is being asked for. Already shortened past the `mcp__server__` prefix by the caller.
    tool: oneLine(entry.tool, TOOL_CAP) || 'a tool',
    // The `dopl_channel` op key (`<op>.<action>`), '' for every other tool — the same key the
    // classifiers match on and the diag line prints (F-578). Under the five-op surface the bare
    // tool name reads identically for a roster read and an invite.
    op: oneLine(entry.op, OP_CAP),
    // The one-line restatement of the input — the channel, the agent, the command.
    summary: oneLine(entry.summary, SUMMARY_CAP),
    // A code, never words (`session-gate-reason.js › GATE_REASONS`). The renderer owns the copy,
    // and a code it does not know renders no line rather than a guess.
    reason: oneLine(entry.reason, REASON_CAP),
  });
}

/**
 * THE HELD CALLS, IN THE ORDER THE REDUCER HOLDS THEM. The reducer's array is the set; this
 * ledger is only the detail, so an id with no entry (a hold from an older build, or an
 * `outbound_gate`, which has its own surface in the thread's send box) is dropped rather than
 * rendered as a blank card.
 */
function heldGatesFor(s) {
  const ids = (s && s.state && s.state.pendingPermissions) || [];
  const led = s && s.heldGates;
  if (!led || !ids.length) return [];
  const out = [];
  for (const id of ids) {
    const entry = led.get(String(id));
    if (entry) out.push(entry);
  }
  return out;
}

module.exports = { note, heldGatesFor, MAX_HELD, SUMMARY_CAP, TOOL_CAP, OP_CAP, REASON_CAP };
