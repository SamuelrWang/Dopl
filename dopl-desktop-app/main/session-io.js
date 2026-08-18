// Session engine I/O helpers (v1.9 Session Window, Track T1).
//
// The push-based prompt iterator, the SDKUserMessage constructor, the SDK-message -> reducer-event
// mapping, the canUseTool permission bridge, the durable-record projection, and the
// tool-input/result summarizers (the untrusted-inbound continuation fence + the seed live in
// session-seed.js, re-exported at the bottom unchanged). Split out of session-engine.js so each
// stays under the 500-line §2 cap (contract §E). Every helper here is PARAMETERIZED — it takes the
// session object plus `dispatch` / `store` as arguments and holds NO module-level mutable state
// and NO electron / SDK handle, so the engine remains the only stateful, electron-bound module.

const crypto = require('crypto');
const { grantDecisionDetail, grantKeyFor, isOwnChannelPost, isChannelTool, mcpShortName } = require('./session-profiles');
const { DOPL_CHANNEL_TOOL } = require('./tool-profiles');
// The own-channel-post classifier (`isOutboundPost`) and the FORCED thread tag live in
// session-outbound-tag.js (§2 cap). isOutboundPost is re-exported below, so no caller changed.
const outboundTag = require('./session-outbound-tag');
const { isOutboundPost } = outboundTag;
// The turn-TEXT assembly (fences, the channel-history seed, the gate-exclusion
// bookkeeping, the one-shot fresh-shell framing) lives in session-seed.js — the §2
// 500-line split. Re-exported verbatim at the bottom, so every caller is unchanged.
const seed = require('./session-seed');
// The two token derivations live with the frozen model/window tables that give them meaning
// (session-model.js). Required, never re-implemented: a second copy of "which usage fields
// count" is how the context meter and the spend line come to disagree about the same block.
const sessionModel = require('./session-model');

// I-LOW(a): a bounded FIFO queue of pending inbound counterparty replies lives on the session
// object (`s.pendingInbound`, an array). In INTERACTIVE mode the operator releases them one at a
// time, so a second reply landing before the first is released must NOT overwrite it (the old
// single-slot field dropped it); only the HEAD is surfaced, the rest wait. In AUTONOMOUS mode the
// reducer pushes each reply straight to the SDK, so nothing is ever held here.
const MAX_PENDING_INBOUND = 16;
function queueInbound(s, item, interactive) {
  if (!interactive) return 'dispatch'; // autonomous: never hold, push immediately
  if (s.pendingInbound.length >= MAX_PENDING_INBOUND) return 'full'; // overflow -> caller falls through
  const wasEmpty = s.pendingInbound.length === 0;
  s.pendingInbound.push(item);
  return wasEmpty ? 'dispatch' : 'queued'; // only the head is shown; the rest wait
}
function shiftInbound(s) {
  return s.pendingInbound.length ? s.pendingInbound.shift() : null;
}

