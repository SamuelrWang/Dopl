// THE NORMALIZER — one raw SDK message in, `CoreEvent[]` out. It owns all three raw-message
// consumers (the auth sentinel, the render mapping, the per-message usage), so nothing in core reads
// the platform's schema. Pure: it reads a context and returns events; core applies them.

const events = require('../events');
const io = require('../../session-io');
const modelTable = require('./model-table');
const { readCount } = require('../sdk-shape');
const launchContract = require('./launch-contract');

// The auth-sentinel matchers live in `session-auth-detect.js`.
const detect = require('../../session-auth-detect');

// Core's synthetic frame for a stream REJECTION: the thrown error's text comes through here too, so
// core never decides which errors mean "no credential".
const ERROR_MESSAGE_TYPE = events.ERROR_FRAME;

// The API's refusal of a model this CLI build predates, as the CLI relays it ("API Error: 400 Claude Code
// 2.1.220 does not support this model; version 2.1.251 or newer is required. Run 'claude update', …").
// ⚠ Read only off a message the CLI itself flagged as an API error (`msg.error`): assistant text is content
// a peer can influence, and a reply quoting the sentence must not trigger anything.
const OUTDATED_RE = /does not support this model; version \S+ or newer is required/i;

function isOutdatedRefusal(msg) {
  if (!msg.error) return false;
  const blocks = (msg.message && msg.message.content) || [];
  return blocks.some((b) => b && b.type === 'text' && OUTDATED_RE.test(String(b.text || '')));
}

// Only assistant (text, thinking, tool calls) and user (tool_result) messages render; `ctx` carries
// the channel and peer that classify an own-channel post (`events.toolCallEvents`).
function renderEvents(msg, ctx) {
  const out = [];
  const blocks = (msg && msg.message && msg.message.content) || [];
  if (msg && msg.type === 'assistant') {
    for (const b of blocks) {
      if (b && b.type === 'text' && b.text) {
        out.push(events.assistant(b.text));
      } else if (b && b.type === 'thinking' && b.thinking) {
        out.push(events.thinking(b.thinking)); // work lane, bounded downstream
      } else if (b && b.type === 'tool_use') {
        out.push(...events.toolCallEvents({ id: b.id, name: b.name, input: b.input }, ctx));
      }
    }
  } else if (msg && msg.type === 'user') {
    for (const b of blocks) {
      if (b && b.type === 'tool_result') {
        out.push(events.toolResult({
          type: 'tool_result',
          toolUseId: b.tool_use_id,
          ok: !b.is_error,
          resultSummary: io.summarizeResult(b.content),
        }));
      }
    }
  }
  return out;
}

// The turn's main model: `SDKResultSuccess` carries no `model`, and `modelUsage` lists every model
// the turn called (a helper model included), so the one that read the most prompt wins (RC-06).
function mainModelOf(modelUsage) {
  let best = null;
  let most = -1;
  for (const [id, u] of Object.entries(modelUsage && typeof modelUsage === 'object' ? modelUsage : {})) {
    const read = ((u && u.inputTokens) || 0) + ((u && u.cacheReadInputTokens) || 0);
    if (read > most) { best = id; most = read; }
  }
  return best;
}

// ── THE CONTEXT WINDOW, LEARNED FROM THE CLI (2026-10-08, SDK resilience #1 of the audit) ────────────
// The CLI reports every model's window on each `result` (`modelUsage[id].contextWindow`). It is learned
// here, per model id, and used as the denominator from then on — so a model released after this build
// meters correctly on its first finished turn, and no window is ever typed into Dopl. Before a model's
// first `result` its window is unknown (null, an empty bar), never guessed.
const learnedWindows = new Map();
const plainId = (id) => String(id || '').replace(/\[[^\]]*\]$/, '');

function learnWindows(modelUsage) {
  let reported = 0;
  for (const [id, u] of Object.entries(modelUsage && typeof modelUsage === 'object' ? modelUsage : {})) {
    const w = readCount(u, 'contextWindow');
    if (!w) continue;
    reported += 1;
    learnedWindows.set(id, w);
    // An assistant message names the model without a `[1m]`-style suffix the usage key may carry.
    if (plainId(id) !== id && !learnedWindows.has(plainId(id))) learnedWindows.set(plainId(id), w);
  }
  return reported;
}

