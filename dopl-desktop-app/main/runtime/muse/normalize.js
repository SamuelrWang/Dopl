// One raw MSP frame in, `CoreEvent[]` out. Pure (no I/O, dispatch, mutation or clock); owns all three
// raw-message consumers: the auth sentinel, the render mapping and the per-turn usage.
// Renders on `item/completed`, never deltas: the outbound card must show the exact bytes a post sends.
// Items are `{ itemId, kind, status, … }` (MSP `Item`); `kind` is the only discriminator, and an unknown
// kind must render generically, never fail (Meta's `tolerance-*` transcripts).

const events = require('../events');
const io = require('../../session-io');
const authShape = require('../kit/auth-shape');
const kitUsage = require('../kit/usage');

// ── SYNTHETIC FRAMES ─────────────────────────────────────────────────────────────────────────
// `launch-spec.js` mints SESSION_STARTED (session id + model into core); UNKNOWN_REQUEST names a server
// request Dopl did not recognise; core mints the rejection frame (`events.ERROR_FRAME`).
const SESSION_STARTED = 'dopl/sessionStarted';
const UNKNOWN_REQUEST = 'dopl/unknownRequest';
const ERROR_MESSAGE_TYPE = events.ERROR_FRAME;

// ── AUTH ─────────────────────────────────────────────────────────────────────────────────────
// MSP's structured signal is `turn/completed error.kind:"authRequired"` (mid-turn failures never arrive as
// a JSON-RPC error). The kit pattern also covers core's rejection frame; `META_API_KEY` is Muse's own
// spelling in its signed-out text.
const isAuthShaped = (text) => authShape.authShaped(text, /META_API_KEY|muse login/i);
const AUTH_KINDS = ['authRequired'];

// Dopl's MCP server did not start for the session (`mcp.js`: mode `required`) — measured 1.4.7 as
// `configError` "Required MCP server `dopl_session` failed during startup"; `mcpLinkError` is the schema's.
const MCP_FAILURE_RE = /Required MCP server `dopl_[a-z_]+`/;
const isMcpFailure = (e) => e.kind === 'mcpLinkError' || MCP_FAILURE_RE.test(String(e.message || ''));
const mcpLine = 'Dopl\'s tools did not connect, so the agent will not run without them.';
const turnFailureLine = (text) => `Muse could not finish this turn${text ? `: ${text}` : '.'}`;

// ── USAGE ────────────────────────────────────────────────────────────────────────────────────
// `launch-spec.js` attaches the session's CUMULATIVE `session/tokenUsage.cumulative.totalTokens` (carried
// across a turn with no update, `kit/usage.js › makeUsageCarry`) and the last `session/contextUsage`. MSP's
// `promptTokens` is "counted once under the provider's cache convention" (server-derived), so Dopl never
// re-derives a cache convention: no `cached` keys.
const USAGE_KEYS = Object.freeze({ input: ['promptTokens'], output: ['outputTokens'], total: ['totalTokens'] });
const tokensFrom = (usage) => kitUsage.tokensFrom(usage, USAGE_KEYS);

const posInt = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

// ── RENDER ───────────────────────────────────────────────────────────────────────────────────
const MESSAGE_KINDS = ['agentMessage'];
const THINKING_KINDS = ['reasoning'];
// A tool card (the generic "Used N tools" render): the model's own tool calls and its searches/children.
const TOOL_KINDS = ['toolCall', 'webSearch', 'subagent', 'userShell'];
// Known kinds Dopl does not render: the operator's own message echo, observer/workflow children, hooks,
// compaction, side chats.
const QUIET_KINDS = ['userMessage', 'reminderChild', 'workflow', 'compaction', 'hookRun', 'sideChat'];

const itemOf = (params) => (params && params.item && typeof params.item === 'object' ? params.item : {});
const str = (v) => (typeof v === 'string' ? v : '');

function argsOf(item) {
  if (typeof item.args === 'string' && item.args) {
    try {
      const parsed = JSON.parse(item.args);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) { /* almost-JSON is shown, not parsed */ }
    return { args: item.args };
  }
  if (item.kind === 'userShell' && item.commandText) return { command: item.commandText };
  if (item.objective) return { objective: item.objective };
  return {};
}

function toolNameOf(item) {
  return str(item.tool) || str(item.agentPath) || str(item.kind) || 'unknown';
}

function startedEvents(item, ctx) {
  const id = str(item.itemId);
  if (!id || TOOL_KINDS.indexOf(item.kind) === -1) return [];
  return events.toolCallEvents({ id, name: toolNameOf(item), input: argsOf(item) }, ctx);
}

