// SERVER -> CLIENT REQUESTS (the app-server's held approvals): each becomes a name the gate is
// asked about, and Dopl's verdict becomes that method's own reply. Fails closed everywhere.
//
// Reply shapes differ per method (`{decision}` / `{action}` / `{permissions, scope}` / `{answers}`);
// a wrong shape leaves the turn waiting forever.

const tools = require('./tools');
// The mount key comes from the file that builds the entry, so the comparison and the mount are one word.
const mcp = require('./mcp');
const { DOPL_SHORT_NAMES } = require('../../mcp-tool-names');

const COMMAND_APPROVAL = 'item/commandExecution/requestApproval';
const FILE_APPROVAL = 'item/fileChange/requestApproval';
const PERMISSIONS_APPROVAL = 'item/permissions/requestApproval';
const MCP_ELICITATION = 'mcpServer/elicitation/request';
const USER_INPUT = 'item/tool/requestUserInput';

// The gate's name for each approval method: Codex's own item and category words, which the Axis-A
// lists and the restricted deny lists use. A method not here is ASKED under `UNKNOWN_PREFIX` and SHOWN
// (`hooks.onUnknown`); its reply is built only from the build's own schema (`hooks.replyFor`), never guessed.
const REQUEST_NAMES = Object.freeze({
  [COMMAND_APPROVAL]: tools.COMMAND_ITEM,
  [FILE_APPROVAL]: tools.FILE_ITEM,
  [PERMISSIONS_APPROVAL]: 'request_permissions',
});

const MCP_TOOL_CALL_KIND = 'mcp_tool_call';

// The gate's name for a request Dopl does not recognise — the SHARED prefix (`../sdk-shape.js`), so the gate's
// one rule applies: no standing task grant, denied on a restricted profile.
const UNKNOWN_PREFIX = require('../sdk-shape').UNRECOGNISED_REQUEST_PREFIX;

// The request's only per-tool identity: Codex copies the called tool's `title` here
// (codex-rs `core/src/mcp_tool_call.rs › mcp_tool_metadata` → `build_mcp_tool_approval_elicitation_meta`),
// and Dopl's server titles every tool with its own name (`packages/mcp-server/src/registrar.ts › toolConfig`).
const TOOL_TITLE_META = 'tool_title';

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
 * Which Dopl tool is this tool-call approval for? `{ name, input }`, or `{ refused }` saying why it is
 * declined unasked. Named only by `_meta.tool_title` — never the operator-facing `message`.
 */
function doplElicitation(params) {
  const call = toolCall(params);
  // A server's own form or credential prompt is not a tool-call approval.
  if (!call) return { refused: 'not a tool-call approval' };
  if (call.server !== mcp.SERVER_KEY) return { refused: 'not from Dopl\'s MCP server' };
  // An older Dopl server publishes no titles: its asks cannot be named, so none of them runs.
  if (!call.title) return { refused: `no _meta.${TOOL_TITLE_META} names the tool` };
  if (DOPL_SHORT_NAMES.indexOf(call.title) === -1) return { refused: `${JSON.stringify(call.title)} is not a Dopl tool` };
  return { name: call.title, input: call.input };
}

// `{ server, title, input }` for a tool-call approval, else null. Arrays are rejected: classifiers read `input.op`.
function toolCall(params) {
  const p = (params && typeof params === 'object') ? params : {};
  const meta = (p._meta && typeof p._meta === 'object') ? p._meta : null;
  if (!meta || meta.codex_approval_kind !== MCP_TOOL_CALL_KIND) return null;
  const args = meta.tool_params;
  return {
    server: p.serverName,
    title: typeof meta[TOOL_TITLE_META] === 'string' ? meta[TOOL_TITLE_META] : '',
    input: (args && typeof args === 'object' && !Array.isArray(args)) ? args : {},
  };
}

/** A tool-call approval from one of the operator's own servers ("Use my tools"), named the way the gate
 *  classifies an operator tool (`mcp__<server>__<tool>`), or null. */
function operatorElicitation(params, servers) {
  const call = toolCall(params);
  if (!call || call.server === mcp.SERVER_KEY || !servers || !servers.has(call.server)) return null;
  return { name: `mcp__${call.server}__${call.title || 'tool'}`, input: call.input };
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

// `{ action }`, not `{ decision }`. A named Dopl tool reaches the gate; anything else declines unasked.
// `cancel` is never sent: it means nobody answered, and the gate always answers.
async function elicitationAnswer(params, decide, log, operatorServers) {
  const target = operatorElicitation(params, operatorServers) || doplElicitation(params);
  if (target.refused) {
    log(`codex: MCP approval declined unasked — ${target.refused}`);
    return { action: 'decline' };
  }
  const verdict = await ask(decide, target.name, target.input);
  return { action: verdict === 'allow' ? 'accept' : 'decline' };
}

/** A summary of an unknown request's params for the operator's card: top-level scalars only, bounded. */
function unknownInput(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {}).slice(0, 12)) {
    if (v == null || typeof v === 'object') continue;
    out[k] = String(v).slice(0, 300);
  }
  return out;
}

/**
 * A request Dopl does not recognise (2026-10-08): never a silent deny. It is SHOWN (`onUnknown` → a drift
 * note in the session lane), ASKED through the gate like any approval, and answered only in a shape the
 * build's own schema states (`replyFor(method, 'accept'|'decline')`). With no schema answer the request
 * gets an error naming why — the turn moves on, and the lane already says what happened.
 */
async function unknownAnswer(method, params, gate, log, hooks) {
  const h = hooks || {};
  try { if (typeof h.onUnknown === 'function') h.onUnknown(method); } catch (_) { /* showing never fails */ }
  log(`codex: unrecognised server request ${method} — asked, not guessed`);
  const verdict = await ask(gate, `${UNKNOWN_PREFIX}${method}`, unknownInput(params));
  const replyFor = typeof h.replyFor === 'function' ? h.replyFor : () => null;
  let reply = null;
  try { reply = replyFor(method, verdict === 'allow' ? 'accept' : 'decline'); } catch (_) { reply = null; }
  if (reply && typeof reply === 'object') return reply;
  throw rpcError(-32601, `Dopl does not know how to answer Codex's ${method} request in this version`);
}

/** `operatorServers`: the Set of the operator's own mounted server names ("Use my tools"), or absent.
 *  `hooks`: `{ onUnknown(method), replyFor(method, decision) }` for requests Dopl does not recognise. */
async function answer(message, decide, log, operatorServers, hooks) {
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
  if (method === MCP_ELICITATION) {
    return elicitationAnswer(params, gate, typeof log === 'function' ? log : () => {}, operatorServers);
  }
  // Dopl has no surface for a free-form question; this is the protocol-valid empty answer.
  if (method === USER_INPUT) return { answers: {} };

  if (!method) throw rpcError(-32600, 'Codex sent a server request with no method');
  return unknownAnswer(method, params, gate, typeof log === 'function' ? log : () => {}, hooks);
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
  answer, decisionReply, doplElicitation, operatorElicitation, descriptor,
  approvalInput, rpcError, UNKNOWN_PREFIX,
};
