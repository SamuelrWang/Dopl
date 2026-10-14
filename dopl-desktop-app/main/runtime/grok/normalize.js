// One raw ACP frame (or one of `launch-spec.js`'s synthetic `dopl/*` frames) in, `CoreEvent[]` out. Pure (no
// I/O, dispatch, mutation or clock); owns all three raw-message consumers: the auth sentinel, the render
// mapping and the per-turn usage. Text is rendered from WHOLE messages, never chunks: `launch-spec.js`
// accumulates `agent_message_chunk` / `agent_thought_chunk` and flushes at a tool call and at the prompt's end
// (the outbound card must show the exact bytes a post sends).

const events = require('../events');
const io = require('../../session-io');
const authShape = require('../kit/auth-shape');
const kitUsage = require('../kit/usage');
const { gateNameOf, USE_TOOL, SERVER_KEY } = require('./tools');

// ── SYNTHETIC FRAMES (minted by `launch-spec.js`) ─────────────────────────────────────────────
const SESSION_STARTED = 'dopl/sessionStarted';
const MESSAGE = 'dopl/message';
const THOUGHT = 'dopl/thought';
const PROMPT_RESULT = 'dopl/promptResult';
const PROMPT_FAILED = 'dopl/promptFailed';
const AUTH_REQUIRED = 'dopl/authRequired';
const UNKNOWN_REQUEST = 'dopl/unknownRequest';
const UNASKED = 'dopl/unasked';
const UNSAFE = 'dopl/unsafe';
const ERROR_MESSAGE_TYPE = events.ERROR_FRAME;

// ── AUTH ─────────────────────────────────────────────────────────────────────────────────────
// Grok's structured signal is JSON-RPC `-32000 "Authentication required"` (LIVE, `g3-auth-shapes.ndjson`);
// `launch-spec.js` mints AUTH_REQUIRED for it and for a handshake that offers no cached token.
const isAuthShaped = (text) => authShape.authShaped(text, /XAI_API_KEY|grok login|no auth method/i);
const AUTH_CODE = -32000;

const mcpLine = 'Dopl\'s tools did not connect, so the agent cannot reach Dopl.';
const turnFailureLine = (text) => `Grok could not finish this turn${text ? `: ${text}` : '.'}`;
// `_x.ai/mcp/server_status` words that mean Dopl's server is not coming up.
const MCP_FAILED = ['failed', 'error', 'disabled', 'blocked'];
const MCP_OK = ['ready', 'connecting', 'initializing', 'starting', 'pending'];

// ── USAGE ────────────────────────────────────────────────────────────────────────────────────
// Per prompt (LIVE): `session/prompt` result `_meta.usage {inputTokens, outputTokens, totalTokens,
// cachedReadTokens, …}`. `cachedReadTokens` is a SUBSET of `inputTokens` (17 792 ≤ 17 896, LIVE), so no
// `cached` keys. `launch-spec.js` sums the per-prompt totals into the session's running total (a new process
// starts at zero — `usageResetsOnResume: true`) and hands it here as `cumulative.totalTokens`.
const USAGE_KEYS = Object.freeze({ input: ['inputTokens'], output: ['outputTokens'], total: ['totalTokens'] });
const tokensFrom = (usage) => kitUsage.tokensFrom(usage, USAGE_KEYS);

const posInt = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const str = (v) => (typeof v === 'string' ? v : '');
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// ── RENDER ───────────────────────────────────────────────────────────────────────────────────

/** A `tool_call` → `{ id, name, input }`: `use_tool` unwrapped to the MCP tool it dispatches. */
function toolCallOf(update) {
  const u = obj(update);
  const raw = obj(u.rawInput);
  const meta = obj(obj(u._meta)['x.ai/tool']);
  const id = str(u.toolCallId);
  if ((str(meta.name) === USE_TOOL || str(u.title) === USE_TOOL) && str(raw.tool_name)) {
    return { id, name: gateNameOf(raw.tool_name), input: obj(raw.tool_input) };
  }
  const input = Object.assign({}, raw);
  delete input.variant;
  return { id, name: str(meta.name) || str(u.title) || 'unknown', input };
}

/** The text a finished tool reported (first text block, else the MCP output). */
function resultText(update) {
  const u = obj(update);
  for (const c of Array.isArray(u.content) ? u.content : []) {
    const inner = obj(obj(c).content);
    if (str(inner.text)) return inner.text;
  }
  const out = obj(obj(u.rawOutput).output);
  return str(out.OkayOutput) || str(out.ErrorOutput) || str(obj(u.rawOutput).output_for_prompt);
}

// Known `session/update` kinds Dopl does not render (`grok-runtime.md` §4).
const QUIET_UPDATES = new Set(['available_commands_update', 'session_info_update', 'config_option_update', 'plan',
  'current_mode_update', 'user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk']);

