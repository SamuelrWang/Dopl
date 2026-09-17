// session-answer-permission.js — THE OPERATOR ANSWERING ONE HELD TOOL CALL, INLINE.
//
// ── WHY IT IS ITS OWN FILE ───────────────────────────────────────────────────────────
//
// It belongs beside `controlByTask` / `setModeByTask` / `messageByTask` in
// `main/session-reopen.js`, and that file stood at 499 of the 500-line §1 cap on the day this
// landed (`wc -l main/session-reopen.js`) — a file at the cap cannot absorb a corrected comment,
// let alone a verb. The seam is therefore a line budget rather than a reason-to-change, which
// is stated here rather than dressed up: this one function is a sibling of that file's ops and
// would move back into it the day it has room.
//
// ⚠ IT TAKES ITS RESOLVER BY INJECTION, WHICH IS NOT DECORATION. `session-reopen.js ›
// resolveSession` is the ONE statement of the multiplayer address rule (an `agentId` resolves
// exactly; no id takes the OLDEST live agent on the thread), and that file's own header records
// what happened when four ops each carried a copy of the lookup. This module must not become
// the fifth.
//
// ⚠ AND IT RE-VALIDATES THE PAYLOAD ITSELF, on `main/session-delete-op.js`'s terms: the split
// moved the CODE and not the BOUNDARY, so the UUID gate and the id charset are applied here,
// where the body is, rather than being left behind at a registration site that can only forward.
// `session-ipc-ops.js` keeps the IPC surface — the op name, the sender binding written literally
// at the site, and the refusal shape.
//
// ── WHAT IT ANSWERS, AND WHAT IT REFUSES TO ─────────────────────────────────────────
//
// ⚠ IT DECIDES NOTHING. The GATE already decided ("hold and ask" — `session-gate-bridge.js ›
// gateCall`); this carries a HUMAN's answer to the resolver that is already parked. It cannot
// widen a posture, cannot grant a tool for the task, cannot reach a session this machine does
// not run, and cannot make a held call succeed that the profile would have refused — the
// verdict it answers was `gate`, never `deny`.
//
// ⚠ ALLOW-ONCE ONLY, exactly like the notification's Allow button (`session-windowless.js`'s
// TOOL-GATE BRIDGE block). `allow-task` mints a STANDING grant keyed on the scoped grant name,
// and a compact inline card is too small a surface to hand a session-wide power from; repeat
// calls re-prompt, which is the friction the default-permissions work owns.
//
// ⚠ EXACTLY ONCE, AND THE PROOF IS THE RESOLVER MAP RATHER THAN A FLAG HERE. Two things
// enforce it and neither is a second opinion: the live check below reads
// `s.pendingPermissions` (the Map of parked resolvers, which `session-permissions.js ›
// resolvePerm` DELETES from as it answers), and the return is the engine dispatch's own FIX-F1
// verdict — `true` only when a live resolver really took the answer. So a double click, a click
// racing the 10-minute TTL, and a click on a session a park already fail-closed all answer
// `{ ok: false }` with a reason, instead of a blanket success over a call nobody resolved.
// That failure shape is the one this tree has been bitten by: *"a renderer believing a blanket
// {ok:true} stamped a DENIED post 'sent'"*.
//
// ⚠ AN `outbound_gate` IS NOT REACHABLE FROM HERE IN PRACTICE AND MUST NOT BE MADE SO.
// `session-held-gates.js` records only the DOCK shape, so no card offers one; an own-channel
// post is decided on the CONSENT ROW (first-answer-wins, CAS'd server-side — INVARIANTS §6) and
// a local resolve racing that row is two answers to one question. The check below is
// deliberately on the request id being HELD, not on which kind of gate it is: this module does
// not classify gates, it answers one the surface offered.

const { isUuid } = require('./ipc-guards');
const { isAgentId } = require('./agent-id');

// A request id is a `crypto.randomUUID()` minted by `session-gate-bridge.js`, but the opts may
// carry the platform's own — so it is BOUNDED rather than shape-checked, the same treatment
// `taskId` gets: an unrecognised value simply resolves nothing, and refusing on shape would
// teach a probe which shapes exist.
const REQUEST_ID_CAP = 64;

let deps = { resolveSession: null, dispatch: null };

/**
 * The engine injects the SHARED address resolver and its own dispatch funnel.
 * ⚠ Absent, every call fails CLOSED: an unbound privileged verb is not a usable one, which is
 * the rule `main/session-ipc-ops.js › register` applies to the sender binding for the same
 * reason.
 */
function bind(d) {
  deps = {
    resolveSession: (d && d.resolveSession) || null,
    dispatch: (d && d.dispatch) || null,
  };
}