/** The learned window for a model id, or null. */
function windowFor(model) {
  if (!model) return null;
  return learnedWindows.get(model) || learnedWindows.get(plainId(model)) || null;
}

/** One window the CLI stated outside a result (its `getContextUsage()` answer, `launch-spec.js`). */
function learnWindow(model, window) {
  const w = typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : 0;
  if (!model || !w) return;
  learnedWindows.set(String(model), w);
  if (plainId(model) !== model) learnedWindows.set(plainId(model), w);
}

/** Tests only: forget every learned window. */
function forgetWindows() { learnedWindows.clear(); }

/** One raw SDK message → the CoreEvents it means. The auth sentinel is checked FIRST and returns
 *  alone: it short-circuits the consume loop, and a render event beside it would paint the dead end. */
function normalize(msg, ctx) {
  const context = ctx || {};
  if (!msg || !msg.type) return [];

  if (msg.type === ERROR_MESSAGE_TYPE) {
    const text = String(msg.text == null ? '' : msg.text);
    const authShaped = detect.isAuthShapedError(text) || detect.CLI_LOGIN_SENTINEL.test(text);
    return authShaped ? [events.authHold(text)] : [];
  }

  const authText = detect.authFailureText(msg);
  if (authText) return [events.authHold(authText)];

  if (msg.type === 'system' && msg.subtype === 'init') {
    // The conversation handle, the model really running, and the raw MCP connect list — the
    // shape is this platform's, the decision core's (`mcp-connect.js`, F-692).
    const out = [events.launched(msg.session_id, msg.model, msg.mcp_servers)];
    // The CLI's own report vs what this launch asked it to enforce (`launch-contract.js`). A launch with no
    // recorded contract (a harness) is not checked; every real spawn records one in `launch-spec.js`.
    if (context.launchContract) {
      const { refuse, drift } = launchContract.verifyInit(msg, context.launchContract);
      for (const d of drift) out.push(events.shapeDrift('init.tools', d));
      if (refuse.length) out.push(events.safetyMismatch(launchContract.mismatchSentence(msg, context.launchContract)));
    }
    return out;
  }

  // Its sentence tells the operator to run `claude update`, which a Dopl user has no way to do.
  if (msg.type === 'assistant' && isOutdatedRefusal(msg)) return [events.runtimeOutdated()];

  if (msg.type === 'assistant' || msg.type === 'user') {
    const out = renderEvents(msg, context);
    // A subagent's messages render but never meter: a delegated run has its own window.
    if (msg.type === 'assistant' && msg.parent_tool_use_id == null) {
      const m = msg.message || {};
      const tokens = modelTable.promptTokens(m.usage);
      const model = typeof m.model === 'string' && m.model ? m.model : null; // mid-session switch
      // The window is the one the CLI reported for this model on a `result` (null until it has).
      if (tokens > 0 || model) out.push(events.context(tokens, model, windowFor(model)));
    }
    return out;
  }

  if (msg.type === 'result') {
    const out = [];
    const usage = msg.modelUsage && typeof msg.modelUsage === 'object' ? msg.modelUsage : null;
    const reported = learnWindows(usage);
    const main = mainModelOf(usage);
    // The window, BEFORE the result: the turn's reading is sampled when the result lands. `model: null`
    // so a usage key spelled differently from the message's model never reads as a model switch.
    const window = windowFor(main);
    if (window) out.push(events.context(0, null, window));
    // A usage block with models but no window field: the CLI changed what it reports (the shared ledger).
    if (usage && Object.keys(usage).length && !reported) {
      out.push(events.shapeDrift('result.modelUsage.contextWindow', 'a result reported model usage without a context window'));
    }
    // Cumulative for this QUERY (a resumed query restarts it); core takes the delta. No cost is read.
    out.push(events.result(modelTable.sessionTokens(msg.usage), main));
    return out;
  }

  return []; // unknown types ignored
}

module.exports = { normalize, renderEvents, windowFor, learnWindow, forgetWindows, ERROR_MESSAGE_TYPE };
