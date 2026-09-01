// THE NORMALIZER — one raw app-server message in, `CoreEvent[]` out. ⚠ THE LOAD-BEARING FUNCTION.
//
// ⚠ IT OWNS ALL THREE RAW-MESSAGE CONSUMERS, like every adapter's: the AUTH SENTINEL (which
// short-circuits the consume loop before anything else sees the message), the RENDER MAPPING, and
// the PER-TURN USAGE. If it owned only the middle one, the fixtures would cover a third of the
// surface while two platform-shaped parsers stayed in core.
//
// ⚠ PURE. No I/O, no dispatch, no session mutation, no clock. It READS a context and RETURNS
// events. That is what makes this adapter testable from RECORDED JSON-RPC with nothing installed —
// which is the only honest answer to "no live installs", and it is why every payload shape below
// is read TOLERANTLY: `codex-research.md` §5 lists the exact approval and item payloads as
// unverified (§5 items C2, C12), so a correction is a fixture change and never a rewrite.
//
// ⚠ AND IT RENDERS ON `item/completed`, NEVER ON A DELTA. `item/agentMessage/delta` and
// `item/commandExecution/outputDelta` stream partial content, and the Claude adapter pins
// `includePartialMessages: false` for a reason that ports exactly: THE OUTBOUND CARD SHOWS THE
// OPERATOR THE BYTES A POST WILL SEND, so a streamed tool input must never be what the card is
// painted from. Acting on deltas would also double-render every message. They are dropped, and
// that is a deliberate trade of live token-by-token output for a card that cannot lie.

const events = require('../events');
const io = require('../../session-io');

// ── THE SYNTHETIC FRAMES ─────────────────────────────────────────────────────────────────────
//
// ⚠ NAMESPACED `dopl/` SO NOBODY MISTAKES THEM FOR PROTOCOL. The app-server documents no
// `thread/started` notification — a thread id arrives as the RESULT of `thread/start` — and core's
// consume loop only ever sees an iterable of messages. So `launch-spec.js` mints these two frames
// itself: one carrying the conversation handle every resume depends on, one carrying a rejection.
const THREAD_STARTED = 'dopl/threadStarted';
const ERROR_MESSAGE_TYPE = 'error';

// ── AUTH SENTINELS ───────────────────────────────────────────────────────────────────────────
//
// ⚠ A PATTERN, NOT A SENTENCE, AND DECLARED UNVERIFIED. This runtime's real credential probe is
// `codex login status` (exit 0 if logged in — `codex-research.md` §3), which `credential.js` owns.
// What text a SIGNED-OUT app-server puts in the stream is not documented anywhere in the research,
// so this matches the generic shapes an auth failure takes rather than a sentence somebody
// imagined the binary saying (§5 item C20). ⚠ OVER-MATCHING IS THE SAFE DIRECTION HERE: a false
// positive parks the session and offers the credential path, which is recoverable; a false
// negative renders a dead-end bubble the operator cannot act on, which is the failure Q6 fixed.
const AUTH_SHAPED_RE = /\b(401|403)\b|unauthor(?:ised|ized)|not\s+logged\s+in|log\s*in\s+required|login\s+required|authentication\s+(?:failed|required)|invalid\s+(?:api\s+)?(?:key|token)|expired\s+(?:credential|token)/i;

const isAuthShaped = (text) => AUTH_SHAPED_RE.test(String(text == null ? '' : text));

// ── TOLERANT READERS ─────────────────────────────────────────────────────────────────────────
//
// Every one of these exists because the payload shape is §5-unverified. They read the spellings
// the research's own method and field names imply, and answer a harmless default otherwise.

function itemOf(params) {
  const p = params && typeof params === 'object' ? params : {};
  if (p.item && typeof p.item === 'object') return p.item;
  return p;
}

const itemType = (item) => String((item && (item.type || item.item_type || item.itemType)) || '');
const itemId = (item) => {
  const id = item && (item.id || item.item_id || item.itemId);
  return id == null ? '' : String(id);
};

