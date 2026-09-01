// Session engine I/O helpers (v1.9 Session Window, Track T1).
//
// The push-based prompt iterator, the user-turn constructor, the CORE-EVENT application, the
// durable-record projection, and the tool-input/result summarizers (the untrusted-inbound
// continuation fence + the seed live in session-seed.js, re-exported at the bottom unchanged).
// Split out of session-engine.js so each stays under the 500-line §2 cap (contract §E). Every
// helper is PARAMETERIZED — it takes the session object plus `dispatch` / `store` and holds NO
// module-level mutable state and NO electron or platform handle, so the engine stays the only
// stateful, electron-bound module.
//
// ⚠ THREE THINGS LEFT ON 2026-08-31 (runtime-adapter port, step 3/4) AND THE FILE IS UNDER CAP
// AGAIN. `› sdkRenderEvents` and `› handleSdkMessage` — the two functions that read a platform's
// own message schema — are the ADAPTER's (`main/runtime/claude/normalize.js`), which is what lets
// a later runtime be tested from a recorded transcript with nothing installed. `› makeCanUseTool`
// SPLIT: the verdict plumbing, the diag line, the card payloads and the resolver parking are
// platform-free and went to `main/session-gate-bridge.js`; only the held-callback wiring and the
// platform's reply vocabulary are the adapter's. What replaces all three here is
// `› applyCoreEvents`, which owns the bookkeeping none of them could give away — the conversation
// handle, the durable record, the cost/token DELTAS and the meter's last reading.

const { grantDecisionDetail, floorWindowlessTool } = require('./session-profiles');
const { DOPL_CHANNEL_TOOL } = require('./tool-profiles');
// The own-channel-post classifier (`isOutboundPost`) and the FORCED thread tag live in
// session-outbound-tag.js (§2 cap). Re-exported below, no caller moved.
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

// I-LOW(a): a bounded FIFO of pending inbound counterparty replies, on the session object
// (`s.pendingInbound`, an array). INTERACTIVE mode releases them one at a time, so a second
// reply landing before the first is released must NOT overwrite it (the old single-slot field
// dropped it); only the HEAD is surfaced, the rest wait. AUTONOMOUS mode pushes each reply
// straight to the SDK, so nothing is ever held here.
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
    input: input, workspaceId: s.workspaceId, audience: s.audience || null, // B2's belt (plan §4.4): the audience is STAMPED AT SPAWN by session-credential.js, off the roster this machine already reads, and is null for every unlocked session
    channelId: s.channelId, launchDepth: s.launchDepth, launchChain: s.launchChain === true, // ...and F-320's RECURSION BOUND, stamped at spawn: ABSENT READS AS THE CAP (session-own-launch.js), so no lane opens it by forgetting to pass one. `launchChain` is the channel's chaining SETTING (2026-08-31), stamped at spawn beside it and read `=== true` so absent keeps the bound — it is not read LIVE, deliberately: the 2026-08-25 live-apply ruling widens SUPERVISION, never CONTAINMENT
    allowForTask: st.allowForTask || [],
    // AXIS A — never consulted for a dopl_channel call. ⚠ FLOORED AT `auto` ON A WINDOWLESS
    // SESSION (2026-08-22, ruling 4; the rule is `session-profiles.js › floorWindowlessTool`,
    // which carries the why). ⚠ APPLIED HERE BECAUSE THIS IS THE ONE READ COVERING EVERY SPAWN
    // SHAPE: Axis B's floor is written into STATE at two lanes (`channel-prefs.js ›
    // windowlessMessageMode` at launch, `session-reopen.js › setModeByTask` live) and a third
    // spawn shape would need a third, while this is the single read of both axes at decision
    // time. ⚠ IT DOES NOT REWRITE THE REDUCER'S STORED `toolMode` — the deliberate opposite of
    // the message floor. That one clamps a value the operator PICKED, so a select left ahead of
    // the engine would lie about their choice; this one widens a value they may never have
    // touched (`manual` is Axis A's start value AND its park reset), so writing it back would
    // make the agent view's Tools select report a posture NOBODY CHOSE. The honest trade: the
    // select keeps showing what was set, the gate applies what a surface-less session can
    // enforce. ⚠ Conditioned on `s.windowless` (stamped by `session-windowless.js ›
    // attachSurface`), never on the axis — a hypothetical WINDOWED session is untouched.
    // ⚠ THE FLOOR IS THE RUNTIME'S SINCE 2026-08-31 (§0.1b): a mode that fail-closes to a
    // vocabulary the runtime does not speak denies EVERYTHING on a surface-less session, so the
    // floor is declared per runtime and applied here. `s.runtimeId` is absent on a session record
    // written before this wave and resolves to the default runtime, which is what shipped.
    toolMode: s && s.windowless === true ? floorWindowlessTool(st.toolMode, s.runtimeId) : st.toolMode,
    // WHICH RUNTIME'S VOCABULARY steps 1 and 4 of `grantDecision` are asked in. ⚠ IT DECIDES
    // NOTHING — the order, the verdicts and every Axis-B lane are the same on every runtime.
    runtime: (s && s.runtimeId) || null,
    // AXIS B. ⚠ Through `session-private.js` (2026-08-22): a PRIVATE 1:1 turn withdraws the OUT
    // half, so a post gates and bridges to a consent row instead of auto-sending. ⚠ AND SINCE
    // 2026-08-31 that derivation reads the channel's AUTO-SEND toggle LIVE and FIRST (Samuel's
    // ruling) — ON forces the OUT half open on every turn shape, private included.
    messageMode: sessionPrivate.effectiveMessageMode(s)
  };
}

