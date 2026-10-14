// The held permission callback every runtime wires: Dopl's gate (`session-gate-bridge.js ›
// gateCall`), settled now or parked for the operator, answered in core's `{ behavior }` vocabulary.

const { OPERATOR_DENY_MESSAGE } = require('../session-permissions');
// Lazy: both reach `session-profiles.js`, which asks this registry for every decision (load cycle).
const bridge = () => require('../session-gate-bridge');
const outboundTag = () => require('../session-outbound-tag');

/** A settled gate decision as core's verdict: the tagged allow, or a deny with its sentence. */
function settledVerdict(decision) {
  const d = decision || {};
  return d.verdict === 'allow'
    ? outboundTag().allowResult(d.tag || null)
    : { behavior: 'deny', message: d.message || OPERATOR_DENY_MESSAGE };
}

// The two refusals an adapter may opt into (runtime scaffold K7, 2026-10-13; moved from cursor/axis-b.js).
const CLOSED_MESSAGE = 'This session has ended.';
const NO_SURFACE_MESSAGE = 'This session has no surface to ask on.';

/**
 * The callback a runtime's permission hook calls. Answers `{ behavior }`, never the platform's
 * words: the operator's own click resolves the same parked promise in that shape (F-382).
 *
 * `options` (absent = the plain held gate, which is what a held-callback runtime passes):
 *   `isClosed(s)` — a close latch: once true, every call is denied BEFORE the gate is asked (an ended
 *                   session cannot post, read the channel or write the workspace);
 *   `denyWithoutDispatch` — `true`: a call the gate did not settle is DENIED when there is no dispatch,
 *                   because `decision.park` paints its card through the engine's dispatch and with none
 *                   there is no surface to ask on (fail closed).
 */
function makeHeldGate(s, dispatch, log, options) {
  const o = options || {};
  return function heldGate(name, input, opts) {
    if (typeof o.isClosed === 'function' && o.isClosed(s)) {
      return Promise.resolve({ behavior: 'deny', message: CLOSED_MESSAGE });
    }
    const decision = bridge().gateCall(s, name, input, opts, dispatch, log);
    if (decision.settled) return Promise.resolve(settledVerdict(decision));
    if (o.denyWithoutDispatch === true && typeof dispatch !== 'function') {
      return Promise.resolve({ behavior: 'deny', message: NO_SURFACE_MESSAGE });
    }
    // The platform blocks the turn on this promise; that is what makes `gate` a real verdict.
    return new Promise((resolve) => decision.park(resolve));
  };
}

module.exports = { makeHeldGate, settledVerdict, CLOSED_MESSAGE, NO_SURFACE_MESSAGE };
