// AXIS B's ENFORCEMENT POINT ON THIS RUNTIME — the app-server's held approval request.
//
// Dopl's MCP server is remote HTTP and no posture crosses the wire, so Axis B needs a held callback.
// A Dopl call's approval arrives as `mcpServer/elicitation/request`, which blocks the turn on Dopl's
// answer and carries the tool's title and the call's arguments (`_meta.tool_title` / `tool_params`);
// `server-requests.js` names it and hands it to the gate below.

/** The held approval callback the launch spec wires; answers core's `{ behavior }` (F-382). */
const makeCanUseTool = require('../held-gate').makeHeldGate;

/** In-process Axis-B tool implementations: none — the held callback is the enforcement point. */
function axisBTools(_session) {
  return null;
}

// Descriptor half.
const descriptor = {
  enforcementPoint: 'held-callback',
  // Every Dopl elicitation names its tool and carries the call's full arguments.
  opScoped: true,
  // No input-rewrite route: the approval reply has no slot for rewritten arguments and no hook is
  // configured, so the forced thread tag is not applied on this runtime.
  inputRewrite: null,
  hardDeny: require('../../tool-profiles').UNIVERSAL_HARD_DENY.slice(),
};

module.exports = { makeCanUseTool, axisBTools, descriptor };
