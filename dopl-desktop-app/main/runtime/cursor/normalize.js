// THE NORMALIZER — one raw Cursor stream event in, `CoreEvent[]` out: the auth sentinel, the render
// mapping and the per-turn usage. Pure. Readers are tolerant because the research documents
// `tool_call.args` / `.result` as internal-facing and the SDK as public beta.

const events = require('../events');
const io = require('../../session-io');

// Synthetic frames (namespaced `dopl/`, never protocol) that `launch-spec.js` mints for facts outside
// the stream: the agent handle (`Agent.create()`'s result) and each turn's usage (`run.usage`).
const AGENT_CREATED = 'dopl/agentCreated';
const TURN_COMPLETED = 'dopl/turnCompleted';
const ERROR_MESSAGE_TYPE = events.ERROR_FRAME;

// A pattern, unverified: the signed-out error text is undocumented. Over-matching is the safe
// direction (a false positive parks the session recoverably; a false negative is a dead end).
const AUTH_SHAPED_RE = /\b(401|403)\b|unauthor(?:ised|ized)|not\s+logged\s+in|log\s*in\s+required|login\s+required|authentication\s+(?:failed|required)|invalid\s+(?:api\s+)?(?:key|token)|expired\s+(?:credential|token)|CURSOR_API_KEY/i;

const isAuthShaped = (text) => AUTH_SHAPED_RE.test(String(text == null ? '' : text));


/** The human text on an event, under any of the spellings one might carry it. */
function textOf(ev) {
  const e = ev && typeof ev === 'object' ? ev : {};
  for (const key of ['text', 'message', 'content', 'delta', 'thinking']) {
    const v = e[key];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v)) {
      const joined = v.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
      if (joined) return joined;
    }
    if (v && typeof v === 'object' && typeof v.text === 'string' && v.text) return v.text;
  }
  return '';
}

/** The call id a `tool_call` is keyed on; the card and its fill join on this alone. */
function callIdOf(ev) {
  const e = ev && typeof ev === 'object' ? ev : {};
  for (const key of ['call_id', 'callId', 'toolCallId', 'id']) {
    if (typeof e[key] === 'string' && e[key]) return e[key];
  }
  return '';
}

/** The arguments a call carries — the thing a card is painted from. */
function argsOf(ev) {
  const e = ev && typeof ev === 'object' ? ev : {};
  for (const key of ['args', 'arguments', 'input', 'params']) {
    if (e[key] && typeof e[key] === 'object') return e[key];
  }
  return {};
}

const nameOf = (ev) => {
  const e = ev && typeof ev === 'object' ? ev : {};
  for (const key of ['name', 'tool', 'toolName', 'tool_name']) {
    if (typeof e[key] === 'string' && e[key]) return e[key];
  }
  return '';
};

// `TokenUsage` field names are documented; the snake_case twins are belt for a beta SDK.
const IN_KEYS = ['inputTokens', 'input_tokens'];
const CACHE_KEYS = ['cacheReadTokens', 'cache_read_tokens'];
const OUT_KEYS = ['outputTokens', 'output_tokens'];
const TOTAL_KEYS = ['totalTokens', 'total_tokens'];

function usageOf(ev) {
  const e = ev && typeof ev === 'object' ? ev : {};
  if (e.usage && typeof e.usage === 'object') return e.usage;
  // A bare `usage` stream event may BE the usage object.
  for (const k of IN_KEYS.concat(TOTAL_KEYS)) if (typeof e[k] === 'number') return e;
  return null;
}

function pick(usage, keys) {
  for (const k of keys) {
    const v = usage[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}

/** `{ prompt, session }` — the window occupancy, and the turn's whole token total. 0 says nothing. */
function tokensFrom(usage) {
  if (!usage || typeof usage !== 'object') return { prompt: 0, session: 0 };
  const input = pick(usage, IN_KEYS);
  const cached = pick(usage, CACHE_KEYS);
  const output = pick(usage, OUT_KEYS);
  const total = pick(usage, TOTAL_KEYS);
  return { prompt: input + cached, session: total || (input + cached + output) };
}


// A call that cannot be classified still renders a plain tool card; only a call with no id is dropped.
const RUNNING = ['running', 'started', 'in_progress', 'pending'];
const FAILED = ['error', 'failed', 'cancelled', 'canceled'];

function toolCallEvents(ev, ctx) {
  const id = callIdOf(ev);
  if (!id) return [];
  const status = String(ev.status || ev.state || '');
  const name = nameOf(ev) || 'unknown';
  const input = argsOf(ev);
  if (RUNNING.indexOf(status) !== -1 || !status) return events.toolCallEvents({ id, name, input }, ctx);
  // `ok: false` only on an explicit failure: a false negative retracts a post the operator saw sent.
  const ok = FAILED.indexOf(status) === -1 && !ev.error;
  return [events.toolResult({
    type: 'tool_result',
    toolUseId: id,
    ok: ok,
    resultSummary: io.summarizeResult(ev.result != null ? ev.result : textOf(ev)),
  })];
}

/** One raw stream event → the CoreEvents it means. The auth sentinel is checked first and returns alone. */
function normalize(msg, ctx) {
  const context = ctx || {};
  if (!msg || typeof msg !== 'object') return [];
  const type = typeof msg.type === 'string' ? msg.type : '';

  if (type === ERROR_MESSAGE_TYPE) {
    const text = String(msg.text == null ? '' : msg.text);
    return isAuthShaped(text) ? [events.authHold(text)] : [];
  }

  if (type === AGENT_CREATED) {
    // The agent handle every resume depends on, and the model really running.
    return [events.launched(msg.agentId || msg.id || null, msg.model || null)];
  }

  if (type === TURN_COMPLETED) {
    const t = tokensFrom(usageOf(msg));
    const model = msg.model || null;
    const out = [];
    // Per turn: the context reading rides the turn's end.
    if (t.prompt > 0 || model) out.push(events.context(t.prompt, model));
    // Cumulative; core takes the delta. Unmeasured across a resume, so resume is refused.
    out.push(events.result(t.session, model));
    return out;
  }

  if (type === 'assistant') {
    const text = textOf(msg);
    return text ? [events.assistant(text)] : [];
  }
  if (type === 'thinking') {
    const text = textOf(msg);
    return text ? [events.thinking(text)] : []; // work lane, bounded downstream
  }
  if (type === 'tool_call') return toolCallEvents(msg, context);

  if (type === 'usage') {
    const t = tokensFrom(usageOf(msg));
    return t.prompt > 0 ? [events.context(t.prompt, msg.model || null)] : [];
  }

  // Everything else is ignored — `request` included: it awaits an approval with no responder API, so
  // the windowless floor (`auto-review`) is what keeps an unattended turn from stalling on it.
  return [];
}

module.exports = {
  normalize, toolCallEvents, tokensFrom, usageOf, isAuthShaped, callIdOf, textOf,
  AGENT_CREATED, TURN_COMPLETED, ERROR_MESSAGE_TYPE,
};
