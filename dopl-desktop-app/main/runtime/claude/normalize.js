// THE NORMALIZER — one raw SDK message in, `CoreEvent[]` out. It owns all three raw-message
// consumers (the auth sentinel, the render mapping, the per-message usage), so nothing in core reads
// the platform's schema. Pure: it reads a context and returns events; core applies them.

const events = require('../events');
const io = require('../../session-io');
const modelTable = require('./model-table');

// The auth-sentinel matchers live beside the operator copy in `session-auth-detect.js`.
const detect = require('../../session-auth-detect');

// Core's synthetic frame for a stream REJECTION: the thrown error's text comes through here too, so
// core never decides which errors mean "no credential".
const ERROR_MESSAGE_TYPE = events.ERROR_FRAME;

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
    return [events.launched(msg.session_id, msg.model, msg.mcp_servers)];
  }

  if (msg.type === 'assistant' || msg.type === 'user') {
    const out = renderEvents(msg, context);
    // A subagent's messages render but never meter: a delegated run has its own window.
    if (msg.type === 'assistant' && msg.parent_tool_use_id == null) {
      const m = msg.message || {};
      const tokens = modelTable.promptTokens(m.usage);
      const model = typeof m.model === 'string' && m.model ? m.model : null; // mid-session switch
      // The window comes from this adapter's table: the CLI reports none (null when unknown).
      if (tokens > 0 || model) out.push(events.context(tokens, model, modelTable.contextWindowFor(model)));
    }
    return out;
  }

  if (msg.type === 'result') {
    // Cumulative for this QUERY (a resumed query restarts it); core takes the delta. No cost is read.
    return [events.result(modelTable.sessionTokens(msg.usage), mainModelOf(msg.modelUsage))];
  }

  return []; // unknown types ignored
}

module.exports = { normalize, renderEvents, ERROR_MESSAGE_TYPE };
