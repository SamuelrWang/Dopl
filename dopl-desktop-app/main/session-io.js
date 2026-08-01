// Session engine I/O helpers (v1.9 Session Window, Track T1).
//
// The push-based prompt iterator, the SDKUserMessage constructor, the SDK-message
// -> reducer-event mapping, the canUseTool permission bridge, the durable-record
// projection, and the tool-input/result summarizers (the untrusted-inbound
// continuation fence + the seed live in session-seed.js, re-exported at the bottom
// unchanged). Split out of session-engine.js so each stays under the 500-line §2
// cap (the pre-authorized "move the canUseTool bridge + event mapping into
// session-io.js" split, contract §E). Every helper here is PARAMETERIZED — it
// takes the session object plus `dispatch` / `store` as arguments and holds NO
// module-level mutable state and NO electron / SDK handle, so the engine (the
// imperative shell) remains the only stateful, electron-bound module.

const crypto = require('crypto');
const { grantDecision, grantKeyFor, isOwnChannelPost } = require('./session-profiles');
const { DOPL_CHANNEL_TOOL } = require('./tool-profiles');
// The own-channel-post classifier (`isOutboundPost`) and the FORCED thread tag live in
// session-outbound-tag.js (§2 cap). isOutboundPost is re-exported below, so no caller changed.
const outboundTag = require('./session-outbound-tag');
const { isOutboundPost } = outboundTag;
// The turn-TEXT assembly (fences, the channel-history seed, the gate-exclusion
// bookkeeping, the one-shot fresh-shell framing) lives in session-seed.js — the §2
// 500-line split. Re-exported verbatim at the bottom, so every caller is unchanged.
const seed = require('./session-seed');

// I-LOW(a): a bounded FIFO queue of pending inbound counterparty replies lives on
// the session object (`s.pendingInbound`, an array). In INTERACTIVE mode the
// operator releases them one at a time, so a second reply that lands before the
// first is released must NOT overwrite it (the old single-slot field dropped it);
// only the HEAD is surfaced to the operator, the rest wait. In AUTONOMOUS mode the
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

// v2.9 — the per-call grant arguments read off the live session. ONE place builds them, so
// postWillGate's prediction and makeCanUseTool's decision can never drift apart. Both axes
// are read LIVE (like allowForTask): a mode the operator changes mid-turn applies to the
// very next call. Absent state => grantDecision's own fail-closed defaults (manual / ask).
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

// v2.7 L3 — WILL this own-channel post stop on an operator decision? It asks the SAME
// grantDecision makeCanUseTool asks, with the SAME arguments, so the stream-time artifact and
// the gate agree about the SAME post: one that gates is painted as the inline decision card
// (`pending`), one that is auto-approved (a scoped task grant, or Axis B set to auto_outbound /
// auto_both) is painted as the delivered record. This does NOT decide anything — makeCanUseTool
// remains the only decision point; it only chooses which artifact the stream shows. FIX F3: the
// real tool NAME is threaded through (defaulting to the canonical one) because grant keys are
// per tool name — asking about `dopl_channel` for a call the SDK made as `dopl_channel_v2` would
// predict against a key the decision never consults, and claim "sent" over a held post.
function postWillGate(s, input, toolName) {
  return grantDecision(grantArgs(s, toolName || DOPL_CHANNEL_TOOL, input)) === 'gate';
}

// ─── BEGIN SESSION-IO-POST-SURFACE (pure; unit-tested via source extraction) ───
// MEDIUM-2 — WHO this post is really addressed to, and WHAT kind it claims to be. The card
// used to print the session's bound counterparty for every post, so a post addressed to a
// DIFFERENT channel member (`to:`) or forged as a lifecycle event (`kind:task_finished`)
// looked exactly like a plain reply to the peer. Both now ride the payload and are painted
// (session-labels.postDestinationText), and both are folded into the grant key
// (session-profiles.postScope), so approving one reply cannot authorize either.
const TO_CAP = 60;
const KIND_CAP = 40;
// FIX F9 (v2.9 review) — THE KEY AND THE CARD MUST NAME THE SAME THING. postScope keys ANY
// non-'message' kind, but this named only the four-value enum, so `kind:'Task_Finished'` (or any
// other invented kind the peer's UI might act on) earned its OWN grant key while the card showed
// NOTHING and the operator approved what read as a plain reply. Every non-empty kind is rendered
// now. And a NON-STRING `to`/`kind` is never rendered as a value it is not: String({a:1}) is
// '[object Object]' and String(['alice']) is 'alice', so a malformed field says so in plain
// words — and grantDecision refuses to auto-allow those calls at all (postFieldsOk), so this
// label is always shown before anything is sent.
function oneLineField(value, cap) {
  const raw = String(value).replace(/\s+/g, ' ').trim();
  return raw.length > cap ? raw.slice(0, cap - 1).trimEnd() + '…' : raw;
}
function postAddress(input) {
  const to = input ? input.to : null;
  if (to == null || to === '') return null; // unaddressed -> the bound counterparty
  return typeof to === 'string' ? (oneLineField(to, TO_CAP) || null) : 'an invalid recipient';
}
function postKindOf(input) {
  const k = input ? input.kind : null;
  if (k == null || k === '' || k === 'message') return null; // the plain-chat default
  return typeof k === 'string' ? (oneLineField(k, KIND_CAP) || null) : 'an invalid kind';
}
// Stamp the two fields on a post payload, ONLY when they are really set: an absent field
// must leave the payload byte-identical to the one every existing surface already renders.
function withPostSurface(payload, input, fallbackTo) {
  const addressed = postAddress(input);
  const kind = postKindOf(input);
  payload.to = addressed || fallbackTo || null;
  if (addressed) payload.addressed = true;
  if (kind) payload.postKind = kind;
  return payload;
}
// ─── END SESSION-IO-POST-SURFACE ──────────────────────────────────────────────

