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
// THREE THINGS LEFT ON 2026-08-31 (runtime-adapter port, step 3/4). `sdkRenderEvents` and
// `handleSdkMessage` — the two functions that read a platform's own message schema — are the
// ADAPTER's (`main/runtime/claude/normalize.js`), which is what lets a later runtime be tested from
// a recorded transcript with nothing installed. `makeCanUseTool` SPLIT: the verdict plumbing, the
// diag line, the card payloads and the resolver parking went to `main/session-gate-bridge.js`; only
// the held-callback wiring and the platform's reply vocabulary are the adapter's. What replaces all
// three here is `applyCoreEvents`, which owns the bookkeeping none of them could give away.

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
// F-692: the PURE read of the init message's `mcp_servers` list. ⚠ `mcp-connect.js` has no
// electron/fs require, which is what lets this file keep the property a dozen suites rely on
// (`session-outbound-tag.test.mjs` pins it: `diag` requires electron; this file must not).
const mcpConnect = require('./mcp-connect');
// 2026-09-21 (U10): WHAT THIS CONVERSATION WAS RUNNING AS — the effective model, the native
// policy summary and this runtime's usage-baseline semantics, projected off the session's OWN
// descriptor. ⚠ Both modules require nothing that pulls electron (`main/runtime/index.js` is
// electron-free by contract and `session-runtime-truth.js` requires nothing at all), so the
// property `session-outbound-tag.test.mjs` pins about this file is unchanged.
const runtimeRegistry = require('./runtime');
const runtimeTruth = require('./session-runtime-truth');

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