// A push-based AsyncIterable<SDKUserMessage>: the SDK consumes it as the live
// prompt; the engine `push()`es the first framed turn, steer text, and fed inbound
// replies (research §6). `close()` ends the stream so a `for await` completes.
function makePushIterator() {
  const queue = [];
  let waiting = null;
  let closed = false;
  return {
    push(msg) {
      if (closed) return;
      if (waiting) {
        const w = waiting;
        waiting = null;
        w({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
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
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
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

// A streaming-input user turn. `priority:'now'` interjects mid-turn (research §6);
// omitted otherwise so the SDK queues it as the next turn.
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

// The full input for the expandable card. Passed straight through when it is
// JSON-serializable (the renderer stringifies + textContent-renders it); a
// non-serializable value degrades to a string so the IPC payload stays clonable.
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

// v2.9 — the per-call grant arguments read off the live session. ONE place builds them, so the
// prediction and the decision can never drift apart. Both axes are read LIVE (like allowForTask):
// a mode changed mid-turn applies to the next call. Absent state => the fail-closed defaults.
function grantArgs(s, toolName, input) {
  const st = (s && s.state) || {};
  return {
    profile: s.profile,
    toolName: toolName,
    input: input,
    channelId: s.channelId,
    allowForTask: st.allowForTask || [],
    toolMode: st.toolMode, // AXIS A — never consulted for a dopl_channel call
    messageMode: st.messageMode, // AXIS B — never consulted for anything else
  };
}

// v2.7 L3 — WILL this own-channel post stop on an operator decision? It asks the SAME decision
// makeCanUseTool asks, with the SAME arguments, so the stream-time artifact and the gate agree
// about the SAME post: one that gates paints as the inline decision card (`pending`), one that is
// auto-approved paints as the delivered record. It DECIDES nothing — makeCanUseTool stays the only
// decision point. FIX F3: the real tool NAME is threaded through (grant keys are per tool name, so
// asking about `dopl_channel` for a `dopl_channel_v2` call would claim "sent" over a held post).
function postWillGate(s, input, toolName) {
  return grantDecisionDetail(grantArgs(s, toolName || DOPL_CHANNEL_TOOL, input)).decision === 'gate';
}

// ── THE GATE DIAG LINE (2026-08-02) ───────────────────────────────────────────────
// "Bypass still asks" had to be diagnosed from SOURCE, because a session logged nothing about
// why it stopped: "the mode never landed" and "the mode landed but does not cover this tool"
// looked identical in the field. One line per verdict fixes that, and it is deliberately THIN:
// the tool NAME (server prefix stripped, capped), M3's channel OP, the verdict, the reason code,
// both postures, and an 8-char session prefix to join on — attended-handoff's diag discipline.
// NEVER the tool input, the drafted body, prompt text, or a full id: listener.log is plaintext.
// F-139: the strip is `mcpShortName`, the gate's OWN normalizer, never a third copy of the rule.
const DIAG_NAME_CAP = 40; const DIAG_OP_CAP = 24;
function shortToolLabel(name) {
  return mcpShortName(name).slice(0, DIAG_NAME_CAP) || 'unnamed';
}
// M3 (2026-08-05) — THE OP, ON THE LINE. `dopl_channel gate channel-op-approval-required` read
// identically for a read, an invite and a DM open, so the read/post incoherence took code
// archaeology to find. THE OP NAME ONLY (a closed vocabulary from the server's enum), sanitized
// because it arrives from model input; never a body, recipient or channel. Non-channel tools get
// no `op=` segment, so every line this file already produced is byte-unchanged.
function channelOpLabel(toolName, callInput) {
  if (!isChannelTool(toolName)) return '';
  const raw = callInput && callInput.op;
  if (typeof raw !== 'string') return raw == null ? 'none' : 'invalid';
  return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, DIAG_OP_CAP) || 'invalid';
}
function logGateVerdict(log, s, toolName, verdict, op) {
  if (typeof log !== 'function') return;
  const st = (s && s.state) || {};
  log.apply(null, ['session gate:', shortToolLabel(toolName)].concat(op ? ['op=' + op] : [],
    [verdict.decision, verdict.reason || 'no-reason', 'tool=' + (st.toolMode || 'manual'),
      'msg=' + (st.messageMode || 'ask'), 'session=' + String(s && s.sessionId ? s.sessionId : '').slice(0, 8)]));
}

// ─── THE POST SURFACE MOVED OUT (§2 split, 2026-08-06) ────────────────────────
// `TO_CAP` / `KIND_CAP` / `oneLineField` / `postAddress` / `postKindOf` /
// `withPostSurface` now live in `main/session-post-surface.js`. This file was at EXACTLY the
// 500-line cap with zero headroom, and threading the counterparty id through
// `withPostSurface` (so `to` is a display NAME, not the raw id an agent typed) pushed it
// over. The block was already marked pure and already sliced out by source extraction, so
// it was a module in everything but filename.
//
// RE-EXPORTED BELOW, so `io.withPostSurface(...)` keeps working for every existing caller.
const postSurface = require('./session-post-surface');
const { withPostSurface, postKindOf } = postSurface;

// Map ONE SDK message to the reducer events the renderer needs. Only assistant (text turns +
// tool_use cards + op=post outbound messages) and user (tool_result fills) produce render events;
// system/init and result are handled directly by the engine (they mutate session state). Unknown
// types -> []. `sessionChannelId` + `peerName` (item 2 / §B.4) classify an own-channel post as an
// `outbound_post` addressed to the peer. `willGatePost` (v2.7 L3, optional — an absent predicate
// reads as "never gates") marks that post PENDING so the renderer paints the decision card.
function sdkRenderEvents(msg, sessionChannelId, peerName, willGatePost, peerId) {
  const out = [];
  const blocks = (msg && msg.message && msg.message.content) || [];
  if (msg && msg.type === 'assistant') {
    for (const b of blocks) {
      if (b && b.type === 'text' && b.text) {
        out.push({ type: 'assistant', payload: { type: 'turn', role: 'assistant', text: b.text } });
      } else if (b && b.type === 'tool_use') {
        if (isOutboundPost(b.name, b.input, sessionChannelId)) {
          // The agent wants to SEND a message to the peer. Emit ONE `outbound_post` and
          // SUPPRESS the generic tool card for this same tool_use, so a sent message never
          // double-renders as a tool call. It flows THROUGH the reducer (case 'outbound_post')
          // so it can set postedThisTurn: recorded optimistically here, un-counted on the two
          // paths that retract a post — a failing tool_result (FIX F3) and a park (FIX F6).
          // MEDIUM-2: `to` is the call's REAL addressee when it set one, the bound
          // counterparty otherwise; `postKind` rides along for a lifecycle-kinded post.
          const payload = withPostSurface({
            type: 'outbound_post',
            toolUseId: b.id,
            text: b.input && b.input.body != null ? String(b.input.body) : '',
          }, b.input, peerName, peerId);
          // v2.7 L3: the SAME item becomes the inline Send / Deny card while it waits,
          // then resolves in place. `ownChannel` feeds the card's destination line (the
          // renderer is fail-suspicious: anything but an explicit true reads as another
          // channel), and it is a boolean — never another channel's id (§H-9).
          if (typeof willGatePost === 'function' && willGatePost(b.input, b.name) === true) {
            payload.pending = true;
            payload.ownChannel = true;
          }
          out.push({ type: 'outbound_post', payload });
        } else {
          out.push({
            type: 'tool_use',
            payload: {
              type: 'tool_use',
              toolUseId: b.id,
              name: b.name,
              inputSummary: summarizeInput(b.input),
              inputFull: safeInput(b.input),
            },
          });
        }
      }
    }
  } else if (msg && msg.type === 'user') {
    for (const b of blocks) {
      if (b && b.type === 'tool_result') {
        out.push({
          type: 'tool_result',
          payload: {
            type: 'tool_result',
            toolUseId: b.tool_use_id,
            ok: !b.is_error,
            resultSummary: summarizeResult(b.content),
          },
        });
      }
    }
  }
  return out;
}

// The whitelisted durable projection of a live session (mirrors the store shape).
// Live handles (query / window / iterator) are NEVER copied — only the fields the
// interrupted-echo + resume path need. `phase` is read from the reducer state.
function baseRecord(s) {
  return {
    key: s.key,
    sessionId: s.sessionId,
    sdkSessionId: s.sdkSessionId || null,
    channelId: s.channelId,
    taskId: s.taskId,
    workspaceId: s.workspaceId,
    side: s.side,
    profile: s.profile,
    mode: s.mode,
    phase: s.state.phase,
    startedAt: s.startedAt,
    counterpartyId: s.counterpartyId || null, direct: s.direct === true, bind: s.bind === 'room' ? 'room' : 'pair', agentId: s.agentId || null, // FIX L1: the other party; (H2) whether the server addresses posts for us; (D2) the binding mode + the agent this session runs as
    // v1.7.5 D1: the HEADER IDENTITY, sourced from s.context/spec at startSession. A parked
    // record is the only thing a P2 recreate (or a post-restart resume) has to rebuild the window
    // from, so without these the reopened header fell back to a bare "Session".
    counterpartyName: s.counterpartyName || null,
    channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null,
    // FIX #9: the running cap counters, so a P2 recreate rehydrates the budget of a
    // turn/cost-capped (or parked) session instead of resetting it to a fresh one.
    turns: s.state.turns,
    costUsd: s.state.costUsd,
    // 2026-08-02: the operator's MODEL pick, whitelisted so a P2 recreate or a crash resume
    // comes back on the model they chose. Without it a recreate silently reverts to the CLI
    // default while the third select still claims the pick — the exact defect class the
    // durable-whitelist discipline exists to kill. Coerced against the frozen enum on the way
    // OUT (session-store.durableSessionRecord) and again on the way back IN (startSession),
    // so this projection stays a plain copy with no dependency of its own.
    model: s.model || null,
  };
}

// The canUseTool bridge. Profile pre-approved reads are shadowed by allowedTools and never reach
// here; what DOES reach here is the live-gated work tools plus `dopl_channel` (FIX H1 removed it
// from allowedTools). It consults the OP-SCOPED decision FIRST, with the tool INPUT and the
// session's OWN channelId. 'preapproved' / 'allow' auto-allow with NO button (v2.5 D2: an
// own-channel post no longer lands in the first of those; it GATES like every write); 'deny'
// refuses without one (belt — disallowedTools should have blocked it before the SDK called us);
// 'gate' PAUSES on an awaited operator button, and only that branch stashes a resolver on the
// session for resolvePermission. `log` is injected (session-engine passes diag) so this module
// stays electron-free.
function makeCanUseTool(s, dispatch, log) {
  return function canUseTool(name, input, opts) {
    // v2.9: BOTH axes resolve inside grantDecision — there is no post-decision override here any
    // more. The old item-10 `gate && autoApprove -> allow` line is gone: a second decision point
    // that knew nothing about which axis a call belonged to is exactly how one switch came to
    // authorize both Bash and outbound messages. 2026-08-02: the verdict comes back WITH the
    // reason code that explains it, for the card and for the diag line.
    const verdict = grantDecisionDetail(grantArgs(s, name, input));
    const decision = verdict.decision;
    logGateVerdict(log, s, name, verdict, channelOpLabel(name, input));
    // THE FORCED THREAD TAG (session-outbound-tag.js — the prompt alone demonstrably does
    // not hold it). Computed here but read only on an ALLOW: it rides a verdict, it never
    // makes one, and both axes resolved above without ever seeing it.
    const tag = isOutboundPost(name, input, s.channelId) ? outboundTag.threadTagFor(input, s.taskId) : null;
    if (tag && tag.action === 'conflict' && typeof log === 'function') {
      log('session: outbound post names thread', String(tag.supplied).slice(0, 24),
        'but this session drives', String(tag.wanted).slice(0, 24), '— leaving the call as written');
    }
    if (decision === 'preapproved' || decision === 'allow') return Promise.resolve(outboundTag.allowResult(tag));
    if (decision === 'deny') return Promise.resolve({ behavior: 'deny', message: 'Blocked for this session' });
    return new Promise((resolve) => {
      const requestId = (opts && opts.requestId) || crypto.randomUUID();
      // v2.5 D2: the GRANT KEY (not always the bare tool name) is what an "Allow for
      // this task" click records, so a post grant stays scoped to own-channel posts.
      // The renderer still sees the real tool name in the payload.
      const grantName = grantKeyFor(name, input, s.channelId);
      // The tag rides the OPERATOR's allow here; a deny (park included) carries nothing.
      s.pendingPermissions.set(requestId, outboundTag.wrapAllow(resolve, tag));
      s.pendingNames.set(requestId, grantName);
      // v2.7 L3 — an OWN-CHANNEL POST decides on its own inline stream card instead of in
      // the bottom dock. The POLICY path is untouched: the same `permission_request` reducer
      // event, the same pendingPermissions tracking (a park still deny-closes it fail-closed and
      // the auto-approve drain still resolves it), the same scoped grantName, the same fail-closed
      // permission_decision mapping. ONLY the renderer PAYLOAD differs — `outbound_gate` hands the
      // already-painted pending card its requestId, so the card answers for ITSELF and the dock is
      // free for the next NON-post request. Every other tool (Bash / Write / WebFetch / a
      // CROSS-channel post, the exfil shape FIX #9 marks) keeps the dock payload below.
      // FIX F4: the gate also carries the AUTHORIZED BYTES — the body this call is holding, plus
      // the destination name — so the card's surface comes from the input the decision covers, not
      // the separately streamed copy. It doubles as the RE-CREATE path (FIX F5): a gate whose
      // stream-time artifact never landed still paints a card, so a post can never gate invisibly.
      // `to` is a display NAME and ownChannel a boolean — never another channel's id (§H-9).
      const payload = isOutboundPost(name, input, s.channelId)
        ? withPostSurface({
          type: 'outbound_gate',
          requestId,
          toolUseId: opts && opts.toolUseID,
          ownChannel: true, ...(s.direct === true ? { directChannel: true } : {}), // H2: in a DM the server addresses this post, so the card names who gets it
          text: input && input.body != null ? String(input.body) : '',
        }, input, s.counterpartyName, s.counterpartyId)
        : {
          type: 'permission_request',
          requestId,
          toolUseId: opts && opts.toolUseID,
          name,
          // FIX #9: WHERE an op=post is headed. The dock rendered the body with no target,
          // so a cross-channel post (the exfil shape D2 exists to catch) looked exactly
          // like a normal reply, and the 140-char inputSummary usually truncated the
          // channel field away. A boolean, never the other channel's id (§H-9).
          ownChannel: isOwnChannelPost(input, s.channelId),
          inputSummary: summarizeInput(input),
          inputFull: safeInput(input),
          title: opts && opts.title,
          // MEDIUM-2 belt for the DOCK path (a CROSS-channel post): name a forged
          // lifecycle kind here too. `to` is deliberately left off — this card's
          // destination line already reads "another channel", the louder warning.
          postKind: postKindOf(input),
        };
      if (payload.postKind == null) delete payload.postKind; // absent stays absent
      // 2026-08-02 — WHY THIS CARD IS ON SCREEN, on BOTH gate surfaces. Without it every
      // uncovered tool reads as a broken bypass toggle and every slug-addressed post reads as
      // a random refusal. A CODE, never words: the renderer owns the copy, and a code it does
      // not know renders no line rather than a guess. Absent stays absent, like postKind.
      if (verdict.reason) payload.gateReason = verdict.reason;
      dispatch(s, { type: 'permission_request', requestId, name: grantName, payload });
    });
  };
}

// Map ONE raw SDK message onto reducer events (the "event mapping" half of the pre-authorized
// split). system/init captures the sdkSessionId + persists the record then dispatches `launched`;
// assistant/user become render events; result hands the reducer a per-turn cost DELTA
// (total_cost_usd is cumulative). Unknown message types are ignored. `dispatch` + `store` are
// injected so this stays electron/SDK-handle-free.
function handleSdkMessage(s, msg, dispatch, store) {
  if (!msg || !msg.type) return;
  if (msg.type === 'system' && msg.subtype === 'init') {
    s.sdkSessionId = msg.session_id;
    store.setSdkSessionId(s.key, msg.session_id);
    store.saveRecord(baseRecord(s));
    dispatch(s, {
      type: 'launched',
      payload: {
        type: 'init',
        sessionId: s.sessionId,
        side: s.side,
        profile: s.profile,
        mode: s.mode,
        model: msg.model,
        profileLabel: s.profileLabel || null, // item 9: human posture label (§B.2)
        channelName: (s.context && s.context.channelName) || null,
        taskTitle: (s.context && s.context.taskTitle) || null,
        from: s.counterpartyName || null,
        // Item 1/5/6 (§B.1): bounded data: URIs (or null) — the operator's photo for
        // my-agent/operator/outbound bubbles, the peer's for counterparty bubbles +
        // the header. Warm here when the cache is hot; else null + a follow-up
        // `avatars` event from avatar-cache.resolveForSession. NEVER a remote URL.
        selfAvatar: s.selfAvatar || null,
        fromAvatar: s.peerAvatar || null,
        // NEVER send the SDK's absolute cwd to the renderer (label-only rule).
        // The engine's emitFolder() feeds the folder chip the abbreviated label.
        cwdLabel: null,
      },
    });
    return;
  }
  if (msg.type === 'assistant' || msg.type === 'user') {
    // §B.4 seam: pass the session's OWN channelId + the counterparty display name so
    // an op=post into this channel renders as an outbound message to the peer. v2.7 L3
    // adds the gate PREDICTION so that one artifact starts as the decision card when the
    // post is going to stop on an operator button.
    const willGate = (input, toolName) => postWillGate(s, input, toolName);
    for (const ev of sdkRenderEvents(msg, s.channelId, s.counterpartyName, willGate, s.counterpartyId)) dispatch(s, ev);
    return;
  }
  if (msg.type === 'result') {
    const total = Number(msg.total_cost_usd) || 0;
    const turnCost = Math.max(0, total - (s.lastTotalCost || 0));
    s.lastTotalCost = total;
    // LIFETIME TOKEN SPEND, accumulated by the SAME arithmetic as the cost right above it and
    // for the same reason: `msg.usage` is this QUERY's running total, so a resumed query
    // restarts it from zero (session-park resets both baselines together). Summing DELTAS is
    // what makes the figure survive a park+resume; taking the raw total would make it collapse.
    // ⚠ NOT the context meter's number — see session-model.js `sessionTokens` vs `promptTokens`.
    const tokenTotal = sessionModel.sessionTokens(msg.usage);
    s.tokensSpent = (s.tokensSpent || 0) + Math.max(0, tokenTotal - (s.lastTotalTokens || 0));
    s.lastTotalTokens = tokenTotal;
    const model = msg.model || (msg.modelUsage && Object.keys(msg.modelUsage)[0]) || null;
    dispatch(s, { type: 'result', turnCostUsd: turnCost, model });
  }
}

module.exports = {
  makePushIterator,
  userMessage,
  queueInbound,
  shiftInbound,
  // ── re-exported VERBATIM from session-seed.js (the §2 split) ────────────────
  frameContinuation: seed.frameContinuation,
  frameHistorySeed: seed.frameHistorySeed, // v2.5 D3
  // (initialRequestPayload is re-exported below, beside the other display-only helpers)
  historyTranscript: seed.historyTranscript, // v2.5 D3 (the lazy seed — FIX F1)
  noteGatedBody: seed.noteGatedBody, // FIX F1: a gated message never rides the seed as well
  isGatedEntry: seed.isGatedEntry, // FIX F4: session-history drops those rows from the ENTRIES too
  withSeed: seed.withSeed,
  postWillGate, // v2.7 L3: does an own-channel post stop on an operator decision?
  grantArgs, // v2.9: the ONE argument builder both the prediction and the gate use
  // §2 SPLIT (2026-08-06): these three moved to session-post-surface.js and are RE-EXPORTED
  // here unchanged, so every existing `io.<name>` caller and test is untouched by the move.
  postAddress: postSurface.postAddress, // MEDIUM-2: the call's REAL addressee (null when unaddressed)
  postKindOf, // MEDIUM-2: the lifecycle kind it claims (null for a plain message)
  withPostSurface,
  summarizeInput,
  safeInput,
  summarizeResult,
  initialRequestPayload: seed.initialRequestPayload, // the initiating ask, display-only (§2 split)
  isOutboundPost,
  sdkRenderEvents,
  baseRecord,
  makeCanUseTool,
  handleSdkMessage,
};
