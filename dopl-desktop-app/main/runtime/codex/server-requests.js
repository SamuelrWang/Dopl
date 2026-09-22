// SERVER -> CLIENT REQUESTS for the measured app-server v2 surface.
//
// Each method has its own response schema. Treating all of them as `{ decision }` is not merely
// imprecise: permissions, MCP elicitation and request_user_input reject that shape and can leave
// the turn waiting forever. This module owns the translation and always fails closed.

// ⚠ THE NAMING RULE LIVES IN `approval.js`, NOT HERE. That module is the one place a raw request
// becomes a name the gate can be asked about; this module is the one place a verdict becomes a
// reply in the method's own vocabulary. Two files, two jobs, and neither repeats the other's.
const approval = require('./approval');

const DECISION_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
]);

const EMPTY_PERMISSIONS = Object.freeze({
  fileSystem: null,
  network: Object.freeze({ enabled: false }),
});

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

function compact(input) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}

function approvalInput(method, params) {
  const p = params && typeof params === 'object' ? params : {};
  if (method === 'item/commandExecution/requestApproval') {
    return compact({ command: p.command, cwd: p.cwd, reason: p.reason });
  }
  if (method === 'item/fileChange/requestApproval') {
    return compact({ grantRoot: p.grantRoot, reason: p.reason });
  }
  if (method === 'item/permissions/requestApproval') {
    return (p.permissions && typeof p.permissions === 'object') ? p.permissions : {};
  }
  return {};
}

// ⚠ ONE ASK, ONE FAIL-CLOSED CATCH. A gate that throws is not an operator who said yes; every
// caller below routes through this so no request type can grow its own error handling.
async function ask(decide, name, input) {
  try {
    return await decide(name, input);
  } catch (_) {
    return 'deny';
  }
}

async function verdictFor(method, params, decide) {
  const name = method === 'item/commandExecution/requestApproval' ? 'commandExecution'
    : method === 'item/fileChange/requestApproval' ? 'fileChange'
      : 'request_permissions';
  return ask(decide, name, approvalInput(method, params));
}

// ── THE MCP ELICITATION — DOPL'S OWN SERVER GETS AN ALLOW PATH, NOBODY ELSE DOES ─────────────
//
// 🔒 ⚠ **THIS IS THE FIX FOR "A DOPL-LAUNCHED CODEX AGENT CANNOT POST"** (Samuel's ruling,
// 2026-09-22: *resolve it by server*). The approval for an MCP tool call arrives as
// `mcpServer/elicitation/request` carrying NO tool name and no `itemId` to join to the item that
// has one, so this method used to answer an unconditional `{ action: 'decline' }` — fail-closed,
// and also a Dopl MCP surface that could never be used at all on this runtime.
//
// ⚠ THE RULE, AND IT IS STRUCTURAL RATHER THAN TEXTUAL. `approval.js › doplElicitation` answers
// non-null ONLY when the request is a tool-call approval (`_meta.codex_approval_kind ===
// 'mcp_tool_call'`) raised by the server key DOPL ITSELF MOUNTED (`mcp.SERVER_KEY`). Nothing is
// read out of the operator-facing `message`. The NAME it answers with comes from Dopl's own
// per-tool approval table — the one tool on that entry configured to ask — and degrades to the
// un-named Dopl surface (which is in no allow-list, therefore gates) the moment that stops being
// a single tool.
//
// ⚠ IT CONSULTS THE GATE; IT DOES NOT SHORT-CIRCUIT IT. The same `decide` every other request type
// is answered by, carrying the call's own arguments, so Axis B's channel lanes, the hard-deny
// list, the audience belt and a standing grant all apply exactly as they do on every other
// runtime. An elicitation from ANY other server keeps declining without asking anyone — allowing
// a third party's tool on the strength of Dopl's posture is not a thing this gate was ever asked.
//
// ⚠ `action`, NOT `decision`, AND `cancel` IS NOT OURS TO SEND. This method's reply vocabulary is
// `{ action: 'accept' | 'decline' | 'cancel' }` — measured, and different from the four-word
// `{ decision }` the `item/*/requestApproval` methods take; answering those two shapes with each
// other's words leaves the turn waiting forever. Of the three words Dopl only ever sends two:
//   accept   — the gate allowed the call. Run it.
//   decline  — an ANSWER, and the answer is no. The turn continues and the model is told it was
//              refused, which is what Dopl's deny means everywhere else.
//   cancel   — NOT a verdict about the call: it means the ASK itself was abandoned (the surface
//              that was going to answer went away, the turn is being torn down). Dopl's gate
//              always produces a verdict — allow, deny, or a thrown gate which `ask` reads as
//              deny — so there is no state in which Dopl has no answer to give. Sending `cancel`
//              would report "nobody answered" for a call somebody DID refuse, and
//              `test/codex-server-requests.test.mjs` pins that no verdict ever produces it.
async function elicitationAnswer(params, decide) {
  const target = approval.doplElicitation(params);
  if (!target) return { action: 'decline' };
  const verdict = await ask(decide, target.name, target.input);
  return { action: verdict === 'allow' ? 'accept' : 'decline' };
}

async function answer(message, decide) {
  const msg = message && typeof message === 'object' ? message : {};
  const method = String(msg.method || '');
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  const gate = typeof decide === 'function' ? decide : async () => 'deny';

  if (DECISION_METHODS.has(method)) {
    const verdict = await verdictFor(method, params, gate);
    return { decision: verdict === 'allow' ? 'accept' : 'decline' };
  }
  if (method === 'item/permissions/requestApproval') {
    const verdict = await verdictFor(method, params, gate);
    const requested = params.permissions && typeof params.permissions === 'object'
      ? params.permissions : {};
    return {
      permissions: verdict === 'allow' ? requested : EMPTY_PERMISSIONS,
      scope: 'turn',
    };
  }
  // ⚠ THE ONE REQUEST WHOSE ANSWER IS `{ action }`. See `elicitationAnswer` — Dopl's own server
  // reaches the gate, every other server declines, and every malformed shape declines.
  if (method === approval.MCP_ELICITATION) return elicitationAnswer(params, gate);
  // Dopl has no surface for a free-form question to the operator. A made-up answer would be an
  // operator decision the operator never made, so this takes its protocol-valid empty path.
  if (method === 'item/tool/requestUserInput') return { answers: {} };

  throw rpcError(-32601, `Unsupported Codex server request: ${method || '(missing method)'}`);
}

module.exports = { answer, approvalInput, elicitationAnswer, EMPTY_PERMISSIONS, rpcError };