// Map ONE SDK message to the reducer events the renderer needs. Only assistant
// (text turns + tool_use cards + op=post outbound messages) and user (tool_result
// fills) produce render events; system/init and result are handled directly by the
// engine (they mutate session state — sdkSessionId capture, cost delta). Unknown
// types -> []. `sessionChannelId` + `peerName` (item 2 / §B.4) classify an
// own-channel post as an `outbound_post` addressed to the peer. `willGatePost` (v2.7 L3,
// optional — an absent predicate reads as "never gates", i.e. the pre-v2.7 shape) marks
// that post PENDING so the renderer paints the decision card instead of a delivery.
function sdkRenderEvents(msg, sessionChannelId, peerName, willGatePost) {
  const out = [];
  const blocks = (msg && msg.message && msg.message.content) || [];
  if (msg && msg.type === 'assistant') {
    for (const b of blocks) {
      if (b && b.type === 'text' && b.text) {
        out.push({ type: 'assistant', payload: { type: 'turn', role: 'assistant', text: b.text } });
      } else if (b && b.type === 'tool_use') {
        if (isOutboundPost(b.name, b.input, sessionChannelId)) {
          // The agent wants to SEND a message to the peer. Emit ONE `outbound_post` and
          // SUPPRESS the generic tool card for this same tool_use, so a sent message
          // never double-renders as a tool call. This event flows THROUGH the reducer
          // (case 'outbound_post') so it can set postedThisTurn — v2.7 keeps that
          // accounting exactly where it was: the id is recorded optimistically here, and it
          // is un-counted on the two paths that can retract the post — a failing
          // tool_result (FIX F3) and a park, which clears the per-turn counters with the
          // card it deny-closes (FIX F6, reducer idle_timeout).
          // MEDIUM-2: `to` is the call's REAL addressee when it set one, the bound
          // counterparty otherwise; `postKind` rides along for a lifecycle-kinded post.
          const payload = withPostSurface({
            type: 'outbound_post',
            toolUseId: b.id,
            text: b.input && b.input.body != null ? String(b.input.body) : '',
          }, b.input, peerName);
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

// FIX (v2.x): the INITIATING request as a DISPLAY-ONLY stream item for the TOP of the
// transcript. main feeds the raw request body to the agent as its fenced first turn
// (framing.buildFencedTurn), but never emitted it for the operator to SEE — so the window
// showed a reply and tool activity with no visible question. Returns the render payload the
// engine emits once at session start, or null when there is nothing fresh to show: a resumed
// or parked shell has no firstMessage and its D3 channel history already carries the ask.
// DISPLAY ONLY — the caller emits it, never pushes it to the SDK iterator, so the agent input
// is byte-identical. `from` is the BOUND counterparty name for a responder (never a third
// party); a requester shows its own goal, so it needs no peer name (the renderer shows "You").
// The text is the RAW UNFENCED body — never the nonce fences or OUR framing lines.
function initialRequestPayload(side, firstMessage, counterpartyName) {
  if (typeof firstMessage !== 'string' || !firstMessage.trim()) return null;
  const responder = side === 'responder';
  return {
    type: 'request',
    side: responder ? 'responder' : 'requester',
    from: responder ? (counterpartyName || null) : null,
    text: firstMessage,
  };
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
    // v1.7.5 D1: the HEADER IDENTITY, sourced from s.context/spec at startSession.
    // A parked record is the only thing a P2 recreate (or a post-restart resume) has
    // to rebuild the window from, so without these the reopened header lost the peer
    // name, the channel, and the task title and fell back to a bare "Session".
    counterpartyName: s.counterpartyName || null,
    channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null,
    // FIX #9: the running cap counters, so a P2 recreate rehydrates the budget of a
    // turn/cost-capped (or parked) session instead of resetting it to a fresh one.
    turns: s.state.turns,
    costUsd: s.state.costUsd,
  };
}

// The canUseTool bridge. Profile pre-approved reads are shadowed by allowedTools and
// never reach here; the tools that DO reach here are the live-gated work tools plus
// `dopl_channel` (FIX H1 removed it from allowedTools so it is no longer blanket
// shadowed). It consults the OP-SCOPED grantDecision FIRST, passing the tool INPUT
// and the session's OWN channelId:
//   'preapproved' — a profile-shadowed read -> auto-allow, NO button. v2.5 D2: an
//                   own-channel post no longer lands here; it GATES like every write.
//   'allow'       — granted for the whole task (engine Set) -> auto-allow, NO button.
//   'deny'        — hard-denied by the profile (§H2 SESSION_HARD_DENY / a restricted
//                   profile) -> refuse WITHOUT a button (belt: disallowedTools should
//                   already have blocked it before the SDK ever calls us).
//   'gate'        — PAUSE on an awaited operator button.
// Only the gate branch stashes a resolver on the session for resolvePermission.
// `log` is injected (session-engine passes diag) so this module stays electron-free.
function makeCanUseTool(s, dispatch, log) {
  return function canUseTool(name, input, opts) {
    // v2.9: BOTH axes resolve inside grantDecision — there is no post-decision override
    // here any more. The old item-10 `gate && autoApprove -> allow` line is gone: it was a
    // second decision point that knew nothing about which axis a call belonged to, which
    // is exactly how one switch came to authorize both Bash and outbound messages.
    const decision = grantDecision(grantArgs(s, name, input));
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
      // the bottom dock. The POLICY path is untouched: the same `permission_request`
      // reducer event, the same pendingPermissions tracking (so a park still deny-closes
      // it fail-closed and the auto-approve drain still resolves it), the same scoped
      // grantName (POST_GRANT), the same fail-closed permission_decision mapping. ONLY the
      // renderer PAYLOAD differs — `outbound_gate` hands the already-painted pending card
      // its requestId, so the card answers for ITSELF and the dock is left free to surface
      // the next NON-post request instead of sitting blank behind a post.
      // Every other tool (Bash / Write / WebFetch / a CROSS-channel post, which is the
      // exfil shape FIX #9 marks) keeps the dock payload below, unchanged.
      // FIX F4: the gate also carries the AUTHORIZED BYTES — the body this canUseTool call is
      // holding, plus the destination name — so the card's surface is sourced from the tool
      // input the decision actually covers instead of the separately streamed copy the
      // reducer painted. It doubles as the RE-CREATE path (FIX F5): a gate whose stream-time
      // artifact never landed still paints a card, so a post can never gate invisibly. `to`
      // is a display NAME and ownChannel a boolean — never another channel's id (§H-9).
      const payload = isOutboundPost(name, input, s.channelId)
        ? withPostSurface({
          type: 'outbound_gate',
          requestId,
          toolUseId: opts && opts.toolUseID,
          ownChannel: true, ...(s.direct === true ? { directChannel: true } : {}), // H2: in a DM the server addresses this post, so the card names who gets it
          text: input && input.body != null ? String(input.body) : '',
        }, input, s.counterpartyName)
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
      dispatch(s, { type: 'permission_request', requestId, name: grantName, payload });
    });
  };
}

// Map ONE raw SDK message onto reducer events (the "event mapping" half of the
// pre-authorized split). system/init captures the sdkSessionId + persists the
// record then dispatches `launched`; assistant/user become render events; result
// hands the reducer a per-turn cost DELTA (total_cost_usd is cumulative). Unknown
// message types are ignored. `dispatch` + `store` are injected so this stays
// electron/SDK-handle-free.
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
    for (const ev of sdkRenderEvents(msg, s.channelId, s.counterpartyName, willGate)) dispatch(s, ev);
    return;
  }
  if (msg.type === 'result') {
    const total = Number(msg.total_cost_usd) || 0;
    const turnCost = Math.max(0, total - (s.lastTotalCost || 0));
    s.lastTotalCost = total;
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
  historyTranscript: seed.historyTranscript, // v2.5 D3 (the lazy seed — FIX F1)
  noteGatedBody: seed.noteGatedBody, // FIX F1: a gated message never rides the seed as well
  isGatedEntry: seed.isGatedEntry, // FIX F4: session-history drops those rows from the ENTRIES too
  withSeed: seed.withSeed,
  postWillGate, // v2.7 L3: does an own-channel post stop on an operator decision?
  grantArgs, // v2.9: the ONE argument builder both the prediction and the gate use
  postAddress, // MEDIUM-2: the call's REAL addressee (null when unaddressed)
  postKindOf, // MEDIUM-2: the lifecycle kind it claims (null for a plain message)
  withPostSurface,
  summarizeInput,
  safeInput,
  summarizeResult,
  initialRequestPayload, // FIX (v2.x): the initiating request as a display-only stream item
  isOutboundPost,
  sdkRenderEvents,
  baseRecord,
  makeCanUseTool,
  handleSdkMessage,
};