/** The human text on an item, under any of the spellings an item might carry it. */
function textOf(item) {
  const i = item && typeof item === 'object' ? item : {};
  for (const key of ['text', 'message', 'content', 'delta']) {
    const v = i[key];
    if (typeof v === 'string' && v) return v;
    if (Array.isArray(v)) {
      const joined = v.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
      if (joined) return joined;
    }
  }
  return '';
}

/** The arguments an item carries, if any — the thing a card is painted from. */
function argsOf(item) {
  const i = item && typeof item === 'object' ? item : {};
  for (const key of ['arguments', 'args', 'input', 'params', 'command', 'changes']) {
    if (i[key] && typeof i[key] === 'object') return i[key];
  }
  return {};
}

/** The MCP tool name an item names, or '' — an item that is not a tool call names nothing. */
function toolNameOf(item) {
  const i = item && typeof item === 'object' ? item : {};
  for (const key of ['tool', 'toolName', 'tool_name', 'name']) {
    if (typeof i[key] === 'string' && i[key]) return i[key];
  }
  return '';
}

// ⚠ TOKENS ONLY, AND NEVER A COST. `codex-research.md` §3 says `usage` on `turn/completed` is
// tokens; `total_cost_usd` is a CLAUDE field and nothing in the research says Codex reports a USD
// figure at all (§5 item C11). So `result` is built with an explicit `null` cost, which HIDES the
// cost cap (`descriptor.meter.cost`) rather than rendering a budget fed by a zero that never trips.
// ⚠ THE FIELD NAMES ARE UNMEASURED (§5 item C12) — hence the spelling sweep, and hence
// `descriptor.meter.fields` being `null` rather than a list somebody guessed.
const TOTAL_KEYS = ['total_tokens', 'totalTokens', 'total'];
const IN_KEYS = ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens'];
const CACHED_KEYS = ['cached_input_tokens', 'cachedInputTokens', 'cache_read_input_tokens'];
const OUT_KEYS = ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens'];

function usageOf(params) {
  const p = params && typeof params === 'object' ? params : {};
  if (p.usage && typeof p.usage === 'object') return p.usage;
  if (p.turn && p.turn.usage && typeof p.turn.usage === 'object') return p.turn.usage;
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
  const cached = pick(usage, CACHED_KEYS);
  const output = pick(usage, OUT_KEYS);
  const total = pick(usage, TOTAL_KEYS);
  return { prompt: input + cached, session: total || (input + cached + output) };
}

// ── THE RENDER MAPPING ───────────────────────────────────────────────────────────────────────
//
// ⚠ A COMPLETED ITEM WE CANNOT CLASSIFY STILL RENDERS A PLAIN TOOL CARD. Rendering nothing for an
// item shape a later CLI adds would make a session look like it did nothing between two turns,
// which is a worse failure than a card whose summary is thin. Only an item with no id at all is
// dropped, because a card that can never be filled by its own result is noise.
const MESSAGE_TYPES = ['agentMessage', 'agent_message', 'assistantMessage', 'message'];
const THINKING_TYPES = ['reasoning', 'thinking', 'agentReasoning', 'agent_reasoning'];

function startedEvents(item, ctx) {
  const id = itemId(item);
  if (!id) return [];
  const type = itemType(item);
  if (MESSAGE_TYPES.indexOf(type) !== -1 || THINKING_TYPES.indexOf(type) !== -1) return [];
  const name = toolNameOf(item) || type || 'unknown';
  const input = argsOf(item);
  if (io.isOutboundPost(name, input, ctx.channelId)) {
    // The agent wants to SEND a message to the peer. ONE `outbound_post`, and the generic tool
    // card for the same item is SUPPRESSED so a sent message never double-renders.
    const payload = io.withPostSurface({
      type: 'outbound_post',
      toolUseId: id,
      text: input && input.body != null ? String(input.body) : '',
    }, input, ctx.peerName, ctx.peerId);
    // The SAME item becomes the inline Send / Deny card while it waits, then resolves in place.
    if (typeof ctx.willGatePost === 'function' && ctx.willGatePost(input, name) === true) {
      payload.pending = true;
      payload.ownChannel = true;
    }
    return [events.outboundPost(payload)];
  }
  return [events.toolUse({
    type: 'tool_use',
    toolUseId: id,
    name: name,
    inputSummary: io.summarizeInput(input),
    inputFull: io.safeInput(input),
  })];
}

