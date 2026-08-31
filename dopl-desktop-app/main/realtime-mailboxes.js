// THE EXTRA MAILBOX BINDINGS THIS SOCKET ALSO CARRIES.
//
// ⚠ **SPLIT OUT OF `realtime.js` ON 2026-08-31**, at the §1 cap and on a REASON rather than on
// the count that forced the question: this file changes when a MAILBOX is added or one of
// their operator consents moves, where `realtime.js` changes when the SOCKET, its breaker or
// its health story moves. Both `setX` functions are re-exported from there, so no caller moved.
//
// ⚠ **THE FLAGS ARE PER-MAILBOX AND MUST STAY THAT WAY.** A launch directive and a private
// DIRECTION have SEPARATE operator consents — launching buys COMPUTE, directing reaches a
// running agent's PRIVATE lane — so a shared flag could not express "one on, one off", which
// is a state an operator is entitled to be in.
//
// ⚠ **FLIPPING EITHER FLAG REJOINS EVERY WORKSPACE**, because `postgres_changes` bindings are
// fixed at JOIN time. The rejoin LOOP belongs to `realtime.js` (it owns `subs`); the decision
// to run it belongs here, so it is injected.
//
// 🔒 **EVERY FILTER HERE IS `workspace_id=eq.<id>` — WORKSPACE-WIDE, NOT OPERATOR-SCOPED.** A
// raw frame therefore reaches its handler for rows belonging to OTHER members, which is why
// both watchers re-check the row's operator against the signed-in user locally before acting
// (`launch-directives.js` / `agent-directions.js`, both at gate 3). A realtime frame arrives
// under a SUBSCRIPTION, never under a per-row auth answer.

const { diag } = require('./diag');

let bindDirectives = false;
let bindDirections = false;
let onDirectiveCb = null;
let onDirectionCb = null;

/**
 * Chain this socket's extra bindings on, before `.subscribe()`.
 *
 * ⚠ RETURNS THE CHANNEL so the caller keeps the builder shape it had, and a mailbox that is
 * off adds nothing at all — a machine that never opts in never names the table on the wire.
 */
function applyBindings(ch, wsId) {
  let out = ch;
  if (bindDirectives) {
    out = out.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'channel_launch_directives', filter: `workspace_id=eq.${wsId}` },
      (payload) => onDirective(wsId, payload)
    );
  }
  if (bindDirections) {
    out = out.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'channel_agent_directions', filter: `workspace_id=eq.${wsId}` },
      (payload) => onDirection(wsId, payload)
    );
  }
  return out;
}

/**
 * A PRIVATE DIRECTION ARRIVED (2026-08-31).
 *
 * ⚠ THE FILTER IS `workspace_id=eq.<id>` — WORKSPACE-WIDE, NOT OPERATOR-SCOPED — so this
 * handler sees other members' rows too. That is why `agent-directions.js › handle` re-checks
 * `operatorUserId` against the signed-in user locally before it claims anything: a realtime
 * frame arrives under a SUBSCRIPTION, not under a per-row auth answer.
 */
function onDirection(wsId, payload) {
  const row = payload && payload.new;
  if (!row || !onDirectionCb) return;
  diag('realtime direction', String(wsId).slice(0, 8), 'row', String(row.id || '').slice(0, 8));
  try {
    onDirectionCb(wsId, row);
  } catch (_) {
    /* one direction must not kill the socket */
  }
}

function onDirective(wsId, payload) {
  const row = payload && payload.new;
  if (!row || !onDirectiveCb) return;
  // The id PREFIX only — a directive carries a free-text goal, and this log is a support
  // artifact. `launch-directives.js` owns what may be said about one.
  diag('realtime directive', String(wsId).slice(0, 8), 'row', String(row.id || '').slice(0, 8));
  try { onDirectiveCb(wsId, row); } catch (_) { /* one directive must not kill the socket */ }
}

/**
 * ARM / DISARM the PRIVATE DIRECT LANE's binding, on the SAME per-workspace socket.
 *
 * ⚠ THE HANDLER RIDES HERE rather than in `start()`'s options, `setDirectives`' arrangement
 * and reason: the handler and the subscription that feeds it are armed by ONE call, so
 * neither can exist without the other.
 * ⚠ FLIPPING THE FLAG REJOINS, because `postgres_changes` bindings are fixed at join time.
 * Idempotent on no-change so a toggle written twice costs nothing.
 */
function setDirections(on, handler, rejoin) {
  const next = on === true;
  onDirectionCb = next && typeof handler === 'function' ? handler : null;
  if (next === bindDirections) return;
  bindDirections = next;
  diag('realtime directions', next ? 'ARMED' : 'disarmed', '— rejoining');
  if (typeof rejoin === 'function') rejoin();
}

function setDirectives(on, handler, rejoin) {
  const next = on === true;
  onDirectiveCb = next && typeof handler === 'function' ? handler : null;
  if (next === bindDirectives) return;
  bindDirectives = next;
  diag('realtime directives', next ? 'ARMED' : 'disarmed', '— rejoining');
  if (typeof rejoin === 'function') rejoin();
}

/** A full stop: every mailbox off, every handler dropped. Called from `realtime.js › stop`. */
function reset() {
  bindDirectives = false;
  bindDirections = false;
  onDirectiveCb = null;
  onDirectionCb = null;
}

module.exports = { applyBindings, setDirectives, setDirections, reset };
