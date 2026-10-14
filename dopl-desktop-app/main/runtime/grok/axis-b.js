// AXIS B's ENFORCEMENT POINT ON THIS RUNTIME — ACP's held `session/request_permission`, forced for every
// Dopl MCP call by the private config's ask rule (`config-home.js › ASK_RULE`), with Grok's synchronous
// PreToolUse client hook (`_x.ai/hooks/run`) in front of it.
//
// Dopl's MCP server is remote HTTP and no posture crosses the wire, so Axis B needs a held callback. MEASURED
// (grok 1.0.52, `smoke-s1`/`smoke-s2`): in Grok's `default` mode every Dopl MCP call raises
// `request_permission` (even a `readOnlyHint` one); under `autoMode` NONE does unless the ask rule is present
// — with it, every one does; under `yoloMode` none does even with the rule and the bypass lock, so Dopl
// never sends it (`policy.js`). The call is named by `rawInput.tool_name` (`use_tool` unwrapped,
// `approval.js`), its arguments are `rawInput.tool_input`.
//
// THE HOOK FAILS OPEN (timeout, transport error, malformed reply — SRC `hooks.rs › fail_open`), so it only
// carries verdicts that are decided at once: Dopl's hard-deny and the containment deny list, and a gate
// verdict the gate SETTLED without asking anyone. A verdict that waits for the operator is answered
// `continue` and held in `request_permission`, which has no timeout.

/** The held approval callback the launch spec wires; answers core's `{ behavior }` (F-382). */
const makeCanUseTool = require('../held-gate').makeHeldGate;

/** In-process Axis-B tool implementations: none — the held callback is the enforcement point. */
function axisBTools(_session) {
  return null;
}

const descriptor = {
  enforcementPoint: 'held-callback',
  // Every Dopl permission request names its tool and carries the call's full arguments.
  opScoped: true,
  // Neither reply can carry rewritten arguments (a hook `updatedInput` field exists in source only — smoke
  // S11): the forced thread tag is not applied here.
  inputRewrite: null,
  hardDeny: require('../../tool-profiles').UNIVERSAL_HARD_DENY.slice(),
};

module.exports = { makeCanUseTool, axisBTools, descriptor };