function completedEvents(item, ctx) {
  const type = itemType(item);
  if (MESSAGE_TYPES.indexOf(type) !== -1) {
    const text = textOf(item);
    return text ? [events.assistant(text)] : [];
  }
  if (THINKING_TYPES.indexOf(type) !== -1) {
    const text = textOf(item);
    return text ? [events.thinking(text)] : []; // work lane, bounded downstream
  }
  const id = itemId(item);
  if (!id) return [];
  // ⚠ `ok` IS FALSE ONLY ON AN EXPLICIT FAILURE. An item that reports no status at all reads as
  // SUCCESS, because a false negative here retracts an `outbound_post` the operator already saw
  // sent (the reducer un-counts a post on a failing result) — claiming a delivered message failed
  // is worse than missing a failure.
  const status = String((item && (item.status || item.outcome)) || '');
  const ok = !(item && item.error) && status !== 'failed' && status !== 'error';
  return [events.toolResult({
    type: 'tool_result',
    toolUseId: id,
    ok: ok,
    resultSummary: io.summarizeResult(textOf(item) || item.result || item.output),
  })];
}

/**
 * ONE raw app-server message -> the CoreEvents it means.
 *
 * ⚠ THE AUTH SENTINEL IS CHECKED FIRST AND RETURNS ALONE. It short-circuits the consume loop: core
 * stops reading, holds the session and swaps the dead-end bubble for the credential path. Emitting
 * render events beside it would paint the very bubble the hold exists to replace.
 */
function normalize(msg, ctx) {
  const context = ctx || {};
  if (!msg || typeof msg !== 'object') return [];

  // The synthetic rejection frame core mints in the consume loop's `catch`, and the one
  // `launch-spec.js` mints for a failed handshake. Both are platform-shaped text, so both come
  // through the normalizer rather than core deciding what "no credential" looks like.
  if (msg.type === ERROR_MESSAGE_TYPE) {
    const text = String(msg.text == null ? '' : msg.text);
    return isAuthShaped(text) ? [events.authHold(text)] : [];
  }

  const method = typeof msg.method === 'string' ? msg.method : '';
  if (!method) return [];
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};

  if (method === THREAD_STARTED) {
    // The conversation handle every resume depends on, plus the model the platform really picked
    // (the picker asked; the platform decides).
    return [events.launched(params.threadId || params.thread_id || null, params.model || null)];
  }

  if (method === 'item/started') return startedEvents(itemOf(params), context);
  if (method === 'item/completed') return completedEvents(itemOf(params), context);

  if (method === 'turn/completed') {
    const usage = usageOf(params);
    const t = tokensFrom(usage);
    const model = (params.model || (params.turn && params.turn.model)) || null;
    const out = [];
    // ⚠ PER-TURN, NOT PER-MESSAGE, AND THAT IS `descriptor.meter.mode`. This runtime reports usage
    // once a turn ends (`codex-research.md` §3: "not a live running meter"), so the context event
    // rides the same frame as the result instead of the last assistant message's own usage.
    if (t.prompt > 0 || model) out.push(events.context(t.prompt, model));
    // ⚠ CUMULATIVE BY CONTRACT, DELTA'D IN CORE — and the cost is an explicit `null`, not a 0.
    // ⚠ THE TOTAL MAY NOT BE CUMULATIVE ON THIS RUNTIME AT ALL (§5 item C12/C8): if `usage` is
    // PER-TURN rather than running, core's `Math.max(0, total - last)` under-counts. That is the
    // same class as the resume-reset question and is why `usageResetsOnResume` is `'unverified'`
    // and resume is refused until both are measured together.
    out.push(events.result(null, t.session, model));
    return out;
  }

  // ⚠ `turn/started`, both `*/delta` streams and every unknown method IGNORED — see the header for
  // why the deltas in particular are dropped rather than rendered.
  return [];
}

module.exports = {
  normalize,
  startedEvents, completedEvents, tokensFrom, usageOf, isAuthShaped,
  THREAD_STARTED, ERROR_MESSAGE_TYPE,
};
