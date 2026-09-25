// Session I/O helpers: the push prompt iterator, the user turn, the grant arguments, the durable-record
// projection and core-event application. Parameterized, no module state, and no electron: a dozen
// suites require this file in plain node (`diag.js` pulls electron, so it may not be required here).

const { grantDecisionDetail, floorWindowlessTool } = require('./session-profiles');
const { DOPL_CHANNEL_TOOL } = require('./tool-profiles');
const { canonicalDoplCall } = require('./mcp-tool-names');
const outboundTag = require('./session-outbound-tag');
const { isOutboundPost } = outboundTag;
const seed = require('./session-seed');
const mcpConnect = require('./mcp-connect');
const runtimeRegistry = require('./runtime');
const runtimeTruth = require('./session-runtime-truth');

// A bounded FIFO of held interactive inbound replies: only the head is surfaced, a second never overwrites it.
const MAX_PENDING_INBOUND = 16;
function queueInbound(s, item, interactive) {
  if (!interactive) return 'dispatch';
  if (s.pendingInbound.length >= MAX_PENDING_INBOUND) return 'full';
  const wasEmpty = s.pendingInbound.length === 0;
  s.pendingInbound.push(item);
  return wasEmpty ? 'dispatch' : 'queued';
}
function shiftInbound(s) {
  return s.pendingInbound.length ? s.pendingInbound.shift() : null;
}

