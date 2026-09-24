// CORE EVENTS — the constructors an adapter's `normalize()` builds its answer from: the reducer's
// own vocabulary (`main/session-reducer.js`), none of it vendor-shaped. Pure values, so a normalizer
// is testable from a recorded transcript with nothing installed.

// The synthetic frame type core mints for a stream REJECTION (`session-query.js`), so every
// normalizer decides what the error text means rather than core.
const ERROR_FRAME = 'error';

// Pure (tool-profiles + the generated table): a granular call classifies as the legacy call it runs.
const { canonicalDoplCall } = require('../mcp-tool-names');

// ── RENDER EVENTS — dispatched straight through, shapes owned by the renderer ──
const assistant = (text) => ({ type: 'assistant', payload: { type: 'turn', role: 'assistant', text } });
const thinking = (text) => ({ type: 'thinking', payload: { type: 'thinking', text } });
const toolUse = (payload) => ({ type: 'tool_use', payload });
const toolResult = (payload) => ({ type: 'tool_result', payload });
const outboundPost = (payload) => ({ type: 'outbound_post', payload });

/** One tool call `{ id, name, input }` as render events: an own-channel post is ONE `outbound_post`
 *  (never also a tool card), marked pending when `ctx.willGatePost` says it will stop on the gate. */
function toolCallEvents(call, ctx) {
  // Lazy: `session-io` reaches `session-profiles`, which asks this registry for every decision.
  const io = require('../session-io');
  const c = ctx || {};
  const { id, name, input } = call;
  // Classified as the legacy call a granular one runs (DMP-013), the same key the gate reads.
  const legacy = canonicalDoplCall(name, input);
  if (io.isOutboundPost(legacy.name, legacy.input, c.channelId)) {
    const payload = io.withPostSurface({
      type: 'outbound_post',
      toolUseId: id,
      text: input && input.body != null ? String(input.body) : '',
    }, legacy.input, c.peerName, c.peerId);
    // `ownChannel` is a boolean, never another channel's id (§H-9).
    if (typeof c.willGatePost === 'function' && c.willGatePost(input, name) === true) {
      payload.pending = true;
      payload.ownChannel = true;
    }
    return [outboundPost(payload)];
  }
  return [toolUse({
    type: 'tool_use',
    toolUseId: id,
    name,
    inputSummary: io.summarizeInput(input),
    inputFull: io.safeInput(input),
  })];
}

// ── THE THREE CORE APPLIES BEFORE (OR INSTEAD OF) DISPATCHING ──

/** The conversation handle (core persists it before the reducer sees `launched`), the model really
 *  picked, and the raw MCP connect list (F-692): `null` = told nothing, `[]` = connected none. */
const launched = (sessionId, model, mcpServers) => ({
  type: 'launched',
  sessionId,
  model: model || null,
  mcpServers: Array.isArray(mcpServers) ? mcpServers : null,
});

/** A finished turn: the CUMULATIVE token total (core takes the delta). `null` = no measurement (an
 *  interrupted Codex turn), which core skips — never a total of zero. */
const result = (sessionTokens, model) => ({
  type: 'result',
  sessionTokens: typeof sessionTokens === 'number' && Number.isFinite(sessionTokens) ? sessionTokens : null,
  model: model || null,
});

/** Window occupancy of the last prompt, emitted per message and dispatched per turn; never for a
 *  subagent's message. `window` is the platform's own denominator, `null` (never 0) when unreported. */
const context = (tokens, model, window) => ({
  type: 'context',
  tokens: tokens > 0 ? tokens : 0,
  model: model || null,
  window: typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : null,
});

/** No usable credential, recognised in the stream: short-circuits the consume loop (core holds the
 *  session for sign-in). `text` is the platform's sentence, for the log only. */
const authHold = (text) => ({ type: 'auth_hold', text: String(text == null ? '' : text) });

module.exports = {
  assistant, thinking, toolUse, toolResult, toolCallEvents,
  launched, result, context, authHold, ERROR_FRAME,
};
