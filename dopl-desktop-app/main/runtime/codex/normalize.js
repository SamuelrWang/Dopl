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

// The server's own classification on a turn error (`TurnError.codexErrorInfo`): the string
// `unauthorized`, or an HTTP-failure variant carrying `httpStatusCode` 401/403.
function unauthorizedInfo(info) {
  if (info === 'unauthorized') return true;
  if (!info || typeof info !== 'object') return false;
  return Object.keys(info).some((k) => {
    const code = info[k] && info[k].httpStatusCode;
    return code === 401 || code === 403;
  });
}

// The visible line a non-auth failed turn leaves in the agent's lane (CX-04).
const turnFailureLine = (text) => `Codex could not finish this turn${text ? `: ${text}` : '.'}`;

// ── TOLERANT READERS ─────────────────────────────────────────────────────────────────────────
//
// Every one of these exists because the payload shape is §5-unverified. They read the spellings
// the research's own method and field names imply, and answer a harmless default otherwise.

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

/** The arguments an item carries, if any — the thing a card is painted from. */
function argsOf(item) {
  const i = item && typeof item === 'object' ? item : {};
  // A `commandExecution` carries its command line as a STRING (CX-13).
  if (typeof i.command === 'string' && i.command) return { command: i.command };
  for (const key of ['arguments', 'changes']) {
    if (i[key] && typeof i[key] === 'object') return i[key];
  }
  return {};
}

/** The MCP tool name an item names, or '' — an item that is not a tool call names nothing. */
function toolNameOf(item) {
  const i = item && typeof item === 'object' ? item : {};
  for (const key of ['tool', 'name']) {
    if (typeof i[key] === 'string' && i[key]) return i[key];
  }
  return '';
}

// ⚠ TOKENS, AND THERE IS NO LONGER ANY OTHER KIND. `codex-research.md` §3 says `usage` on
// `turn/completed` is tokens, and this adapter used to pass an explicit `null` cost as
// `events.result`'s first argument to say so. The COST COLUMN IS DELETED TREE-WIDE (2026-09-22,
// Samuel: *"we dont need cost tracking"*), so there is no longer an absence to declare.
// ⚠ THE SPELLING SWEEP STAYS even though `descriptor.meter.fields` now names the four measured
// spellings: the list is what THIS build measured, not a promise about every later CLI, and a
// renamed field must still meter rather than read as zero.
function usageOf(params) {
  const p = params && typeof params === 'object' ? params : {};
  return p.usage && typeof p.usage === 'object' ? p.usage : null;
}

function promptUsageOf(params) {
  const p = params && typeof params === 'object' ? params : {};
  if (p.promptUsage && typeof p.promptUsage === 'object') return p.promptUsage;
  return usageOf(p);
}

// ── ⚠ THE DENOMINATOR, REPORTED BY THE SERVER (2026-09-22) ───────────────────────────────────
//
// 🔒 **MEASURED against `codex-cli 0.155.1`: every `thread/tokenUsage/updated` carries
// `tokenUsage.modelContextWindow` (observed `258400`), a SIBLING of `last` and `total` rather than
// a field inside either breakdown** (`codex-live-session.test.mjs` asserts it on the live wire;
// `codex-launch-protocol.test.mjs`'s fixture shows the nesting).
//
// ⚠ **THE SERVER'S NUMBER IS PREFERRED OVER ANY TABLE DOPL KEEPS, AND THAT IS THE WHOLE POINT.**
// `session-model.js › CONTEXT_WINDOWS` is a transcription of ONE binary's model registry, frozen
// at build time; it goes stale the week a vendor ships a model, and adding `gpt-…` rows to it
// would commit Dopl to re-earning that table forever for a number the platform already states per
// turn. The precedence rule and its argument live in `session-model.js › contextEvent`; this
// function's only job is to carry the reported value across the seam.
//
// ⚠ TOLERANT ACROSS CARRIERS, FOR THE SAME REASON EVERY OTHER READER HERE IS. `launch-spec.js`
// is what folds the out-of-band `thread/tokenUsage/updated` snapshot onto the `turn/completed`
// frame core consumes, so the field can arrive as a `dopl/`-shaped sibling on `params` or still
// nested on whichever usage block that layer forwards. A spelling this build has not seen reads as
// ABSENT — `null`, never `0`: a window of zero would paint an empty gauge over a live session.
function windowFrom(params) {
  const v = params && params.contextWindow;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null; // null, never a 0 window
}