// v2.7 L3 — WILL this own-channel post stop on an operator decision? It asks the SAME decision
// the gate bridge asks, with the SAME arguments, so the stream-time artifact and the gate agree
// about the SAME post: one that gates paints as the inline decision card (`pending`), one that is
// auto-approved paints as the delivered record. It DECIDES nothing. FIX F3: the real tool NAME is
// threaded through — grant keys are per tool name, so asking about `dopl_channel` for a
// `dopl_channel_v2` call would claim "sent" over a held post.
function postWillGate(s, input, toolName) {
  return grantDecisionDetail(grantArgs(s, toolName || DOPL_CHANNEL_TOOL, input)).decision === 'gate';
}

// ─── THE POST SURFACE MOVED OUT (§2 split, 2026-08-06) ────────────────────────
// `TO_CAP` / `KIND_CAP` / `oneLineField` / `postAddress` / `postKindOf` / `withPostSurface` live
// in `main/session-post-surface.js` — this file was AT the 500-line cap with zero headroom, and
// threading the counterparty id through `withPostSurface` (so `to` is a display NAME, not the raw
// id an agent typed) pushed it over. RE-EXPORTED BELOW, so every `io.<name>` caller is unchanged.
const sessionPrivate = require('./session-private'); const postSurface = require('./session-post-surface'); const { denyMessageFor } = require('./session-permissions'); // the 1:1 gate; the post surface; which sentence a `deny` verdict carries (F-320)
const { withPostSurface, postKindOf } = postSurface;

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
    // v1.7.5 D1: the HEADER IDENTITY, sourced from s.context/spec at startSession. A parked record
    // is the only thing a P2 recreate (or a post-restart resume) has to rebuild the window from, so
    // without these the reopened header fell back to a bare "Session". ⚠ AND THE TEMPLATE NAME
    // SINCE 2026-08-23 (F-288): without it a crash resume ERASED `channel_sessions.template_name`.
    counterpartyName: s.counterpartyName || null, channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null, templateName: (s.context && s.context.template && s.context.template.name) || null,
    // FIX #9: the running cap counters, so a P2 recreate rehydrates a turn/cost-capped (or
    turns: s.state.turns, // parked) session's budget instead of resetting it to a fresh one.
    costUsd: s.state.costUsd,
    // 2026-08-22: the OUTBOUND POST COUNTER, so a crash resume does not re-mint client_msg_ids the
    // server already stored under this instance's (persisted, re-used) agent id — `session-store.js
    // › resumedPostSeq`. NOT reducer state: it lives on the session object, bumped by
    // `session-outbound-tag.js › nextOwnPostId`.
    ownPostSeq: s.ownPostSeq,
    // 2026-08-02: the operator's MODEL pick, whitelisted so a P2 recreate or a crash resume comes
    // back on the model they chose — without it a recreate silently reverts to the CLI default
    // while the third select still claims the pick, the exact defect class the durable-whitelist
    // discipline exists to kill. Coerced against the frozen enum on the way OUT
    // (session-store.durableSessionRecord) and again on the way back IN (startSession), so this
    // projection stays a plain copy with no dependency of its own.
    model: s.model || null,
    // 2026-08-31 (port wave D): WHICH RUNTIME drove this session. Whitelisted for the same reason
    // `model` above is and with a sharper consequence — `session-park.js › startResume` hands the
    // persisted `sdkSessionId` to the runtime it acquires, so a record that lost this would resume
    // one platform's conversation handle on another platform's adapter. `session-store.js ›
    // durableSessionRecord` bounds the value; `runtime/index.js › resolve` turns an unknown id
    // into the default, which is the runtime every pre-port record actually ran on.
    runtimeId: s.runtimeId || null,
  };
}