function completedEvents(item, ctx) {
  const kind = str(item.kind);
  if (MESSAGE_KINDS.indexOf(kind) !== -1) {
    const text = str(item.text);
    return text ? [events.assistant(text)] : [];
  }
  if (THINKING_KINDS.indexOf(kind) !== -1) {
    const text = Array.isArray(item.summary) ? item.summary.filter((s) => typeof s === 'string').join('\n') : str(item.text);
    return text.trim() ? [events.thinking(text)] : [];
  }
  if (QUIET_KINDS.indexOf(kind) !== -1) return [];
  const id = str(item.itemId);
  if (!id) return [];
  if (TOOL_KINDS.indexOf(kind) === -1) {
    // An unknown kind renders generically (MSP: by `fallbackText`) and is said once as drift.
    const text = str(item.fallbackText);
    return [events.shapeDrift(`item:${kind || 'unknown'}`, `Muse sent an item of kind "${kind}", which this Dopl does not recognise`)]
      .concat(text ? [events.thinking(text)] : []);
  }
  // `ok` is false only on an explicit failure: a false negative retracts a post the operator saw sent.
  const status = str(item.status);
  const ok = ['failed', 'rejected', 'cancelled', 'timedOut'].indexOf(status) === -1;
  const summary = str(item.visibleOutput) || str(item.failureReason) || (item.result && str(item.result.summary)) || str(item.text);
  return [events.toolResult({ type: 'tool_result', toolUseId: id, ok, resultSummary: io.summarizeResult(summary) })];
}

function turnCompletedEvents(params) {
  const p = params || {};
  const model = p.model || null;
  const e = p.error && typeof p.error === 'object' ? p.error : null;
  if (p.terminal === 'failed' && e) {
    // The auth sentinel returns alone: core holds the session, and render events beside it would paint the
    // very bubble the hold replaces.
    if (AUTH_KINDS.indexOf(e.kind) !== -1 || isAuthShaped(e.message)) return [events.authHold(str(e.message))];
  }
  const out = [];
  if (p.terminal === 'failed') {
    if (e && isMcpFailure(e)) out.push(events.assistant(mcpLine), events.mcpStatus('failed'));
    else out.push(events.assistant(turnFailureLine(str((e && e.message) || p.reason))));
  }
  // No context event without a measurement: the reducer writes `contextTokens` unconditionally.
  const used = posInt(p.contextUsed);
  if (used !== null) out.push(events.context(used, model, posInt(p.contextWindow)));
  const t = tokensFrom(p.cumulative);
  out.push(events.result(t.session, model));
  if (p.cumulative && t.session === null) out.push(events.shapeDrift('usage', 'a turn reported token usage in a shape this Dopl cannot read'));
  return out;
}

// Routine traffic Dopl reads elsewhere (`launch-spec.js`, `approval.js`) or drops by design.
const ROUTINE = new Set([
  'turn/started', 'item/delta', 'item/updated', 'session/tokenUsage', 'session/contextUsage', 'session/statusChanged',
  'session/started', 'session/closed', 'session/approvalModeChanged', 'session/modelChanged',
  'session/reasoningEffortChanged', 'session/permissionProfileChanged', 'session/todoListChanged',
  'session/viewHealthChanged', 'session/nameChanged', 'session/branchChanged', 'session/goalChanged',
  'session/listChanged', 'turn/foregroundCompleted', 'turn/retryScheduled', 'turn/unqueued', 'turn/retracted',
  'approval/requested', 'approval/updated', 'approval/resolved', 'usage/changed', 'skill/changed',
  'plugin/changed', 'account/changed', 'view/gap',
]);

/** ONE raw MSP frame → the CoreEvents it means. */
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
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};

  if (method === SESSION_STARTED) return [events.launched(params.sessionId || null, params.model || null)];
  if (method === UNKNOWN_REQUEST) {
    return [events.shapeDrift('server-request', `Muse asked for "${str(params.method)}", which this Dopl does not recognise`)];
  }
  if (method === 'item/started') return startedEvents(itemOf(params), context);
  if (method === 'item/completed') return completedEvents(itemOf(params), context);
  if (method === 'turn/completed') return turnCompletedEvents(params);
  if (ROUTINE.has(method)) return [];
  // Not handled: drift when THIS build's own schema never declared it; nothing said without a verdict.
  if (require('../sdk-shape').knows('muse', `notification ${method}`) === false) {
    return [events.shapeDrift(`notification:${method}`, `Muse sent "${method}", which its own protocol description does not list`)];
  }
  return [];
}

module.exports = {
  normalize, tokensFrom, isAuthShaped, isMcpFailure,
  SESSION_STARTED, UNKNOWN_REQUEST, ERROR_MESSAGE_TYPE, TOOL_KINDS, QUIET_KINDS,
};