function count(usage, key) {
  const v = usage[key];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * `{ prompt, session }` — the window occupancy, and the turn's whole token total. 0 says nothing.
 *
 * 🔒 ⚠ **`cachedInputTokens` IS A SUBSET OF `inputTokens` ON THIS RUNTIME — MEASURED 2026-09-22
 * AGAINST `codex-cli 0.155.1`, AND IT USED TO BE ADDED ON TOP.** Three live
 * `thread/tokenUsage/updated` breakdowns from one thread, each satisfying
 * `totalTokens === inputTokens + outputTokens` exactly:
 *
 *     last { totalTokens 18838, inputTokens 18833, cachedInputTokens  7040, outputTokens  5 }
 *     last { totalTokens 23591, inputTokens 23586, cachedInputTokens 18688, outputTokens  5 }
 *     last { totalTokens 28765, inputTokens 28760, cachedInputTokens 23424, outputTokens  5 }
 *
 * The cached figure is never added into the platform's own total, so adding it here reported a
 * prompt of 25,873 against a real 18,833 — a context meter that overstates occupancy by whatever
 * fraction of the prompt was cached, which on a long thread approaches double. The other runtime's
 * `cache_read_input_tokens` IS additive; this normalizer only ever sees Codex payloads, so the
 * two conventions do not have to be reconciled here — and the sum fallback drops the cached term
 * for the same reason.
 */
function tokensFrom(usage) {
  if (!usage || typeof usage !== 'object') return { prompt: 0, session: 0 };
  const input = count(usage, 'inputTokens');
  const output = count(usage, 'outputTokens');
  const total = count(usage, 'totalTokens');
  return { prompt: input, session: total || (input + output) };
}

// ── THE RENDER MAPPING ───────────────────────────────────────────────────────────────────────
//
// ⚠ A COMPLETED ITEM WE CANNOT CLASSIFY STILL RENDERS A PLAIN TOOL CARD. Rendering nothing for an
// item shape a later CLI adds would make a session look like it did nothing between two turns,
// which is a worse failure than a card whose summary is thin. Only an item with no id at all is
// dropped, because a card that can never be filled by its own result is noise.
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
  // ⚠ `ok` IS FALSE ONLY ON AN EXPLICIT FAILURE. An item that reports no status at all reads as
  // SUCCESS, because a false negative here retracts an `outbound_post` the operator already saw
  // sent (the reducer un-counts a post on a failing result) — claiming a delivered message failed
  // is worse than missing a failure. A `declined` command/patch did not run.
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
    if (isAuthShaped(text) || unauthorizedInfo(msg.codexErrorInfo)) return [events.authHold(text)];
    // A failed TURN (not a rejected stream, which core's crash path reports) is shown in the lane.
    return msg.turnFailed === true ? [events.assistant(turnFailureLine(text))] : [];
  }

  const method = typeof msg.method === 'string' ? msg.method : '';
  if (!method) return [];
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};

  if (method === THREAD_STARTED) {
    // The conversation handle every resume depends on, plus the model the platform really picked
    // (the picker asked; the platform decides).
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
    // ⚠ PER-TURN, NOT PER-MESSAGE, AND THAT IS `descriptor.meter.mode`. This runtime reports usage
    // once a turn ends (`codex-research.md` §3: "not a live running meter"), so the context event
    // rides the same frame as the result instead of the last assistant message's own usage.
    // 🔒 ⚠ **ONLY WHEN THERE IS A MEASUREMENT — `|| model` USED TO BE HERE AND IT WIPED THE METER
    // ON EVERY INTERRUPT** (MEASURED 2026-09-22: an interrupted turn ends on `turn/completed` with
    // `status: "interrupted"` and NO `thread/tokenUsage/updated` at all, so `prompt.prompt` is 0
    // while `model` is still the one `thread/start` selected). `session-reducer.js`'s `context`
    // branch writes `contextTokens` unconditionally, so that zero reset a live window gauge to
    // empty the moment an operator pressed Stop. The model is not lost: `result` below carries it
    // and the reducer reads it from there. This is the same rule as
    // `session-model.js › contextEvent`, which answers `null` for a zero on the other runtime.
    // ⚠ THE WINDOW RIDES THE SAME GUARD RATHER THAN A SECOND ONE. A turn that measured nothing
    // emits NO context event at all, window or no window: an event carrying a denominator and a
    // zero numerator would be exactly the interrupt regression above wearing a new field.
    if (prompt.prompt > 0) out.push(events.context(prompt.prompt, model, windowFrom(params)));
    // ⚠ CUMULATIVE BY CONTRACT, DELTA'D IN CORE — and the cost is an explicit `null`, not a 0.
    // 🔒 **MEASURED 2026-09-22 (`codex-cli 0.155.1`): `tokenUsage.total` IS RUNNING, PER THREAD,
    // AND `tokenUsage.last` IS THE TURN.** Three consecutive turns on one thread reported
    // total 18,838 → 42,429 → 71,194 while `last` read 18,838 / 23,591 / 28,765, and each step is
    // the previous total plus that turn's `last` exactly. So `launch-spec.js` attaching `total`
    // here and core's `Math.max(0, total - last)` are both correct on a LIVE session. ⚠ The same
    // measurement continued the total ACROSS a `thread/resume` in a fresh child, which is why
    // `usageResetsOnResume` is now `false` and resume stays refused — for a measured reason.
    // No usage at all is NO MEASUREMENT (`null`), which core skips rather than reading as a total
    // of zero (CX-02 / P4-04).
    out.push(events.result(usage ? t.session : null, model));
    return out;
  }

  // ⚠ `turn/started`, both `*/delta` streams and every unknown method IGNORED — see the header for
  // why the deltas in particular are dropped rather than rendered.
  return [];
}

module.exports = {
  normalize,
  startedEvents, completedEvents, tokensFrom, usageOf, promptUsageOf, windowFrom, isAuthShaped,
  unauthorizedInfo, THREAD_STARTED, ERROR_MESSAGE_TYPE,
};