// APPLY the CoreEvents one raw platform message produced. ⚠ SUCCESSOR TO `› handleSdkMessage`
// (2026-08-31): the PARSING is the adapter's, the BOOKKEEPING is here, and the split is exactly
// "what could a fixture test without a session". Returns the `auth_hold` event when the stream
// must stop being read, and `null` otherwise; the caller owns what stopping means, and gets the
// runtime's own sentence rather than re-deriving it.
//
// ⚠ ORDER IS PRESERVED AND IT IS OBSERVABLE. `result` dispatches BEFORE the turn's `context`,
// because that is the order the two consumers ran in and the reducer's cap checks read the cost
// on the `result`. Nothing here reorders a stream.
// ⚠ `log` IS INJECTED, NOT REQUIRED, AND THAT IS THIS FILE'S STANDING RULE RATHER THAN a new one.
// `diag.js` requires electron at its top and this module must not — `session-outbound-tag.test.mjs`
// pins exactly that (`diag requires electron; this file must not`), because a dozen suites require
// this file in plain Node. The precedent is `session-gate-bridge.js › makeCanUseTool(s, dispatch,
// log)`, whose `log` the adapter's option assembly supplies; the consume loop supplies this one.
// ⚠ OPTIONAL BY CONTRACT: a caller that passes nothing loses the LINE, never the SWALLOW. The
// try/catch below is the behaviour; the log is how you find out it fired.
function applyCoreEvents(s, list, dispatch, store, log) {
  for (const ev of list || []) {
    if (!ev || !ev.type) continue;
    if (ev.type === 'auth_hold') return ev;
    if (ev.type === 'context') {
      // The METER's raw reading, remembered rather than dispatched. ⚠ `tokens > 0` GUARDS THE
      // WRITE, not the event: a turn that measured nothing must keep the LAST real reading rather
      // than fall back to a zero, because a zero would paint an empty gauge over a full window.
      if (ev.tokens > 0) s.promptTokens = ev.tokens;
      if (ev.model) s.liveModel = ev.model; // a mid-session model switch
      continue;
    }
    if (ev.type === 'launched') {
      s.sdkSessionId = ev.sessionId;
      // ⚠ THE CONVERSATION HANDLE IS PERSISTED BEFORE THE REDUCER IS TOLD. It is the only thing a
      // resume has, so a crash between the two must leave the id recoverable, never the phase.
      store.setSdkSessionId(s.key, ev.sessionId);
      store.saveRecord(baseRecord(s));
      if (ev.model) s.liveModel = ev.model; // the first honest statement of what is really running
      dispatch(s, { type: 'launched', payload: launchedPayload(s, ev.model) });
      continue;
    }
    if (ev.type === 'result') {
      // THE DELTAS. ⚠ Both numbers arrive CUMULATIVE for the current run, so a resumed run
      // restarts them from zero and `session-park.js › resumeParked` zeroes the baselines to
      // match. Summing DELTAS is what makes the figures survive a park+resume; the raw totals
      // would collapse. ⚠ `Math.max(0, …)` is the clamp that makes a platform which does NOT
      // restart on resume fail SILENTLY — which is why `descriptor.session.usageResetsOnResume`
      // is launch-blocking rather than a footnote.
      const total = Number(ev.costUsd) || 0;
      const turnCost = Math.max(0, total - (s.lastTotalCost || 0));
      s.lastTotalCost = total;
      const tokenTotal = Number(ev.sessionTokens) || 0;
      s.tokensSpent = (s.tokensSpent || 0) + Math.max(0, tokenTotal - (s.lastTotalTokens || 0));
      s.lastTotalTokens = tokenTotal;
      dispatch(s, { type: 'result', turnCostUsd: turnCost, model: ev.model });
      // ⚠ AFTER the result, and only when something was measured: say nothing rather than paint a
      // zero (`session-model.js › contextEvent`).
      const context = sessionModel.contextEvent(s.promptTokens, s.liveModel);
      // ⚠ THE METER MAY NOT KILL THE SESSION, AND THIS `try/catch` IS THE WHOLE OF THAT RULE.
      // It came over from `session-model.js › observe` with the dispatch it wraps and was LOST in
      // the port (restored 2026-09-01, D7.3). The context event is a GAUGE READING — the last
      // assistant message's prompt tokens over a window denominator — and it is dispatched from
      // inside the consume loop's `for await`. A throw here therefore does not fail the meter, it
      // escapes to `session-query.js › consume`'s catch, which reads it as a query error and
      // dispatches `crash` -> settle + destroy + `task_failed{interrupted}`. So a reducer bug on a
      // COSMETIC row would tear down a session mid-turn and report it to the peer as an
      // interruption. HEAD swallowed it to one diag line and kept the stream alive; that is the
      // correct trade and the line is kept VERBATIM (`session-model:` prefix included) so the
      // existing `listener.log` grep still finds it.
      // ⚠ SWALLOWED, NOT RETHROWN, AND ONLY HERE. Every other dispatch in this loop is a state
      // transition the session's correctness depends on — those must still reach `crash`.
      if (context) {
        try {
          dispatch(s, context);
        } catch (err) {
          if (typeof log === 'function') log('session-model: context dispatch failed', err && err.message);
        }
      }
      continue;
    }
    dispatch(s, ev); // every render event, unchanged
  }
  return null;
}

