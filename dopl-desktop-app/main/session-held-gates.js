// session-held-gates.js — WHAT THE OPERATOR IS BEING ASKED, for the calls this session is
// HELD on right now.
//
// ── WHY IT EXISTS (Samuel, 2026-09-17) ───────────────────────────────────────────────
//
// A windowless session whose tool call gates is HELD: `session-gate-bridge.js › gateCall`
// parks the platform's resolver in `s.pendingPermissions`, the reducer records the request id
// in `state.pendingPermissions`, and every surface that watches the agent says the same true
// but useless thing — "Waiting on you" on the card, `BLOCKED on its operator's approval` over
// MCP. ⚠ **AND THERE WAS NOWHERE TO ANSWER.** The buttons lived on the v1 SESSION WINDOW,
// which is deleted (F-228, 2026-08-20); what replaced them was a native notification with an
// Allow action (`session-windowless.js › bridgeToolGate`), which is a surface the operator
// only gets ONCE, cannot go back to, and loses to a ten-minute TTL. Samuel, verbatim: *"i dont
// see like a surface where I can approve the permission either inline"*.
//
// ⚠ **THE REQUEST ID ALONE CANNOT BE THAT SURFACE, AND THAT IS THE WHOLE POINT OF THIS FILE.**
// `state.pendingPermissions` is a list of opaque ids — the reducer's own comment says it "holds
// requestIds only, so the reducer cannot tell a queued Bash from a queued `op=open`". An
// operator asked to approve `f47ac10b-…` is being asked nothing. So the four facts that make
// the question answerable are recorded BESIDE the id, at the one place a hold is created, and
// the projection intersects them with the reducer's live set.
//
// ⚠ **THE REDUCER'S ARRAY STAYS AUTHORITATIVE AND THIS LEDGER IS NEVER CONSULTED ABOUT WHAT IS
// LIVE.** `heldGatesFor` walks `state.pendingPermissions` and looks each id up here, so an
// entry whose request has been answered, timed out, parked or fail-closed is INVISIBLE by
// construction — there is no second "is it still pending" opinion to drift from the first.
// That is also why there is no forget/clear hook: the ledger is bounded, it dies with the
// session object, and a stale entry cannot be rendered. Same shape and same bound as
// `session-permissions.js › noteAutoDenied` and `session-windowless.js`'s `bridgedToolGates`,
// both of which are write-only sets for exactly this reason.
//
// ⚠ **THIS FILE DECIDES NOTHING.** It records what a decision ALREADY made needs in order to be
// shown, and `session-gate-bridge.js`'s own header rule applies unchanged: nothing here is a
// second verdict. It cannot widen a posture, cannot resolve a promise and cannot reach a tool.
//
// ⚠ **NO REQUIRES, DELIBERATELY.** `main/session-summary.js` reads this module and is itself
// source-extracted with injected dependencies; a transitive require that opened an
// `electron-store` (the reason `agent-names.js` is STUBBED in that harness) would cost the
// projection suites their loader. The ONE thing that needs the gate's own vocabulary — the
// short tool label and the `dopl_channel` op key — is computed by `session-gate-bridge.js`,
// which already owns both spellings, and handed over finished. Two spellings of one label is
// how a card comes to name a different call than the diag line.

// Bounded per session, and it dies with the session object. ⚠ THE BOUND IS NOT COSMETIC: every
// per-session structure multiplies against `MAX_CONCURRENT_SESSIONS` (INVARIANTS §11). 64 is
// `session-permissions.js › MAX_AUTO_DENIED`'s number, stated again rather than imported for
// the no-requires rule above, and far above the number of gates that can be held at once.
const MAX_HELD = 64;

// ⚠ SHORTER THAN THE DOCK CARD'S 140 (`session-io.js › summarizeInput`), because this is a
// COMPACT inline card on a 380px column and not an expandable panel. It re-caps a string that
// summarizer already bounded; it never reads the raw input, so this file adds no privacy
// surface of its own — what may appear on a card is `summarizeInput`'s rule and stays there.
const SUMMARY_CAP = 120;
const TOOL_CAP = 40; // `session-gate-bridge.js › DIAG_NAME_CAP`, the label it hands over
const OP_CAP = 24; //  `session-gate-bridge.js › DIAG_OP_CAP`, likewise
const REASON_CAP = 40; // a `GATE_REASONS` code; the renderer owns the copy, this bounds the key

/** One line of model-supplied text, made safe to put on a card: no newlines, no runaway
 *  length. ⚠ The value is already `summarizeInput`'s output — bounded and reviewed — so this
 *  is a re-cap, never a sanitizer standing in for one. */
function oneLine(value, cap) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, cap);
}

/**
 * RECORD WHAT THIS HELD CALL IS. Called once, from the one place a resolver is parked
 * (`session-gate-bridge.js › gateCall`'s `park`), with the label and op key that file already
 * computed for the audit line.
 *
 * ⚠ IT IS A NO-OP WITHOUT A REQUEST ID. A hold with no id cannot be answered and must not
 * occupy a slot in a bounded map.
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
    // ⚠ THE `dopl_channel` OP KEY (`<op>.<action>`), and '' for every other tool — the SAME key
    // the classifiers match on and the diag line prints (F-578). Under the five-op surface the
    // bare tool name reads identically for a roster read and an invite, which is the whole
    // reason this field is separate from `tool`.
    op: oneLine(entry.op, OP_CAP),
    // The one-line restatement of the input — the channel, the agent, the command.
    summary: oneLine(entry.summary, SUMMARY_CAP),
    // ⚠ A CODE, NEVER WORDS (`session-gate-reason.js › GATE_REASONS`). The renderer owns the
    // copy, and a code it does not know renders no line rather than a guess — the rule
    // `session-gate-bridge.js › gatePayload` already states for `gateReason`.
    reason: oneLine(entry.reason, REASON_CAP),
  });
}

/**
 * THE HELD CALLS, IN THE ORDER THE REDUCER HOLDS THEM.
 *
 * ⚠ THE REDUCER'S ARRAY IS THE SET; THIS LEDGER IS ONLY THE DETAIL. An id with no entry (a
 * hold created by an older build, or an `outbound_gate`, which has its own surface in the
 * thread's send box and is deliberately not recorded here) is DROPPED rather than rendered as
 * a blank card — a card that cannot say what it is asking about is the defect this file exists
 * to remove, not a shape to fall back to.
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