/**
 * ANSWER ONE HELD TOOL CALL.
 *
 * `{ channelId, taskId, agentId?, requestId, allow }` ->
 *   `{ ok: true, decision }`                       the parked resolver took it
 *   `{ ok: false, reason: 'no-session' }`          the address names nothing live here
 *   `{ ok: false, reason: 'unknown-request' }`     unknown id, or one already answered/expired
 *   `{ ok: false, reason: 'already-decided' }`     held a moment ago; resolved during this call
 *   `{ ok: false }`                                malformed, or the module is unbound
 *
 * ⚠ THE ANSWER GOES THROUGH THE REDUCER, NEVER STRAIGHT TO THE RESOLVER. `permission_decision`
 * is the ONE event that resolves a gate: it clears the id from `state.pendingPermissions`,
 * re-arms the idle timer, emits `permission_resolved` and only then calls `resolvePerm` — and
 * it maps the decision fail-closed (anything but the two allow words denies). Writing to the
 * resolver here would leave the reducer believing the call was still held, which is the
 * two-writers-one-fact defect this whole family is built to avoid.
 *
 * ⚠ THE GRANT NAME RIDES ALONG, UNUSED BY `allow-once` AND CORRECT ANYWAY. The reducer reads
 * `event.name` only on `allow-task`; supplying the session's own recorded key (never a caller's
 * string) means a later widening of this op cannot accidentally key a standing grant on
 * something the renderer chose.
 */
function answerPermissionByTask(a) {
  const p = a || {};
  const requestId = String(p.requestId || '');
  if (!requestId || !deps.resolveSession || !deps.dispatch) return { ok: false };
  const s = deps.resolveSession(p, String(p.channelId || ''), String(p.taskId || ''));
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // ⚠ THE RESOLVER MAP, NOT `state.pendingPermissions`. The reducer's array is the PROJECTION
  // (and is what the card is drawn from); the Map is where a live `canUseTool` promise actually
  // waits, and it is the one `claimGate` and the TTL both test. An id in one and not the other
  // is a session mid-teardown, and the honest answer there is "nothing to answer".
  if (!s.pendingPermissions || !s.pendingPermissions.has(requestId)) {
    return { ok: false, reason: 'unknown-request' };
  }
  // ⚠ FAIL CLOSED ON ANYTHING BUT A LITERAL `true`. The wire carries a boolean and an absent,
  // truthy-but-not-true or forged value must deny — the same rule `session-permissions.js ›
  // resolvePerm` applies one layer down, stated on both layers on purpose.
  const decision = p.allow === true ? 'allow-once' : 'deny';
  let resolved = false;
  try {
    resolved = deps.dispatch(s, {
      type: 'permission_decision',
      requestId: requestId,
      decision: decision,
      name: (s.pendingNames && s.pendingNames.get(requestId)) || '',
    }) === true;
  } catch (_) {
    return { ok: false };
  }
  return resolved ? { ok: true, decision: decision } : { ok: false, reason: 'already-decided' };
}

/**
 * THE BOUNDARY — what `sessions:answerPermission` forwards, validated here.
 *
 * ⚠ THE GATES ARE THE ONES EVERY SIBLING OP APPLIES, and they are applied HERE because this is
 * where the body is (`session-delete-op.js`'s rule): `channelId` is UUID-gated (the anti-probe
 * guard), `taskId` is an opaque string coerced, `agentId` is dropped to '' unless it matches the
 * closed charset, and `requestId` is bounded. ⚠ EVERY REFUSAL IS THE SAME `{ ok: false }` a
 * sender-binding refusal answers, so a hostile page cannot learn which window it is in.
 *
 * ⚠ THE `agentId` MATTERS MORE HERE THAN ON MOST OPS. Every card is drawn from ONE agent's row,
 * so the oldest-live fallback would answer a DIFFERENT agent's question — and nothing would
 * report the substitution. It stays OPTIONAL rather than required (a request id is unique across
 * this machine's sessions, so an unnamed one still cannot cross-answer), which is the
 * compatibility rule the whole namespace follows.
 */
function answerPermission(payload) {
  const p = payload || {};
  if (!isUuid(p.channelId)) return { ok: false };
  return answerPermissionByTask({
    channelId: p.channelId,
    taskId: String(p.taskId || ''),
    agentId: isAgentId(p.agentId) ? String(p.agentId) : '',
    requestId: String(p.requestId == null ? '' : p.requestId).slice(0, REQUEST_ID_CAP),
    allow: p.allow === true,
  });
}

module.exports = { bind, answerPermission, answerPermissionByTask, REQUEST_ID_CAP };
