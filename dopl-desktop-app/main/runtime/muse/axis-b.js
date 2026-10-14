// AXIS B's ENFORCEMENT POINT ON THIS RUNTIME — MSP's held approval (`approval/request` +
// `approval/requested`, decided by `approval/decide`).
//
// Dopl's MCP server is remote HTTP and no posture crosses the wire, so Axis B needs a held callback. A Dopl
// tool call's approval arrives as subject `tool` with `toolName` `mcp__dopl_session__<tool>` and the call's
// verbatim arguments (`rawArgs`); `approval.js` names it and hands it to the gate below. The approval MODE
// decides whether it is asked at all (`policy.js`): `promptUnmatched` and `onRequest` ask for a non-read-only
// MCP tool (MSP docs; real-model smoke item), and Dopl never sends a mode that asks nothing.

/** The held approval callback the launch spec wires; answers core's `{ behavior }` (F-382). */
const makeCanUseTool = require('../held-gate').makeHeldGate;

/** In-process Axis-B tool implementations: none — the held callback is the enforcement point. */
function axisBTools(_session) {
  return null;
}

const descriptor = {
  enforcementPoint: 'held-callback',
  // Every Dopl tool approval names its tool and carries the call's full arguments.
  opScoped: true,
  // `approval/decide` has no slot for rewritten arguments: the forced thread tag is not applied here.
  inputRewrite: null,
  hardDeny: require('../../tool-profiles').UNIVERSAL_HARD_DENY.slice(),
};

module.exports = { makeCanUseTool, axisBTools, descriptor };
