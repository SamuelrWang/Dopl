// THE NORMALIZER — one raw stream event in, `CoreEvent[]` out. ⚠ THE LOAD-BEARING FUNCTION.
//
// ⚠ IT OWNS ALL THREE RAW-MESSAGE CONSUMERS, like every adapter's: the AUTH SENTINEL (which
// short-circuits the consume loop before anything else sees the message), the RENDER MAPPING, and
// the PER-TURN USAGE. If it owned only the middle one, the fixtures would cover a third of the
// surface while two platform-shaped parsers stayed in core.
//
// ⚠ PURE. No I/O, no dispatch, no session mutation, no clock. It READS a context and RETURNS
// events. That is what makes this adapter testable from RECORDED events with nothing installed —
// the only honest answer to "no live installs".
//
// ⚠ AND EVERY READER IS TOLERANT BECAUSE THE RESEARCH SAYS TO BE. `cursor-research.md` documents
// `tool_call.args` / `.result` as "internal-facing and may change" and the SDK as public beta, so
// a Dopl tool card built on their shape needs a tolerant mapper and a plain fallback rendering.
// That is a documented instruction, not a defensive habit: §5 item X3 is the volatility check, and
// a correction from it is a fixture edit rather than a rewrite.

const events = require('../events');
const io = require('../../session-io');

// ── THE SYNTHETIC FRAMES ─────────────────────────────────────────────────────────────────────
//
// ⚠ NAMESPACED `dopl/` SO NOBODY MISTAKES THEM FOR PROTOCOL. Two facts this platform reports
// OUTSIDE the stream have to reach a pure normalizer somehow, and `launch-spec.js` mints a frame
// for each rather than core learning to read them:
//   `dopl/agentCreated`  the agent handle `Agent.resume()` needs, which arrives as the RESULT of
//                        `Agent.create()`. There is no `created` notification to read.
//   `dopl/turnCompleted` the turn's usage AND ITS COST. ⚠ The cost is the reason this frame
//                        exists at all: `agent.getUsage()` is a CALL (`{rawCostCents,
//                        chargedCents}`), not a stream event, so a normalizer that only read the
//                        stream would report `costUsd: null` on a platform that DOES emit a cost
//                        — and `descriptor.meter.cost` would then be declaring a cap that never
//                        fires. That is §1.4a's silent failure, arriving from the other direction.
const AGENT_CREATED = 'dopl/agentCreated';
const TURN_COMPLETED = 'dopl/turnCompleted';
const ERROR_MESSAGE_TYPE = 'error';

// ── AUTH SENTINELS ───────────────────────────────────────────────────────────────────────────
//
// ⚠ A PATTERN, NOT A SENTENCE, AND DECLARED UNVERIFIED. This runtime's real credential probe is
// `cursor-agent status` (`credential.js`). What text a signed-out SDK puts in a rejection is not
// documented anywhere in the research, so this matches the generic shapes an auth failure takes
// rather than a sentence somebody imagined the library throwing (§5 item X18). ⚠ OVER-MATCHING IS
// THE SAFE DIRECTION: a false positive parks the session and offers the credential path, which is
// recoverable; a false negative renders a dead-end bubble the operator cannot act on.
const AUTH_SHAPED_RE = /\b(401|403)\b|unauthor(?:ised|ized)|not\s+logged\s+in|log\s*in\s+required|login\s+required|authentication\s+(?:failed|required)|invalid\s+(?:api\s+)?(?:key|token)|expired\s+(?:credential|token)|CURSOR_API_KEY/i;

const isAuthShaped = (text) => AUTH_SHAPED_RE.test(String(text == null ? '' : text));

// ── TOLERANT READERS ─────────────────────────────────────────────────────────────────────────

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

/** The call id a `tool_call` is keyed on. ⚠ The card and its fill join on THIS and nothing else. */
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

// ⚠ THE FIELD NAMES ARE DOCUMENTED HERE, UNLIKE ON THE OTHER RUNTIMES — `cursor-research.md` names
// `TokenUsage` as `inputTokens` / `outputTokens` / `cacheReadTokens` / `cacheWriteTokens` /
// `totalTokens` / `reasoningTokens`, which is why `descriptor.meter.fields` is a LIST here and
// `null` there. The snake_case spellings are belt for a beta SDK, not a guess dressed as a
// measurement.
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

/**
 * USD from `agent.getUsage()`'s cents, or `null`.
 *
 * ⚠ `chargedCents`, NOT `rawCostCents`, AND THE COST CAP IS THE REASON. `main/session-state.js ›
 * costCapReached` is a BUDGET control — it answers "how much has this operator spent" — and
 * `chargedCents` is what they are billed. `rawCostCents` is the pre-plan figure and would trip a
 * cap over money nobody paid. Raw is the fallback only because a build that reports one and not
 * the other should still meter something rather than nothing.
 * ⚠ `null`, NEVER `0`. A zero is a budget that never trips (§1.4a).
 */
