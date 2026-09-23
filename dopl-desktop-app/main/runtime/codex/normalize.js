// One raw app-server message in, `CoreEvent[]` out. Pure (no I/O, dispatch, mutation or clock); owns
// all three raw-message consumers: the auth sentinel, the render mapping and the per-turn usage.
// Renders on `item/completed`, never deltas: the outbound card must show the exact bytes a post sends.

const events = require('../events');
const io = require('../../session-io');

// ── SYNTHETIC FRAMES ─────────────────────────────────────────────────────────────────────────
// `launch-spec.js` mints THREAD_STARTED (Dopl's own, `dopl/`-namespaced: handle + model into core) and
// the turn-failure error frame; core mints the rejection one.
const THREAD_STARTED = 'dopl/threadStarted';
const ERROR_MESSAGE_TYPE = events.ERROR_FRAME;

// ── AUTH ─────────────────────────────────────────────────────────────────────────────────────
// A pattern, not a sentence. Over-matching is the safe direction: a false positive parks the session
// and offers sign-in; a false negative renders a dead-end bubble.
const AUTH_SHAPED_RE = /\b(401|403)\b|unauthor(?:ised|ized)|not\s+logged\s+in|log\s*in\s+required|login\s+required|authentication\s+(?:failed|required)|invalid\s+(?:api\s+)?(?:key|token)|expired\s+(?:credential|token)/i;

const isAuthShaped = (text) => AUTH_SHAPED_RE.test(String(text == null ? '' : text));

// The server's own turn-error class (`codexErrorInfo`): `unauthorized`, or an HTTP variant with 401/403.
function unauthorizedInfo(info) {
  if (info === 'unauthorized') return true;
  if (!info || typeof info !== 'object') return false;
  return Object.keys(info).some((k) => {
    const code = info[k] && info[k].httpStatusCode;
    return code === 401 || code === 403;
  });
}

const turnFailureLine = (text) => `Codex could not finish this turn${text ? `: ${text}` : '.'}`;

function itemOf(params) {
  const p = params && typeof params === 'object' ? params : {};
  if (p.item && typeof p.item === 'object') return p.item;
  return p;
}

const itemType = (item) => String((item && item.type) || '');
const itemId = (item) => (item && item.id != null ? String(item.id) : '');

/** The human text on an item: `text`, or a `content` / `summary` list. */
function textOf(item, keys) {
  const i = item && typeof item === 'object' ? item : {};
  for (const key of keys || ['text', 'content']) {
    const v = i[key];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v)) {
      // v2 reasoning `summary`/`content` are string arrays; message content blocks carry `.text`.
      const joined = v.every((b) => typeof b === 'string')
        ? v.join('\n')
        : v.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
      if (joined.trim()) return joined;
    }
  }
  return '';
}

function argsOf(item) {
  const i = item && typeof item === 'object' ? item : {};
  // A `commandExecution` carries its command line as a STRING (CX-13).
  if (typeof i.command === 'string' && i.command) return { command: i.command };
  for (const key of ['arguments', 'changes']) {
    if (i[key] && typeof i[key] === 'object') return i[key];
  }
  return {};
}

function toolNameOf(item) {
  const i = item && typeof item === 'object' ? item : {};
  for (const key of ['tool', 'name']) {
    if (typeof i[key] === 'string' && i[key]) return i[key];
  }
  return '';
}

function usageOf(params) {
  const p = params && typeof params === 'object' ? params : {};
  return p.usage && typeof p.usage === 'object' ? p.usage : null;
}

function promptUsageOf(params) {
  const p = params && typeof params === 'object' ? params : {};
  if (p.promptUsage && typeof p.promptUsage === 'object') return p.promptUsage;
  return usageOf(p);
}

// `params.contextWindow` is launch-spec's copy of `tokenUsage.modelContextWindow`; the server's number
// beats any Dopl table (`session-model.js › contextEvent`).
function windowFrom(params) {
  const v = params && params.contextWindow;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null; // null, never a 0 window
}

