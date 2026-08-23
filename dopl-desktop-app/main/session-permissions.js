// session-permissions.js — WHAT A SESSION ANSWERS A `canUseTool` PROMISE WITH.
//
// ⚠ SPLIT OUT OF `main/session-engine.js` ON 2026-08-22, under the hard 500-line §2 cap, and the
// seam is a real one rather than a line budget: every function here answers ONE question — how a
// held tool call is resolved, and what the agent is TOLD when the answer is no. That changes when
// the SURFACES change; the engine changes when the loop does.
//
// ── ⚠ THE DENIAL COPY IS THE POINT OF THIS FILE (Samuel's ruling, 2026-08-22) ────────────────
//
// `'Denied by operator'` was the message on EVERY deny, and on a WINDOWLESS session that sentence
// is false in the most expensive possible way: nobody was asked. `session-windowless.js ›
// claimGate` answers a `permission_request` with an immediate `decide(rid, 'deny')` because there
// is no surface to ask on — so the agent was told a human had considered its request and refused
// it, when no human had seen it at all.
//
// IN LIVE TESTING THAT COST ~8 MESSAGES OF WASTED AGENT DIAGNOSIS AND TWO OPERATOR ESCALATIONS.
// The agent did exactly what the sentence invited: it treated the refusal as a DECISION, explained
// itself, proposed narrower variants, asked the counterparty to reconsider, and finally reported
// to its operator that they had denied something they had never been shown. A message that names
// the wrong actor does not merely fail to help — it sends a capable agent down a path.
//
// SO THE TWO CASES GET TWO MESSAGES, and the distinction is which of them a HUMAN answered:
//   AUTO-DENY (no surface)  the gate was never shown to anybody. Say so, name what would change
//                           it (the session's tool posture), and say who can change it.
//   A REAL DECISION         an operator, or the outbound consent row a human answered (or
//                           cancelled), said no. `'Denied by operator'` is true here and stays.
//
// ⚠ THE AUTO-DENY IS RECOGNISED BY BOOKKEEPING, NOT BY `s.windowless`. Every session is windowless,
// so that flag would collapse both cases into one — and the OUTBOUND gate on a windowless session
// IS answered by a human (`session-windowless.js › watchRow` decides on the consent row's real
// status). The engine stamps the request id when `claimGate` takes the no-surface branch, and
// nothing else writes that set.

// Bounded, per session, and it dies with the session object. ⚠ THE BOUND IS NOT COSMETIC: every
// per-session structure multiplies against `MAX_CONCURRENT_SESSIONS` (INVARIANTS §11), and an
// unbounded Set on a long-running agent is the shape this tree has been bitten by more than once.
// 64 is far above the number of gates that can be in flight at one time (they are resolved
// synchronously by `claimGate`), and the oldest goes first.
const MAX_AUTO_DENIED = 64;

const AUTO_DENY_MESSAGE =
  'This tool needs a permission prompt and this session has no surface to show one on, so the '
  + 'call was refused automatically. NOBODY WAS ASKED and nobody refused you: do not appeal, '
  + 'explain yourself, or ask the counterparty about it. Either do the work with the tools you '
  + 'already have, or say in one line which tool you needed. Your operator can widen this '
  + "session's tool posture from the agent view.";

const OPERATOR_DENY_MESSAGE = 'Denied by operator';

// Record that THIS request was refused for want of a surface. Called by the engine at the one
// place that takes that branch.
function noteAutoDenied(s, requestId) {
  if (!s || !requestId) return;
  if (!s.autoDeniedIds) s.autoDeniedIds = new Set();
  if (s.autoDeniedIds.size >= MAX_AUTO_DENIED) {
    s.autoDeniedIds.delete(s.autoDeniedIds.values().next().value);
  }
  s.autoDeniedIds.add(String(requestId));
}

// Which denial message does this request deserve? ⚠ FAILS TOWARD `'Denied by operator'`: an
// unrecognised id means we do not know that nobody was asked, and claiming so falsely is the
// error this file exists to remove.
function denialMessage(s, requestId) {
  const ids = s && s.autoDeniedIds;
  return ids && ids.has(String(requestId)) ? AUTO_DENY_MESSAGE : OPERATOR_DENY_MESSAGE;
}

// Fail-close EVERY awaited canUseTool promise and drop the bookkeeping. A park runs this before
// its abort (P1) so no resolver dangles on a resumable session; the teardown runs it (C3) — a
// settled session will never answer a button again.
function denyPendingPermissions(s, message) {
  for (const resolve of s.pendingPermissions.values()) {
    try { resolve({ behavior: 'deny', message: message || 'Session paused' }); } catch (_) { /* best effort */ }
  }
  s.pendingPermissions.clear();
  s.pendingNames.clear();
}

// Returns TRUE only when a live awaited resolver was actually taken (FIX F1): no resolver means
// the request is already decided (a park deny-closed it) and the caller must NOT report success —
// a renderer believing a blanket {ok:true} stamped a DENIED post 'sent'.
function resolvePerm(s, requestId, decision) {
  const resolve = s.pendingPermissions.get(requestId);
  if (!resolve) return false;
  s.pendingPermissions.delete(requestId);
  s.pendingNames.delete(requestId);
  // FIX M1: FAIL CLOSED. ALLOW only on an explicit 'allow' (the reducer maps allow-once/allow-task
  // -> 'allow'); anything else, unknown included, denies.
  resolve(decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: denialMessage(s, requestId) });
  return true;
}

module.exports = {
  denyPendingPermissions,
  resolvePerm,
  noteAutoDenied,
  denialMessage,
  AUTO_DENY_MESSAGE,
  OPERATOR_DENY_MESSAGE,
  MAX_AUTO_DENIED,
};
