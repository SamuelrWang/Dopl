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

/**
 * The callback a runtime's permission hook calls. Answers `{ behavior }`, never the platform's
 * words: the operator's own click resolves the same parked promise in that shape (F-382).
 */
function makeHeldGate(s, dispatch, log) {
  return function heldGate(name, input, opts) {
    const decision = bridge().gateCall(s, name, input, opts, dispatch, log);
    if (decision.settled) return Promise.resolve(settledVerdict(decision));
    // The platform blocks the turn on this promise; that is what makes `gate` a real verdict.
    return new Promise((resolve) => decision.park(resolve));
  };
}

module.exports = { makeHeldGate, settledVerdict };