function costFrom(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  for (const key of ['chargedCents', 'charged_cents', 'rawCostCents', 'raw_cost_cents']) {
    const v = u[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v / 100;
  }
  return null;
}

// ── THE RENDER MAPPING ───────────────────────────────────────────────────────────────────────
//
// ⚠ A CALL WE CANNOT CLASSIFY STILL RENDERS A PLAIN TOOL CARD. Rendering nothing for a shape a
// later SDK version adds would make a session look like it did nothing between two turns, which is
// a worse failure than a card whose summary is thin — and the research warns that these payloads
// move. Only a call with no id at all is dropped, because a card that can never be filled by its
// own result is noise.
const RUNNING = ['running', 'started', 'in_progress', 'pending'];
const FAILED = ['error', 'failed', 'cancelled', 'canceled'];

function toolCallEvents(ev, ctx) {
  const id = callIdOf(ev);
  if (!id) return [];
  const status = String(ev.status || ev.state || '');
  const name = nameOf(ev) || 'unknown';
  const input = argsOf(ev);
  if (RUNNING.indexOf(status) !== -1 || !status) {
    if (io.isOutboundPost(name, input, ctx.channelId)) {
      // The agent wants to SEND a message to the peer. ONE `outbound_post`, and the generic tool
      // card for the same call is SUPPRESSED so a sent message never double-renders.
      const payload = io.withPostSurface({
        type: 'outbound_post',
        toolUseId: id,
        text: input && input.body != null ? String(input.body) : '',
      }, input, ctx.peerName, ctx.peerId);
      // v2.7 L3: the SAME item becomes the inline Send / Deny card while it waits, then resolves
      // in place. ⚠ WHETHER IT REALLY RESOLVES IN PLACE ON THIS RUNTIME IS §5 ITEM X16: the gate's
      // card is keyed on the id `axis-b.js › execute` was handed, and nothing in the research says
      // an `execute()` implementation is handed the stream's `call_id`. If it is not, this card is
      // painted and answered on a SEPARATE card rather than in place. The DECISION is unaffected —
      // every call still stops at `grantDecision` — but the rendering is, so it is declared.
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
  // ⚠ `ok` IS FALSE ONLY ON AN EXPLICIT FAILURE. A call that reports an unrecognised status reads
  // as SUCCESS, because a false negative retracts an `outbound_post` the operator already saw sent
  // (the reducer un-counts a post on a failing result) — claiming a delivered message failed is
  // worse than missing a failure.
  const ok = FAILED.indexOf(status) === -1 && !ev.error;
  return [events.toolResult({
    type: 'tool_result',
    toolUseId: id,
    ok: ok,
    resultSummary: io.summarizeResult(ev.result != null ? ev.result : textOf(ev)),
  })];
}

/**
 * ONE raw stream event -> the CoreEvents it means.
 *
 * ⚠ THE AUTH SENTINEL IS CHECKED FIRST AND RETURNS ALONE. It short-circuits the consume loop: core
 * stops reading, holds the session and swaps the dead-end bubble for the credential path. Emitting
 * render events beside it would paint the very bubble the hold exists to replace.
 */
function normalize(msg, ctx) {
  const context = ctx || {};
  if (!msg || typeof msg !== 'object') return [];
  const type = typeof msg.type === 'string' ? msg.type : '';

  if (type === ERROR_MESSAGE_TYPE) {
    const text = String(msg.text == null ? '' : msg.text);
    return isAuthShaped(text) ? [events.authHold(text)] : [];
  }

  if (type === AGENT_CREATED) {
    // The agent handle every resume depends on, plus the model the platform really picked (the
    // picker asked; the platform decides). ⚠ `models.reStampOnResume` is `true` on this runtime —
    // `agent.model` is `undefined` after a resume unless respecified — so this is also the value
    // `launch-spec.js` re-stamps from.
    return [events.launched(msg.agentId || msg.id || null, msg.model || null)];
  }

  if (type === TURN_COMPLETED) {
    const t = tokensFrom(usageOf(msg));
    const model = msg.model || null;
    const out = [];
    // ⚠ PER-TURN, NOT PER-MESSAGE, AND THAT IS `descriptor.meter.mode`. `run.usage` is live and
    // `result.usage` cumulative; the honest context reading rides the turn's end.
    if (t.prompt > 0 || model) out.push(events.context(t.prompt, model));
    // ⚠ CUMULATIVE BY CONTRACT, DELTA'D IN CORE. Whether a RESUMED agent restarts these totals is
    // §5 item X4, which is why `usageResetsOnResume` is `'unverified'` and a resume is refused.
    out.push(events.result(costFrom(msg.cost), t.session, model));
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

  // ⚠ `system`, `status`, `task`, `user` AND `request` ALL IGNORED, and `request` is the one that
  // is not merely uninteresting. It is documented as "awaiting approval" with a `request_id` AND
  // NO RESPONDER API (§5 item X1), so there is nothing this adapter could emit that an operator
  // could answer — a card with no way to resolve it is worse than none. ⚠ ITS REAL STAKE IS
  // LIVENESS, NOT A MISSING CONTROL: a run mode that ASKS (`allowlist`) has nobody to ask, so the
  // turn stalls. `toolMode.windowlessFloor` raising every unattended session to `auto-review` is
  // what stands between this runtime and that stall, which makes the floor load-bearing for
  // liveness here and not only for reach. `launch-spec.js` logs each one so a stall is diagnosable.
  return [];
}

module.exports = {
  normalize, toolCallEvents, tokensFrom, costFrom, usageOf, isAuthShaped, callIdOf, textOf,
  AGENT_CREATED, TURN_COMPLETED, ERROR_MESSAGE_TYPE,
};