function count(usage, key) {
  const v = usage[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

// `{ prompt, session }` — window occupancy and the turn's token total; 0 says nothing.
// `cachedInputTokens` is a subset of `inputTokens` (measured: total = input + output), so never added.
function tokensFrom(usage) {
  if (!usage || typeof usage !== 'object') return { prompt: 0, session: 0 };
  const input = count(usage, 'inputTokens');
  const output = count(usage, 'outputTokens');
  const total = count(usage, 'totalTokens');
  return { prompt: input, session: total || (input + output) };
}

// ── RENDER ───────────────────────────────────────────────────────────────────────────────────
// An unclassified completed item still renders a plain tool card (a later CLI's new item must not
// vanish); only an item with no id is dropped, since no result could ever fill its card.
const MESSAGE_TYPES = ['agentMessage'];
const THINKING_TYPES = ['reasoning'];

function startedEvents(item, ctx) {
  const id = itemId(item);
  if (!id) return [];
  const type = itemType(item);
  if (MESSAGE_TYPES.indexOf(type) !== -1 || THINKING_TYPES.indexOf(type) !== -1) return [];
  return events.toolCallEvents({ id, name: toolNameOf(item) || type || 'unknown', input: argsOf(item) }, ctx);
}

function completedEvents(item, ctx) {
  const type = itemType(item);
  if (MESSAGE_TYPES.indexOf(type) !== -1) {
    const text = textOf(item);
    return text ? [events.assistant(text)] : [];
  }
  if (THINKING_TYPES.indexOf(type) !== -1) {
    const text = textOf(item, ['summary', 'text', 'content']);
    return text ? [events.thinking(text)] : []; // work lane, bounded downstream
  }
  const id = itemId(item);
  if (!id) return [];
  // `ok` is false only on an explicit failure: a false negative retracts an `outbound_post` the
  // operator already saw sent. A `declined` command/patch did not run.
  const status = String((item && item.status) || '');
  const ok = !(item && item.error) && status !== 'failed' && status !== 'error' && status !== 'declined';
  const errorText = item && item.error && typeof item.error.message === 'string' ? item.error.message : '';
  return [events.toolResult({
    type: 'tool_result',
    toolUseId: id,
    ok: ok,
    resultSummary: io.summarizeResult(textOf(item) || item.aggregatedOutput || item.result || item.output || errorText),
  })];
}

// ONE raw app-server message -> the CoreEvents it means. The auth sentinel returns alone: core holds
// the session, and render events beside it would paint the very bubble the hold replaces.
function normalize(msg, ctx) {
  const context = ctx || {};
  if (!msg || typeof msg !== 'object') return [];

  // Core's rejection frame and launch-spec's failed-turn frame: platform text, so classified here.
  if (msg.type === ERROR_MESSAGE_TYPE) {
    const text = String(msg.text == null ? '' : msg.text);
    if (isAuthShaped(text) || unauthorizedInfo(msg.codexErrorInfo)) return [events.authHold(text)];
    // A failed TURN (not a rejected stream, which core's crash path reports) is shown in the lane.
    return msg.turnFailed === true ? [events.assistant(turnFailureLine(text))] : [];
  }

  const method = typeof msg.method === 'string' ? msg.method : '';
  if (!method) return [];
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};

  if (method === THREAD_STARTED) {
    return [events.launched(params.threadId || null, params.model || null)];
  }

  if (method === 'item/started') return startedEvents(itemOf(params), context);
  if (method === 'item/completed') return completedEvents(itemOf(params), context);

  if (method === 'turn/completed') {
    const usage = usageOf(params);
    const t = tokensFrom(usage);
    const prompt = tokensFrom(promptUsageOf(params));
    const model = params.model || null;
    const out = [];
    // No context event without a measurement (an interrupted turn gets none): the reducer writes
    // `contextTokens` unconditionally, so a zero would empty a live gauge. `result` carries the model.
    if (prompt.prompt > 0) out.push(events.context(prompt.prompt, model, windowFrom(params)));
    // `total` is cumulative per thread (`last` is the turn), delta'd in core; no usage is no
    // measurement (`null`), which core skips rather than reading as zero (CX-02 / P4-04).
    out.push(events.result(usage ? t.session : null, model));
    return out;
  }

  return [];
}

module.exports = {
  normalize,
  tokensFrom, usageOf, isAuthShaped,
  THREAD_STARTED, ERROR_MESSAGE_TYPE,
};