function updateEvents(params, ctx) {
  const u = obj(obj(params).update);
  const kind = str(u.sessionUpdate);
  if (kind === 'tool_call') {
    const call = toolCallOf(u);
    return call.id ? events.toolCallEvents(call, ctx) : [];
  }
  if (kind === 'tool_call_update') {
    const status = str(u.status);
    if (status !== 'completed' && status !== 'failed') return [];
    const id = str(u.toolCallId);
    if (!id) return [];
    // `ok` is false only on an explicit failure: a false negative retracts a post the operator saw sent.
    return [events.toolResult({ type: 'tool_result', toolUseId: id, ok: status === 'completed', resultSummary: io.summarizeResult(resultText(u)) })];
  }
  if (QUIET_UPDATES.has(kind)) return [];
  return [events.shapeDrift(`update:${kind || 'unknown'}`, `Grok sent a session update of kind "${kind}", which this Dopl does not recognise`)];
}

function promptResultEvents(params) {
  const p = obj(params);
  const model = p.model || null;
  const out = [];
  // No context event without a measurement: the reducer writes `contextTokens` unconditionally.
  const used = posInt(p.contextUsed);
  if (used !== null) out.push(events.context(used, model, posInt(p.contextWindow)));
  const t = tokensFrom(p.cumulative);
  out.push(events.result(t.session, model));
  if (p.usageUnread === true) out.push(events.shapeDrift('usage', 'a turn reported token usage in a shape this Dopl cannot read'));
  return out;
}

function promptFailedEvents(params) {
  const p = obj(params);
  const text = str(p.message);
  // The auth sentinel returns alone: core holds the session, and a bubble beside it would paint the very
  // bubble the hold replaces.
  if (p.code === AUTH_CODE && /authentication required/i.test(text)) return [events.authHold(text)];
  if (isAuthShaped(text)) return [events.authHold(text)];
  return [events.assistant(turnFailureLine(text)), events.result(tokensFrom(p.cumulative).session, p.model || null)];
}

function mcpStatusEvents(params) {
  const p = obj(params);
  if (str(p.name) !== SERVER_KEY) return [];
  const status = str(p.status).toLowerCase();
  if (MCP_OK.indexOf(status) !== -1) return [];
  if (MCP_FAILED.indexOf(status) !== -1) return [events.assistant(mcpLine), events.mcpStatus('failed')];
  return [events.shapeDrift('mcp-status', `Grok reported Dopl's server as "${status}", which this Dopl does not recognise`)];
}

// Routine traffic Dopl reads elsewhere (`launch-spec.js`) or drops by design (`grok-runtime.md` §4).
const ROUTINE = new Set([
  '_x.ai/session_notification', '_x.ai/session/setup', '_x.ai/session/prompt_complete', '_x.ai/session/update',
  '_x.ai/mcp_initialized', '_x.ai/mcp/servers_updated', '_x.ai/mcp/init_progress', '_x.ai/queue/changed',
  '_x.ai/sessions/changed', '_x.ai/models/update', '_x.ai/settings/update', '_x.ai/announcements/update',
  '_x.ai/session/interjection',
]);

/** ONE raw frame → the CoreEvents it means. */
function normalize(msg, ctx) {
  const context = ctx || {};
  if (!msg || typeof msg !== 'object') return [];
  // Core's rejection frame: platform text, classified here.
  if (msg.type === ERROR_MESSAGE_TYPE) {
    const text = String(msg.text == null ? '' : msg.text);
    return isAuthShaped(text) ? [events.authHold(text)] : [];
  }
  const method = str(msg.method);
  if (!method) return [];
  const params = obj(msg.params);
  switch (method) {
    case SESSION_STARTED: return [events.launched(params.sessionId || null, params.model || null)];
    case MESSAGE: return str(params.text).trim() ? [events.assistant(params.text)] : [];
    case THOUGHT: return str(params.text).trim() ? [events.thinking(params.text)] : [];
    case PROMPT_RESULT: return promptResultEvents(params);
    case PROMPT_FAILED: return promptFailedEvents(params);
    case AUTH_REQUIRED: return [events.authHold(str(params.text) || 'Grok is not signed in for Dopl.')];
    case UNSAFE: return [events.safetyMismatch(str(params.text))];
    case UNKNOWN_REQUEST:
      return [events.shapeDrift('server-request', `Grok asked for "${str(params.method)}", which this Dopl does not recognise`)];
    case UNASKED:
      return [events.shapeDrift('permission', `Grok ran ${str(params.tool) || 'a Dopl tool'} without asking Dopl first — check the private config's ask rule`)];
    case 'session/update': return updateEvents(params, context);
    case '_x.ai/mcp/server_status': return mcpStatusEvents(params);
    default: return [];
  }
}

module.exports = {
  normalize, tokensFrom, isAuthShaped, toolCallOf, resultText, USAGE_KEYS, ROUTINE,
  SESSION_STARTED, MESSAGE, THOUGHT, PROMPT_RESULT, PROMPT_FAILED, AUTH_REQUIRED, UNKNOWN_REQUEST, UNASKED, UNSAFE,
  ERROR_MESSAGE_TYPE, AUTH_CODE,
};