// The `launched` payload. Split out only so `applyCoreEvents` stays a routing shape; every field
// is the one `handleSdkMessage` sent.
function launchedPayload(s, model) {
  return {
    type: 'init',
    sessionId: s.sessionId,
    side: s.side,
    profile: s.profile,
    mode: s.mode,
    model: model,
    profileLabel: s.profileLabel || null, // item 9: human posture label (§B.2)
    channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null,
    from: s.counterpartyName || null,
    // Item 1/5/6 (§B.1): bounded data: URIs (or null) — the operator's photo for my-agent/
    // operator/outbound bubbles, the peer's for counterparty bubbles + the header. Warm here
    // when the cache is hot; else null + a follow-up `avatars` event from
    // avatar-cache.resolveForSession. NEVER a remote URL.
    selfAvatar: s.selfAvatar || null,
    fromAvatar: s.peerAvatar || null,
    // NEVER the platform's absolute cwd (label-only rule) — emitFolder() feeds the chip its label.
    cwdLabel: null,
  };
}

module.exports = {
  makePushIterator,
  userMessage,
  queueInbound,
  shiftInbound,
  // ── re-exported VERBATIM from session-seed.js (the §2 split) ────────────────
  frameContinuation: seed.frameContinuation,
  frameHistorySeed: seed.frameHistorySeed, // v2.5 D3 (initialRequestPayload is re-exported below,
  historyTranscript: seed.historyTranscript, // beside the display-only helpers) — the lazy seed, FIX F1
  noteGatedBody: seed.noteGatedBody, // FIX F1: a gated message never rides the seed as well
  // FIX F4: session-history dropped those rows from the ENTRIES too; that renderer is deleted,
  isGatedEntry: seed.isGatedEntry, // and the SEED still filters them — the half that mattered.
  withSeed: seed.withSeed,
  frameOperatorTurn: seed.frameOperatorTurn, // 2026-08-20: the direct 1:1 lane (F-212)
  postWillGate, // v2.7 L3: does an own-channel post stop on an operator decision?
  grantArgs, // v2.9: the ONE argument builder both the prediction and the gate use
  // §2 SPLIT (2026-08-06): these three moved to session-post-surface.js, RE-EXPORTED unchanged.
  postAddress: postSurface.postAddress, // MEDIUM-2: the call's REAL addressee (null when unaddressed)
  postKindOf, // MEDIUM-2: the lifecycle kind it claims (null for a plain message)
  withPostSurface,
  // ⚠ HOW MUCH OF A TOOL INPUT MAY APPEAR ON A CARD IS A PRIVACY RULE, not formatting, so all
  // three summarizers stay here and both the gate bridge and the adapter's normalizer ask for
  // them rather than growing their own bound.
  summarizeInput,
  safeInput,
  summarizeResult,
  initialRequestPayload: seed.initialRequestPayload, // the initiating ask, display-only (§2 split)
  isOutboundPost,
  baseRecord,
  applyCoreEvents, // 2026-08-31: successor to `handleSdkMessage` — the bookkeeping half
};