// A push-based AsyncIterable<SDKUserMessage>: the SDK consumes it as the live prompt; the engine
// `push()`es the first framed turn, steer text, and fed inbound replies (research §6). `close()`
// ends the stream so a `for await` completes.
//
// It REMEMBERS WHAT IT HANDED OUT since 2026-09-14 (F-696) — `replayable()`. An iterator is minted
// PER LAUNCH, so what it has carried is exactly this launch's input. A launch can be SUPERSEDED
// after the child has already drained the queue (`mcp-connect-guard.js` kills a launch whose Dopl
// MCP server did not connect): the cold path re-pushes `s.firstTurn` for itself, but the RESUME
// path has nothing to re-push, so without this the retry starts a resumed conversation with NO
// input and the peer waits forever. BOUNDED at `REPLAY_MAX`, oldest dropped — it is not a
// transcript and must never become one.
const REPLAY_MAX = 8;
function makePushIterator() {
  const queue = [];
  const handed = []; // what has LEFT this iterator, oldest first — see replayable()
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
    /**
     * EVERYTHING THIS ITERATOR WAS GIVEN, in order — delivered AND still queued.
     * ⚠ IT IS THE INPUT, NOT THE OUTPUT, so replaying it onto a fresh iterator re-states the
     * launch rather than the conversation. `close()` does not clear it: the whole point is to read
     * it off an iterator that is being torn down.
     */
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
    // AXIS A — never consulted for a dopl_channel call. FLOORED AT `auto` ON A WINDOWLESS SESSION
    // (2026-08-22, ruling 4; `session-profiles.js › floorWindowlessTool` carries the why). Applied
    // HERE because this is the one read covering every spawn shape, where Axis B's floor is written
    // into STATE at two lanes and a third spawn shape would need a third.
    //
    // It does NOT rewrite the reducer's stored `toolMode` — the deliberate opposite of the message
    // floor. That one clamps a value the operator PICKED; this one widens a value they may never
    // have touched (`manual` is Axis A's start value and its park reset), so writing it back would
    // make the agent view's Tools select report a posture NOBODY CHOSE. Conditioned on
    // `s.windowless`, never on the axis, so a windowed session is untouched.
    //
    // The floor is the RUNTIME's since 2026-08-31 (§0.1b): a mode that fail-closes to a vocabulary
    // the runtime does not speak denies EVERYTHING on a surface-less session. `s.runtimeId` is
    // absent on a pre-port record and resolves to the default runtime.
    //
    // Since 2026-09-16 the value it floors is read LIVE, not frozen (`session-private.js ›
    // effectiveToolMode`, the twin of the Axis-B read below, whose docblock carries the argument):
    // `st.toolMode` alone meant the operator's durable per-channel TOOLS pick reached a session only
    // through `spec.startModes` at spawn, so every shape that hands none gated at `manual` while the
    // Settings tab read `bypass`. The floor still applies AFTER the read and rewrites nothing back.
    toolMode: s && s.windowless === true
      ? floorWindowlessTool(sessionPrivate.effectiveToolMode(s), s.runtimeId)
      : sessionPrivate.effectiveToolMode(s),
    // WHICH RUNTIME'S VOCABULARY steps 1 and 4 of `grantDecision` are asked in. ⚠ IT DECIDES
    // NOTHING — the order, the verdicts and every Axis-B lane are the same on every runtime.
    runtime: (s && s.runtimeId) || null,
    // AXIS B, through `session-private.js` (2026-08-22): a PRIVATE 1:1 turn withdraws the OUT half,
    // so a post gates and bridges to a consent row instead of auto-sending. Since 2026-08-31 that
    // derivation reads the channel's own value LIVE and FIRST (Samuel's ruling).
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
    // ⚠ THE LAUNCH STAMPS, PERSISTED SINCE 2026-09-18 (Samuel's ruling), AND THIS REVERSES WHAT
    // THIS PROJECTION USED TO SAY. The omission was deliberate — *a recreate cannot verify what it
    // did not see* — and it was measured wrong once parked agents began surviving a restart
    // (7ecd3975 + 65c43e22): a record-driven REBUILD has nothing BUT this record, so an operator's
    // own orchestrator, launched at depth 0 from the New Agent button, woke after an app restart
    // with `launchDepth: undefined`, normalized to the cap, and was denied `launch-depth-capped`
    // for the rest of its life. A session now remembers what started it across a restart.
    // ⚠ A PLAIN COPY, FOR `model`'S REASON one screen down: this function is evaluated STANDALONE
    // by the extraction tests, so it may not ask `session-own-launch.js` anything. The coercion is
    // on the way OUT (`session-store.js › durableSessionRecord`) and the CAP is applied on the way
    // back in by the gate's own `normalizeLaunchDepth`, which stays the one statement of it.
    // ⚠ AND THE FAIL-CLOSED DIRECTION IS UNCHANGED: a record written before this change carries
    // NEITHER field, reads as absent, and is therefore still capped. Nothing migrates it — a
    // migration would have to GUESS a depth nobody recorded, which is the claim this lane refuses.
    launchDepth: s.launchDepth, launchChain: s.launchChain === true,
    mode: s.mode,
    phase: s.state.phase,
    startedAt: s.startedAt,
    counterpartyId: s.counterpartyId || null, direct: s.direct === true, bind: s.bind === 'room' ? 'room' : 'pair', agentId: s.agentId || null, // FIX L1: the other party; (H2) whether the server addresses posts for us; (D2) the binding mode + the agent this session runs as
    // v1.7.5 D1: the HEADER IDENTITY, sourced from s.context/spec at startSession. A parked record
    // is the only thing a P2 recreate (or a post-restart resume) has to rebuild the window from, so
    // without these the reopened header fell back to a bare "Session". ⚠ AND THE IDENTITY NAME
    // SINCE 2026-08-23 (F-288): without it a crash resume ERASED `channel_sessions.identity_name`.
    counterpartyName: s.counterpartyName || null, channelName: (s.context && s.context.channelName) || null,
    taskTitle: (s.context && s.context.taskTitle) || null, identityName: (s.context && s.context.identity && s.context.identity.name) || null,
    // FIX #9: the running cap counters, so a P2 recreate rehydrates a turn/cost-capped (or
    turns: s.state.turns, // parked) session's budget instead of resetting it to a fresh one.
    // 🔒 ⚠ **`costUsd` RODE HERE AND IS DELETED (2026-09-22, Samuel: *"we dont need cost
    // tracking"*).** `session-store.js › durableSessionRecord` is a whitelist, so a record written
    // by an older build still carries the key and simply drops it on read.
    // 2026-09-07: `turnCap` travelled here so a resumed session kept the bound its counters were
    // measured against. There is no bound now, so there is nothing to carry.
    // 2026-08-22: the OUTBOUND POST COUNTER, so a crash resume does not re-mint client_msg_ids the
    // server already stored under this instance's persisted agent id (`session-store.js ›
    // resumedPostSeq`). NOT reducer state: it lives on the session object.
    ownPostSeq: s.ownPostSeq,
    // 2026-08-02: the operator's MODEL pick, whitelisted so a P2 recreate or a crash resume comes
    // back on the model they chose — without it a recreate silently reverts to the CLI default while
    // the select still claims the pick. Coerced against the frozen enum on the way OUT
    // (session-store.durableSessionRecord) and again on the way back IN (startSession), so this
    // projection stays a plain copy with no dependency of its own.
    model: s.model || null,
    // 2026-08-31 (port wave D): WHICH RUNTIME drove this session, whitelisted for `model`'s reason
    // with a sharper consequence — `session-park.js › startResume` hands the persisted
    // `sdkSessionId` to the runtime it acquires, so a record that lost this would resume one
    // platform's conversation handle on another platform's adapter. `runtime/index.js › resolve`
    // turns an unknown id into the default, which is the runtime every pre-port record ran on.
    runtimeId: s.runtimeId || null,
    // ── 2026-09-21 (U10) — AND WHAT IT WAS RUNNING AS, beside WHICH ADAPTER ran it ───────────
    //
    // ⚠ `runtimeId` ALONE CANNOT ANSWER A RESUME'S REAL QUESTIONS. It says which adapter owns the
    // handle; it does not say which model actually answered (the operator's pick is usually "no
    // pick"), what native policy the spawn was made under, or — the one that decides something —
    // whether this runtime's cumulative usage RESETS on a resume, which is the bet
    // `session-park.js › resumeParked` makes when it zeroes both delta baselines. A record that
    // cannot state its own baseline is a record a later build re-interprets under a newer answer.
    // ⚠ THE DESCRIPTOR IS READ OFF `s.runtimeId`, THE SPAWN STAMP, AND NEVER RE-CHOSEN HERE
    // (INVARIANTS §11): an unknown id resolves to the default, which is the runtime such a session
    // really ran on. ⚠ PLAIN VALUES — coerced on the way OUT by `session-store.js › saveRecord`
    // through `session-runtime-truth.js › durableRuntimeTruth`, the division `model` above uses.
    ...runtimeTruth.runtimeTruthFields(runtimeRegistry.descriptorFor(s.runtimeId), s),
  };
}