// The push-based prompt the runtime consumes. It remembers what it handed out (bounded, not a transcript) so
// a superseded launch can be replayed (F-696).
const REPLAY_MAX = 8;
function makePushIterator() {
  const queue = [];
  const handed = [];
  let waiting = null;
  let closed = false;
  const remember = (msg) => {
    handed.push(msg);
    if (handed.length > REPLAY_MAX) handed.shift();
  };
  return {
    push(msg) {
      if (closed) return;
      if (waiting) {
        const w = waiting;
        waiting = null;
        remember(msg);
        w({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    // Delivered and still-queued input; `close()` must not clear it — the MCP-guard retry reads it off a torn-down iterator.
    replayable() {
      return [...handed, ...queue].slice(-REPLAY_MAX);
    },
    close() {
      closed = true;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      if (queue.length) {
        const msg = queue.shift();
        remember(msg);
        return Promise.resolve({ value: msg, done: false });
      }
      if (closed) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    return() {
      closed = true;
      return Promise.resolve({ value: undefined, done: true });
    },
  };
}

// A streaming-input user turn; `priority: 'now'` interjects, absent queues it as the next turn.
function userMessage(text, priority) {
  const m = {
    type: 'user',
    message: { role: 'user', content: String(text == null ? '' : text) },
    parent_tool_use_id: null,
  };
  if (priority) m.priority = priority;
  return m;
}

function summarizeInput(input) {
  try {
    const s = JSON.stringify(input);
    if (!s) return '';
    return s.length > 140 ? s.slice(0, 140) + '…' : s;
  } catch (_) {
    return '';
  }
}

// The full input for the expandable card: passed through when serializable, else a string (IPC-clonable).
function safeInput(input) {
  try {
    JSON.stringify(input);
    return input;
  } catch (_) {
    return String(input);
  }
}

function summarizeResult(content) {
  try {
    const s = typeof content === 'string' ? content : JSON.stringify(content);
    if (!s) return '';
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  } catch (_) {
    return '';
  }
}

/** The one builder of the gate's arguments, so the prediction and the decision cannot drift. Both axes are
 *  read LIVE; absent state fails closed. */
function grantArgs(s, toolName, input) {
  const st = (s && s.state) || {};
  return {
    profile: s.profile,
    toolName: toolName,
    input: input, workspaceId: s.workspaceId, audience: s.audience || null,
    channelId: s.channelId, launchDepth: s.launchDepth, launchChain: s.launchChain === true,
    allowForTask: st.allowForTask || [],
    // The windowless Axis-A floor is applied here, at the one read covering every spawn shape, and never
    // written back to state (the agent view must not show a posture nobody chose).
    toolMode: s && s.windowless === true
      ? floorWindowlessTool(sessionPrivate.effectiveToolMode(s), s.runtimeId)
      : sessionPrivate.effectiveToolMode(s),
    // Which runtime's vocabulary gate steps 1 and 4 are asked in; it decides nothing else.
    runtime: (s && s.runtimeId) || null,
    // A private 1:1 turn withdraws Axis B's out half (session-private.js).
    messageMode: sessionPrivate.effectiveMessageMode(s)
  };
}

// Will this own-channel post stop on a decision? The same question the gate asks, of the same legacy call.
function postWillGate(s, input, toolName) {
  const call = canonicalDoplCall(toolName || DOPL_CHANNEL_TOOL, input);
  return grantDecisionDetail(grantArgs(s, call.name, call.input)).decision === 'gate';
}

const sessionPrivate = require('./session-private'); const postSurface = require('./session-post-surface');
const { withPostSurface, postKindOf } = postSurface;

// The whitelisted durable projection (mirrors session-store); live handles are never copied.
function baseRecord(s) {
  return {
    key: s.key,
    sessionId: s.sessionId,
    channelId: s.channelId,
    taskId: s.taskId,
    workspaceId: s.workspaceId,
    side: s.side,
    profile: s.profile,
    // The launch stamps persist so a record-driven rebuild keeps its depth; absent still reads as the cap.
    launchDepth: s.launchDepth, launchChain: s.launchChain === true,
    mode: s.mode,
    phase: s.state.phase,
    startedAt: s.startedAt,
    counterpartyId: s.counterpartyId || null, direct: s.direct === true, bind: s.bind === 'room' ? 'room' : 'pair', agentId: s.agentId || null,
    counterpartyName: s.counterpartyName || null, channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null, identityName: (s.context && s.context.identity && s.context.identity.name) || null,
    turns: s.state.turns,
    ownPostSeq: s.ownPostSeq,
    model: s.model || null,
    runtimeId: s.runtimeId || null,
    // The usage-baseline word, the record's own once it has one (session-runtime-truth.js).
    ...runtimeTruth.runtimeTruthFields(runtimeRegistry.descriptorFor(s.runtimeId), s),
  };
}

/** Apply the core events one platform message produced (the parsing is the adapter's). Returns the
 *  `auth_hold` event when the stream must stop being read, else the MCP-connect signal or null. */
function applyCoreEvents(s, list, dispatch, store) {
  let mcpSignal = null;
  for (const ev of list || []) {
    if (!ev || !ev.type) continue;
    if (ev.type === 'auth_hold') return ev;
    if (ev.type === 'context') {
      // The meter's last reading, remembered (never dispatched). A turn that measured nothing keeps the last one.
      if (ev.tokens > 0) s.promptTokens = ev.tokens;
      // The window the runtime reported, coerced to a number; none keeps the last, unless the model changed.
      const win = Number(ev.window);
      if (Number.isFinite(win) && win > 0) s.promptWindow = win;
      else if (ev.model && ev.model !== s.liveModel) s.promptWindow = null;
      if (ev.model) s.liveModel = ev.model;
      continue;
    }
    if (ev.type === 'launched') {
      s.sdkSessionId = ev.sessionId;
      // Persist the conversation id BEFORE the reducer hears `launched`: a crash between must leave it recoverable.
      store.setSdkSessionId(s.key, ev.sessionId);
      store.saveRecord(baseRecord(s));
      if (ev.model) s.liveModel = ev.model;
      dispatch(s, { type: 'launched' });
      // Returned after the launch bookkeeping, because the guard's retry re-enters startQuery on this session (F-692).
      mcpSignal = { type: 'mcp_status', status: mcpConnect.doplStatus(ev.mcpServers) };
      continue;
    }
    if (ev.type === 'result') {
      // Cumulative per run, summed as deltas so park+resume survives. An unmeasured turn moves neither the spend
      // nor the baseline — a zero baseline would re-bill the whole running total next turn (P4-04).
      const measured = ev.sessionTokens != null && Number.isFinite(Number(ev.sessionTokens));
      if (measured) {
        const tokenTotal = Number(ev.sessionTokens);
        s.tokensSpent = (s.tokensSpent || 0) + Math.max(0, tokenTotal - (s.lastTotalTokens || 0));
        s.lastTotalTokens = tokenTotal;
      }
      dispatch(s, { type: 'result', model: ev.model });
      continue;
    }
    dispatch(s, ev);
  }
  return mcpSignal;
}

module.exports = {
  makePushIterator,
  userMessage,
  queueInbound,
  shiftInbound,
  frameContinuation: seed.frameContinuation,
  replyFor: seed.replyFor,
  frameHistorySeed: seed.frameHistorySeed,
  historyTranscript: seed.historyTranscript,
  noteGatedBody: seed.noteGatedBody,
  isGatedEntry: seed.isGatedEntry,
  withSeed: seed.withSeed,
  discoveryFor: seed.discoveryFor,
  frameOperatorTurn: seed.frameOperatorTurn,
  postWillGate,
  grantArgs,
  postAddress: postSurface.postAddress,
  postKindOf,
  withPostSurface,
  // How much of a tool input may appear on a card is a privacy rule, so these three stay in one place.
  summarizeInput,
  safeInput,
  summarizeResult,
  isOutboundPost,
  baseRecord,
  applyCoreEvents,
};
