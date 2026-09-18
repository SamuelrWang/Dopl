// session-answer-permission.js — THE OPERATOR ANSWERING ONE HELD TOOL CALL, INLINE.
//
// It is a sibling of `main/session-reopen.js`'s `controlByTask` / `setModeByTask` /
// `messageByTask` and lives apart only because that file sits at the 500-line §1 cap; it moves
// back the day there is room. It takes `resolveSession` by injection so the multiplayer address
// rule stays stated once, in `session-reopen.js`, and it re-validates its own payload
// (`main/session-delete-op.js`'s rule: the gates go where the body is). `session-ipc-ops.js`
// keeps the IPC surface — op name, sender binding, refusal shape.
//
// IT DECIDES NOTHING. The gate already decided "hold and ask" (`session-gate-bridge.js ›
// gateCall`); this carries a HUMAN's answer to the resolver already parked. It cannot widen a
// posture, grant a tool for the task, or make a held call succeed that the profile would have
// refused — the verdict it answers was `gate`, never `deny`.
//
// ALLOW-ONCE ONLY, like the notification's Allow button: `allow-task` mints a STANDING grant,
// and a compact inline card is too small a surface to hand a session-wide power from.
//
// EXACTLY ONCE, proved by the resolver map rather than a flag here: the live check reads
// `s.pendingPermissions` (which `session-permissions.js › resolvePerm` deletes from as it
// answers) and the return is the dispatch's own FIX-F1 verdict, so a double click, a click
// racing the 10-minute TTL and a click on a fail-closed park all answer `{ ok: false }` with a
// reason rather than a blanket success over a call nobody resolved.
//
// An `outbound_gate` is not reachable from here and must not be made so: an own-channel post is
// decided on the CONSENT ROW (first-answer-wins, CAS'd server-side — INVARIANTS §6), and a local
// resolve racing that row is two answers to one question. The check below is deliberately on the
// request id being HELD, not on which kind of gate it is.

const { isUuid } = require('./ipc-guards');
const { isAgentId } = require('./agent-id');

// Bounded rather than shape-checked, the same treatment `taskId` gets: the opts may carry the
// platform's own id, an unrecognised value simply resolves nothing, and refusing on shape would
// teach a probe which shapes exist.
const REQUEST_ID_CAP = 64;

let deps = { resolveSession: null, dispatch: null };

/**
 * The engine injects the SHARED address resolver and its own dispatch funnel. Absent, every call
 * fails CLOSED — an unbound privileged verb is not a usable one.
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
 * THE ANSWER GOES THROUGH THE REDUCER, NEVER STRAIGHT TO THE RESOLVER. `permission_decision` is
 * the one event that resolves a gate: it clears the id from `state.pendingPermissions`, re-arms
 * the idle timer, emits `permission_resolved`, only then calls `resolvePerm`, and maps the
 * decision fail-closed. Writing to the resolver here would leave the reducer believing the call
 * was still held.
 *
 * The grant name rides along unused by `allow-once`: the reducer reads `event.name` only on
 * `allow-task`, and supplying the session's own recorded key means a later widening of this op
 * cannot key a standing grant on a renderer-chosen string.
 */
function answerPermissionByTask(a) {
  const p = a || {};
  const requestId = String(p.requestId || '');
  if (!requestId || !deps.resolveSession || !deps.dispatch) return { ok: false };
  const s = deps.resolveSession(p, String(p.channelId || ''), String(p.taskId || ''));
  if (!s || s.settled) return { ok: false, reason: 'no-session' };
  // The RESOLVER MAP, not `state.pendingPermissions`. The reducer's array is the projection the
  // card is drawn from; the Map is where a live `canUseTool` promise waits, and it is the one
  // `claimGate` and the TTL both test. An id in one and not the other is a session mid-teardown.
  if (!s.pendingPermissions || !s.pendingPermissions.has(requestId)) {
    return { ok: false, reason: 'unknown-request' };
  }
  // FAIL CLOSED ON ANYTHING BUT A LITERAL `true` — the same rule `session-permissions.js ›
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
 * THE BOUNDARY — what `sessions:answerPermission` forwards, validated here (`session-delete-op.js`'s
 * rule: the gates go where the body is). `channelId` is UUID-gated, `taskId` coerced, `agentId`
 * dropped to '' unless it matches the closed charset, `requestId` bounded. Every refusal is the
 * same `{ ok: false }` a sender-binding refusal answers, so a hostile page cannot learn which
 * window it is in.
 *
 * `agentId` matters more here than on most ops: every card is drawn from ONE agent's row, so the
 * oldest-live fallback would answer a different agent's question. It stays optional — a request
 * id is unique across this machine's sessions, so an unnamed one still cannot cross-answer.
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