// APPLY the CoreEvents one raw platform message produced — successor to `handleSdkMessage`
// (2026-08-31): the PARSING is the adapter's, the BOOKKEEPING is here, split on "what could a
// fixture test without a session". Returns the `auth_hold` event when the stream must stop being
// read, else `null`; the caller owns what stopping means.
//
// Nothing here reorders a stream. ⚠ This module may not require `diag.js` (electron): a dozen
// suites require it in plain Node (`session-outbound-tag.test.mjs` pins that).
function applyCoreEvents(s, list, dispatch, store) {
  // F-692: the MCP-connect signal this message produced, if any. ⚠ RETURNED AT THE END rather than
  // short-circuiting like `auth_hold`: the bookkeeping for `launched` (the conversation handle, the
  // durable record, the reducer's own `launched`) must all land FIRST, because the guard's retry
  // re-enters `startQuery` on this same session object and a half-applied launch is what it would
  // then be relaunching.
  let mcpSignal = null;
  for (const ev of list || []) {
    if (!ev || !ev.type) continue;
    if (ev.type === 'auth_hold') return ev;
    if (ev.type === 'context') {
      // The METER's raw reading, remembered rather than dispatched. ⚠ `tokens > 0` GUARDS THE
      // WRITE, not the event: a turn that measured nothing must keep the LAST real reading rather
      // than fall back to a zero, because a zero would paint an empty gauge over a full window.
      if (ev.tokens > 0) s.promptTokens = ev.tokens;
      // ⚠ THE DENOMINATOR THE RUNTIME REPORTED, UNDER THE SAME GUARD AND FOR THE SAME REASON
      // (2026-09-22). Codex states `tokenUsage.modelContextWindow` on every usage notification;
      // Claude and Cursor state nothing and leave this `undefined` forever, which is what keeps
      // them on `session-model.js › contextWindowFor`. ⚠ A READING THAT CARRIES NO WINDOW LEAVES
      // THE LAST ONE ALONE rather than blanking it — the numerator's rule exactly, and the
      // INVARIANTS one behind it: unknown is not empty, so "told me nothing this turn" must not
      // become "this session has no window".
      // ⚠ COERCED ON THE WAY IN, the same arithmetic `session-reducer.js`'s context branch uses,
      // so what is remembered is always a NUMBER — a string denominator stored here would reach
      // `contextEvent` and then a percentage untouched by anything that checks its type.
      const win = Number(ev.window);
      if (Number.isFinite(win) && win > 0) s.promptWindow = win;
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
      // THE CONNECT ASSERTION (F-692, 2026-09-13). This is the ONE message that states which MCP
      // servers the runtime really connected, and nothing read it: a `dopl` entry that ran out the
      // CLI's 5s connect budget left the session with `rename_agent` working and EVERY
      // `mcp__dopl__*` call answering "No such tool available", with `prompt-framing.js` telling the
      // agent never to report it. The WORD is read here (`mcp-connect.js` is pure); the ACT is
      // `mcp-connect-guard.js`'s, because killing a child needs handles this file may not hold.
      mcpSignal = { type: 'mcp_status', status: mcpConnect.doplStatus(ev.mcpServers) };
      continue;
    }
    if (ev.type === 'result') {
      // THE DELTA. The number arrives CUMULATIVE for the current run, so a resumed run restarts it
      // from zero and `session-park.js › resumeParked` zeroes the baseline to match. Summing
      // DELTAS is what makes the figure survive a park+resume. `Math.max(0, …)` is the clamp that
      // makes a platform which does NOT restart on resume fail SILENTLY — which is why
      // `descriptor.session.usageResetsOnResume` is launch-blocking rather than a footnote.
      // 🔒 ⚠ **THERE WERE TWO OF THESE UNTIL 2026-09-22** — an identical cost pair
      // (`ev.costUsd` / `s.lastTotalCost` / `turnCost`) ran beside the token one, with its own
      // baseline to carry across every resume and its own field in the durable record. Samuel
      // deleted the column (*"we dont need cost tracking"*); the TOKEN half is untouched, and it
      // is the half that has a reader — `tokensSpent` is on the agent card and on the wire.
      const tokenTotal = Number(ev.sessionTokens) || 0;
      s.tokensSpent = (s.tokensSpent || 0) + Math.max(0, tokenTotal - (s.lastTotalTokens || 0));
      s.lastTotalTokens = tokenTotal;
      // The turn count is the reducer's `state.turns`, persisted with the record (P4-10). The gauge
      // is read off the session by `session-metrics.js › metrics`; no meter event is dispatched (P4-11).
      dispatch(s, { type: 'result', model: ev.model });
      continue;
    }
    dispatch(s, ev); // every render event, unchanged
  }
  return mcpSignal; // F-692: `{type:'mcp_status', status}` after a `launched`, else null
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
  frameHistorySeed: seed.frameHistorySeed, // v2.5 D3
  historyTranscript: seed.historyTranscript, // the lazy seed, FIX F1
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
  isOutboundPost,
  baseRecord,
  applyCoreEvents, // 2026-08-31: successor to `handleSdkMessage` — the bookkeeping half
};
