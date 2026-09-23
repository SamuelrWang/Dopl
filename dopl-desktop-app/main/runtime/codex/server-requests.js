// SERVER -> CLIENT REQUESTS (the app-server's held approvals): each becomes a name the gate is
// asked about, and Dopl's verdict becomes that method's own reply. Fails closed everywhere.
//
// Reply shapes differ per method (`{decision}` / `{action}` / `{permissions, scope}` / `{answers}`);
// a wrong shape leaves the turn waiting forever.

const tools = require('./tools');
// The mount key and the asking table come from the file that builds the entry, so the elicitation
// comparison and the mount can never be two different words.
const mcp = require('./mcp');

const COMMAND_APPROVAL = 'item/commandExecution/requestApproval';
const FILE_APPROVAL = 'item/fileChange/requestApproval';
const PERMISSIONS_APPROVAL = 'item/permissions/requestApproval';
const MCP_ELICITATION = 'mcpServer/elicitation/request';
const USER_INPUT = 'item/tool/requestUserInput';

// The gate's name for each approval method: Codex's own item and category words, which the Axis-A
// lists and the restricted deny lists use. A method not here is answered -32601, never guessed.
const REQUEST_NAMES = Object.freeze({
  [COMMAND_APPROVAL]: tools.COMMAND_ITEM,
  [FILE_APPROVAL]: tools.FILE_ITEM,
  [PERMISSIONS_APPROVAL]: 'request_permissions',
});

const MCP_TOOL_CALL_KIND = 'mcp_tool_call';

// A Dopl tool the request did not name and the entry cannot resolve. In no allow-list, so it gates;
// it must not classify as the channel tool (`session-profiles.js › isChannelTool`, pinned by test).
const DOPL_TOOL_SURFACE = 'dopl_unnamed_tool';

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
  if (method === COMMAND_APPROVAL) return compact({ command: p.command, cwd: p.cwd, reason: p.reason });
  if (method === FILE_APPROVAL) return compact({ grantRoot: p.grantRoot, reason: p.reason });
  if (method === PERMISSIONS_APPROVAL) {
    return (p.permissions && typeof p.permissions === 'object') ? p.permissions : {};
  }
  return {};
}

/**
 * Is this elicitation a tool-call approval from DOPL'S OWN server, and under what name?
 * `{ name, input, derived }` or `null` (fail closed). The request carries no tool name, so the name
 * comes from Dopl's own entry (`mcp.soleAskingTool`), never from the operator-facing `message`.
 */
function doplElicitation(params) {
  const p = (params && typeof params === 'object') ? params : {};
  const meta = (p._meta && typeof p._meta === 'object') ? p._meta : null;
  // A server's own form or credential prompt is not a tool-call approval.
  if (!meta || meta.codex_approval_kind !== MCP_TOOL_CALL_KIND) return null;
  if (typeof p.serverName !== 'string' || p.serverName !== mcp.SERVER_KEY) return null;
  const sole = mcp.soleAskingTool();
  const args = meta.tool_params;
  // Arrays are rejected: the channel classifiers read `input.op`.
  const input = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
  return { name: sole || DOPL_TOOL_SURFACE, input, derived: !!sole };
}

// A gate that throws is not an operator who said yes.
async function ask(decide, name, input) {
  try {
    return await decide(name, input);
  } catch (_) {
    return 'deny';
  }
}

/**
 * The `{ decision }` reply. Never `acceptForSession`: that records one click on two ledgers, and
 * Codex's own grant is scoped by something Dopl cannot read.
 */
function decisionReply(verdict) {
  return { decision: verdict === 'allow' ? 'accept' : 'decline' };
}

// `{ action }`, not `{ decision }`. Dopl's own server reaches the gate; every other server declines
// unasked. `cancel` is never sent: it means nobody answered, and the gate always answers.
async function elicitationAnswer(params, decide) {
  const target = doplElicitation(params);
  if (!target) return { action: 'decline' };
  const verdict = await ask(decide, target.name, target.input);
  return { action: verdict === 'allow' ? 'accept' : 'decline' };
}

async function answer(message, decide) {
  const msg = message && typeof message === 'object' ? message : {};
  const method = String(msg.method || '');
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  const gate = typeof decide === 'function' ? decide : async () => 'deny';

  if (method === COMMAND_APPROVAL || method === FILE_APPROVAL) {
    return decisionReply(await ask(gate, REQUEST_NAMES[method], approvalInput(method, params)));
  }
  if (method === PERMISSIONS_APPROVAL) {
    const verdict = await ask(gate, REQUEST_NAMES[method], approvalInput(method, params));
    const requested = params.permissions && typeof params.permissions === 'object' ? params.permissions : {};
    return { permissions: verdict === 'allow' ? requested : EMPTY_PERMISSIONS, scope: 'turn' };
  }
  if (method === MCP_ELICITATION) return elicitationAnswer(params, gate);
  // Dopl has no surface for a free-form question; this is the protocol-valid empty answer.
  if (method === USER_INPUT) return { answers: {} };

  throw rpcError(-32601, `Unsupported Codex server request: ${method || '(missing method)'}`);
}

// Descriptor half — Axis A's answer shape.
const descriptor = {
  // The approval requests are server->client JSON-RPC requests that block the turn on our reply.
  heldCallback: true,
  // Codex gates a shell command, a file change, an escalation — not a named built-in.
  granularity: 'category',
  categories: tools.GRANULAR_CATEGORIES.slice(),
};

module.exports = {
  answer, decisionReply, doplElicitation, descriptor,
  approvalInput, rpcError,
  DOPL_TOOL_SURFACE,
};
