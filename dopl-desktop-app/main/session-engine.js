// Session engine — the imperative shell.
//
// Owns ONE Claude Agent SDK query() per live session and executes the pure session-reducer's
// side-effect-free effect descriptors.
//
// ⚠ THREE THINGS THIS HEADER USED TO DESCRIBE ARE DELETED (2026-08-20, F-228): the CONSENT
// REFLOW (a pre-consent window running no agent work until Accept, then ADOPTED by
// launchResponderSession), REOPEN (live windows hide-on-close + tray reopen, with
// render-process-gone as the crash signal), and the renderer->main IPC that lived in
// session-ipc.js. Every session is WINDOWLESS; `s.win` is null and every emit no-ops on it.
// SEAM: this file imports NO electron at all — that was true when an injected factory created
// windows and is trivially true now. SECURITY: settingSources:[] always, so the
// global allow-list can never shadow a gated tool; the dopl bearer stays in the in-memory mcpServers
// object (never logged, never on argv, never on disk since C1).

const crypto = require('crypto');
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const avatarCache = require('./avatar-cache');
const sessionReopen = require('./session-reopen');
const sessionSummary = require('./session-summary'); // §3.3: THE session-pill projection
const sessionPark = require('./session-park');
const framing = require('./prompt-framing');
// `session-close-task.js` was required here (the `closeTask` effect) and is DELETED — threads
// do not close (wiring plan Phase 4, 2026-08-18). The §2 split's point stands: no HTTP dep here.
const sessionAuth = require('./session-auth'); // Q6 preflight + in-window sign-in
const { initialSessionState, sessionReducer, idleTimeout } = require('./session-reducer');
const { getSdk } = require('./sdk-loader');
const sessionQuery = require('./session-query'); const { buildSdkOptions, startQuery, consume } = sessionQuery; // §3 split: SDK options + the query lifecycle (H1)
const sessionNarration = require('./session-narration'); // 2026-08-20: the agent window's work lane (F-212)
const sessionModel = require('./session-model'); // the frozen model enum (argv), coerced here too
const sessionGate = require('./session-gate'); // v2.5 D1: the inbound message gate
const sessionWindowless = require('./session-windowless'); // §2 split: the windowless spawn shape

// settings.js owns the window-mode switch + caps; required defensively so the engine still
// loads if it is momentarily absent (unit/E2E harnessing), defaulting to ON.
let settings = null;
try { settings = require('./settings'); } catch (_) { /* absent -> defaults (window-mode ON) */ }

const sessions = new Map(); // sessionKey -> live session object (in-memory only)
let lifecycle = { onLaunched: null, onEnded: null };
let selfUserId = null; // operator's own user id (item 1: the self avatar); set by channel-listener
function setSelfIdentity(id) { selfUserId = id || null; }

function readCaps() {
  return settings ? { turnCap: settings.getTurnCap(), idleMs: settings.getIdleTtlMs(), costCapUsd: settings.getCostCapUsd() } : {};
}

// Rebuild the tray after a session is hidden / reopened / settled. Lazy-required so the engine holds no top-level tray dependency (tray requires nothing back).
function refreshTray() { try { require('./tray').refresh(); } catch (_) { /* tray optional */ } }

// Resume machinery (session-park.js) is fed the engine handles it can't require: the registry, SDK loader, buildSdkOptions (the v1.9 security path, NEVER duplicated), plus consume/dispatch/startSession. Hoisted, so bind order does not matter.
// ⚠ FOUR HANDLES LEFT WITH THE SHELL-RECREATE FAMILY (2026-08-20, F-228): `windowFactoryReady`,
// `atWindowCap`, `loadHistory` and `settleSession` all existed for a lane that opened a window,
// and `resolveChannelContext` fed the record-less shell alone.
sessionPark.bind({
  sessions, getSdk, buildSdkOptions, consume, dispatch, startSession, hasLiveSession,
  emit,
});
// §3 split: session-query owns the option assembly + the consume loop, but needs the engine's
// dispatch and the replay-aware quiet emit (neither module requires back into the engine).
sessionQuery.bind({ dispatch, emitQuiet, scheduleIdle }); // C-4: startQuery arms the launch watchdog through the ONE timer
// Q6: same injection for the preflight + in-window sign-in. `startQuery` is the SHARED deferred
// launch (session-query), so an auth hold never assembles a second query and inherits H1's
// supersede-before-relaunch; `denyPending` fail-closes before it parks.
sessionAuth.bind({ sessions, getSdk, startQuery, dispatch, emit, denyPending: denyPendingPermissions });
// v2.5 D1/D3: same for the inbound gate + history loader (neither imports back into the engine).
sessionGate.bind({ sessions, dispatch });
// Reopen helpers (session-reopen.js): live registry + tray refresh + the P2 shell fallback (item 2).
sessionReopen.bind({ sessions, refreshTray, dispatch, openAgentWindow: (t) => require('./agent-window').openAgentWindow(t) }); // C-8: quit ends live sessions through the reducer; 2026-08-20: a live session's VIEW is the agent window
// §3.3: the pill projection reads the SAME registry (it derives, it never mutates); index.js arms its push.
sessionSummary.bind({ sessions }); sessionNarration.bind({ sessions }); // ...and the narration ring reads the same registry

const baseRecord = io.baseRecord; // durable-record projection (session-io.js)

// FIX F1 (v2.7): dispatch REPORTS whether an effect resolved a LIVE canUseTool promise (only
// resolvePerm knows; a park's denyPending may have fail-closed the requestId already). ⚠ session-ipc is deleted; it
// turns that into the {ok} the renderer's optimistic stamp is gated on; other callers ignore it.
function dispatch(s, event) {
  const { state, effects } = sessionReducer(s.state, event);
  s.state = state; sessionSummary.noteActivity(s, event); sessionNarration.note(s, event); // §3.3: the pill's state + detail, and the agent window's work lane, all off the ONE funnel
  let resolvedLive = false;
  for (const eff of effects) resolvedLive = runEffect(s, eff) === true || resolvedLive;
  return resolvedLive;
}

function runEffect(s, eff) {
  switch (eff.type) {
    case 'emit': emit(s, eff.payload); break;
    // FIX #9: a park saves the FULL record (cap counters); other flips set the phase only. The EFFECT's
    // phase is authoritative — s.state.phase reads 'awaiting_inbound' when a park lands with a message
    // still held (FIX #6), which would look LIVE on the next boot.
    case 'persist':
      if (eff.phase === 'parked') store.saveRecord({ ...baseRecord(s), phase: eff.phase });
      else store.setRecordPhase(s.key, eff.phase);
      break;
    case 'scheduleIdle': scheduleIdle(s); break;
    // FIX F1: the ONLY effect with a return value — did a live resolver really take it?
    case 'resolvePermission':
      return resolvePerm(s, eff.requestId, eff.decision);
    // io.withSeed gives the FIRST turn of a fresh (nothing-to-resume) shell its full framing plus the D3 history seed, once; a normal turn passes through.
    case 'pushTurn':
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, eff.text), eff.priority === 'now' ? 'now' : undefined));
      break;
    case 'pushInbound':
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, io.frameContinuation(s.nonce, eff.message, eff.authorName))));
      break;
    case 'interruptQuery':
      try { if (s.query && s.query.interrupt) s.query.interrupt().catch(() => {}); } catch (_) { /* best effort */ }
      break;
    case 'abortQuery':
      try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
      try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
      break;
    case 'denyPending': // P1: DENY every awaited canUseTool promise (fail closed) before a
      denyPendingPermissions(s, 'Session paused'); // park's abort — no resolver may dangle
      break;
    case 'clearIdle': if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; } break;
    case 'resumeQuery': sessionPark.resumeParked(s); break; // P1 lazy resume: the SAME object
    case 'lifecycle': runLifecycle(s, eff.kind, eff.extra, eff.body); break;
    case 'settle': settle(s, eff.outcome, eff.keepWindow === true); break; // a `closeTask` case sat above this one until Phase 4 (2026-08-18)
    default: diag('session-engine: unknown effect', eff && eff.type);
  }
}

// Fail-close EVERY awaited canUseTool promise and drop the bookkeeping. A park runs this before its
// abort (P1) so no resolver dangles on a resumable session; settle runs it (C3) — a settled session
// will never answer a button again.
function denyPendingPermissions(s, message) {
  for (const resolve of s.pendingPermissions.values()) {
    try { resolve({ behavior: 'deny', message: message || 'Session paused' }); } catch (_) { /* best effort */ }
  }
  s.pendingPermissions.clear();
  s.pendingNames.clear();
}

// A hidden window RESHOWS on anything that needs the operator: a gated tool request, a
// `counterparty` reply, a HELD inbound, or an outbound post awaiting Send (v2.7 L3).
const RESHOW_TYPES = new Set(['permission_request', 'counterparty', 'inbound_pending', 'outbound_gate']);
function emit(s, payload) {
  // 2026-08-20: a WINDOWLESS session's pending gate bridges to a consent row (outbound post) or denies — session-windowless.js owns the policy.
  if (sessionWindowless.claimGate(s, payload, (rid, d) => dispatch(s, { type: 'permission_decision', requestId: rid, decision: d }))) return;
  if (!s.win || s.win.isDestroyed()) return;
  if (s.windowHidden && payload && RESHOW_TYPES.has(payload.type)) {
    try { s.win.show(); } catch (_) { /* best effort */ }
    s.windowHidden = false;
    refreshTray();
  }
  emitQuiet(s, payload);
}

// The same delivery WITHOUT the reshow check (C6): an auto-allowed post resolves its own card with
// no operator involvement, so it must never pop a hidden window open.
function emitQuiet(s, payload) {
  if (!s.win || s.win.isDestroyed()) return;
  s.replay.deliver(payload);
}
function scheduleIdle(s) {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  const t = idleTimeout(s.state); // M2: {ms,type} — a PARKED session waits on the abandonment bound
  s.idleTimer = setTimeout(() => { if (!s.settled) dispatch(s, { type: t.type }); }, t.ms);
}

// Returns TRUE only when a live awaited resolver was actually taken (FIX F1): no resolver means the request is
// already decided (a park deny-closed it) and the caller must NOT report success — a renderer believing a blanket {ok:true} stamped a DENIED post 'sent'.
function resolvePerm(s, requestId, decision) {
  const resolve = s.pendingPermissions.get(requestId);
  if (!resolve) return false;
  s.pendingPermissions.delete(requestId);
  s.pendingNames.delete(requestId);
  // FIX M1: FAIL CLOSED. ALLOW only on an explicit 'allow' (the reducer maps allow-once/allow-task
  // -> 'allow'); anything else, unknown included, denies.
  resolve(decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied by operator' });
  return true;
}

function runLifecycle(s, kind, extra, body) {
  const info = { channelId: s.channelId, taskId: s.taskId, workspaceId: s.workspaceId, side: s.side, sessionId: s.sessionId, key: s.key, sdkSessionId: s.sdkSessionId }; // FIX #2: key+sdkSessionId (cycle) -> echoTargets dedup
  try {
    if (kind === 'task_started') {
      if (lifecycle.onLaunched) lifecycle.onLaunched(info);
    } else if (lifecycle.onEnded) {
      // P3: `body` is the calm one-liner a capped/ended lifecycle carries (undefined -> the handler derives one).
      lifecycle.onEnded(info, kind, extra || {}, body);
    }
  } catch (err) { diag('session-engine: lifecycle handler error', err && err.message); }
}

// The lifecycle echo lives here; its sibling, session-close-task.js's status flip, is deleted
// with thread closing (Phase 4, 2026-08-18). Terminal: drop the live handles, mark the record ended, DESTROY the window (item 10 hid it), free the slot. A DONE task drops the resume entry; every other end KEEPS the sdkSessionId (FIX #7).
// `keepWindow` — the abandonment case alone; the argument is at session-effects.endEffects.
// Everything below still runs (terminal either way); only the painted transcript survives.
function settle(s, outcome, keepWindow) {
  if (s.settled) return;
  s.settled = true;
  // C3 (CRITICAL) — a settled session must leave NOTHING live. The CRASH path settles WITHOUT parking, so until
  // now every awaited canUseTool promise hung forever (the SDK child blocks on it) and the push iterator kept the
  // prompt stream open: the `claude` process outlived the window and could go on posting into the channel with
  // nothing left to show it. Deny each awaited request fail-closed, close the iterator, and abort here, so teardown holds whichever branch reached it (the reducer aborts too).
  denyPendingPermissions(s, 'Session ended');
  try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
  try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  store.saveRecord(baseRecord(s)); // FIX #9: full record (phase 'ended') persists cap counters for a P2 rehydrate
  if (outcome === 'completed' || outcome === 'failed') store.clearSdkSessionId(s.key);
  sessions.delete(s.key); sessionSummary.noteEnded(s, keepWindow === true); // §3.3: an ended pill survives only where its window does
  if (!keepWindow && s.win && !s.win.isDestroyed()) { try { s.win.destroy(); } catch (_) { /* best effort */ } }
  refreshTray();
}

function setLifecycleHandlers(h) { lifecycle = { onLaunched: h && h.onLaunched, onEnded: h && h.onEnded }; }

// Build the session object, open (or ADOPT) its window, start the query (launch + resume). The per-session nonce is
// minted HERE so the first turn's fence + every fed-inbound continuation share the SAME token (else injected content
// forges it). v2.x: the CONCRETE channel + workspace UUIDs are merged into the context here — the framing reads only the context, while every spawn shape carries the ids on its spec (fresh responder/requester, parked resume, recreated shell).
async function startSession(spec, sdk) {
  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');
  // H2 — THE ONLY WAY A STORED POSTURE REACHES A SPAWN. It used to be an AMBIENT read of a
  // durable, channel-wide preference (channel-context.startingModes), and startSession is the
  // single construction site for EVERY spawn shape, so that read re-armed the posture on shapes
  // involving no human decision at all — a peer-driven wake, a crash resume, a requester
  // auto-open — and bypass/auto_both picked once on one card became a standing, clickless grant
  // for the whole channel. It is HANDED IN now, per launch, by a caller executing a decision a
  // human is making right now; anything that passes nothing inherits the reducer's manual/ask.
  //
  // ⚠ THE PRE-CONSENT CARD WAS A SECOND POSTURE SOURCE AND IT IS GONE (2026-08-20, F-228).
  // Its two selects lived in the session window; `session-ipc` stored the pick on that card's
  // own registry entry and this line consumed it, keyed by the entry. With no card there is
  // ONE source left — `spec.startModes`, handed in per launch by a caller executing a decision
  // a human is making right now — which is the shape H2 always wanted and the card was the
  // exception to. `spec.adoptsConsent` went with it.
  //
  // FIX 4 SURVIVES AND IS NOW THE WHOLE RULE — OPERATOR-ARMED IS THE ONE THING THAT REACHES A
  // PARKED SHELL. A shell is normally woken by something that is NOT the approving human, so it
  // refuses a handed-in posture unless an explicit `operatorArmed` says a human chose it just
  // now; a bare recreate, reopen, resume or wake sets neither.
  const armedModes = spec.startModes;
  const operatorArmed = spec.operatorArmed === true;
  const startModes = armedModes && (!spec.parkedShell || operatorArmed)
    ? { toolMode: armedModes.tools, messageMode: armedModes.messages }
    : {};
  const state = initialSessionState({ mode: spec.mode, side: spec.side, ...readCaps(), ...startModes });
  // P2: a reopen fallback opens a PARKED SHELL — a live window, NO SDK query yet. It boots
  // parked so a lazy wake (P1) resumes it; baseRecord persists s.state.phase = 'parked'.
  // FIX #9 / AUDIT D3: the running cap budget rehydrates on EVERY resume shape. It used to sit
  // inside the parkedShell branch below, so a crash then opt-in resume (session-park.startResume)
  // would have reset a spent turn/cost budget to zero even once the counters were passed.
  state.turns = Number(spec.turns) || 0;
  state.costUsd = Number(spec.costUsd) || 0;
  if (spec.parkedShell) { state.phase = 'parked'; state.parked = true; state.activity = 'parked'; }
  const context = { ...(spec.context || {}), channelId: spec.channelId, workspaceId: spec.workspaceId };
  const firstTurn = spec.parkedShell ? ''
    : spec.rawFirstTurn ? spec.rawFirstTurn
      : framing.buildFencedTurn({ side: spec.side, message: spec.firstMessage, context, nonce });
  const s = {
    key: spec.key,
    sessionId,
    sdkSessionId: spec.resumeSdkId || null,
    channelId: spec.channelId,
    taskId: spec.taskId || '',
    workspaceId: spec.workspaceId,
    side: state.side,
    profile: spec.profile,
    // Item 9: human tool-profile label for the renderer's posture line (passed on init).
    profileLabel: require('./tool-profiles').profileLabel(spec.profile),
    mode: state.mode,
    counterpartyId: spec.counterpartyId || null, // FIX L1: the task's other party
    // D2 — THE BINDING. 'pair' is every shape that exists today and is the default by
    // construction: only a launch that explicitly asks for 'room' widens the inbound feed
    // and the window history past one counterparty. `agentId` is the channel_agents row a
    // TEAM session runs as; it is half of the slot key and rides into the framing.
    bind: spec.bind === 'room' ? 'room' : 'pair',
    agentId: spec.agentId || null,
    // H2: is this session's channel a DIRECT (1:1) one? The server addresses an
    // unaddressed post there (`resolveDirectPeer`), so the outbound card names the
    // recipient instead of saying none was named. `=== true` only — a launch shape that
    // does not carry the flag degrades to the channel-level wording, never to a guess.
    direct: spec.direct === true,
    // O-6: the counterparty display name labels the agent's op=post ("Sent to X").
    counterpartyName: (spec.context && (spec.context.authorName || spec.context.targetName)) || null,
    // THE MODEL (2026-08-02). Same precedence as the posture above and read behind the SAME
    // `adoptsConsent` gate (FIX 1b), for the same reason: the pre-consent card the human was
    // looking at WINS (single use, entry-scoped), and a durable record's stored pick is the
    // fallback every other shape carries. Coerced against the frozen enum HERE, so a hand-edited
    // store can only land on 'default'. NOT reducer state: buildSdkOptions is its one reader.
    model: sessionModel.normalizeModel(spec.model),
    state,
    context, // display identity + the channel/workspace ids the framing addresses
    nonce,
    firstTurn,
    resumeSdkId: spec.resumeSdkId || null,
    startedAt: Date.now(),
    lastTotalCost: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pendingInbound: [], // bounded FIFO of held interactive inbound replies
    // FIX F2/F3: a parked shell with NOTHING to resume starts a BRAND-NEW sdk session and buildSdkOptions sets no
    // system prompt, so its first turn must carry the full v1.9 framing (role, SECURITY RULES, delivery instruction)
    // or the agent answers nowhere and the peer gets nothing. `freshFraming` is the ONE-SHOT marker io.withSeed consumes, `freshRun` its stable twin.
    freshRun: spec.parkedShell === true && !spec.resumeSdkId,
    freshFraming: spec.parkedShell === true && !spec.resumeSdkId,
    idleTimer: null,
    settled: false, windowHidden: false,
    lastInboundSeq: Number.isFinite(Number(spec.triggerSeq)) ? Number(spec.triggerSeq) : null,
    win: null, query: null, abortController: null, pushIterator: null,
  };
  sessions.set(s.key, s); sessionSummary.touch(); // §3.3: REGISTRATION IS A PROJECTION MOVE — the pill must not wait for the SDK's first dispatch (§11)
  store.saveRecord(baseRecord(s)); // phase 'launching' until system/init flips it
  // The spawn SURFACE. ⚠ THERE IS ONLY ONE LEFT AND IT IS NONE (2026-08-20, F-228): the window
  // branch went with the renderer it painted into. Kept as a call rather than inlined because
  // the ROLLBACK below is the contract — a surface that cannot be attached un-registers the
  // session, and that is a property worth keeping a seam for.
  if (!sessionWindowless.attachSurface(s, spec)) {
    sessions.delete(s.key); sessionSummary.touch(); // ...and a ROLLBACK is one too: the registration above already scheduled a flush
    return null;
  }
  emit(s, { type: 'modes', tool: state.toolMode, message: state.messageMode }); // v3.1: the header must state the PRESET posture, not the defaults
  emit(s, { type: 'model', choice: s.model }); // ...and WHICH MODEL, so the third select never claims a pick nothing applied
  // Item 1/5/6 + C5: avatars reach the renderer ONLY as `avatars` events (the replay ring splits a warm one off `init`).
  s.selfAvatar = avatarCache.cachedForUser(selfUserId);
  s.peerAvatar = avatarCache.cachedForUser(s.counterpartyId);
  avatarCache.resolveForSession(s, { selfUserId, peerUserId: s.counterpartyId }, (p) => emit(s, p));
  // FIX (v2.x): pin the INITIATING ask at the TOP (display only; io returns null for a
  // parked/resumed shell). Emitted, NEVER pushed to the iterator; rides the replay ring.
  const reqItem = io.initialRequestPayload(s.side, spec.firstMessage, s.counterpartyName);
  if (reqItem) emit(s, reqItem);
  // ⚠ `spec.parkedShell` NO LONGER HAS A PRODUCER (2026-08-20, F-228). It marked the
  // shell-recreate lane, which opened a window and started no query; that lane is deleted. The
  // FLAG is still read by `startModes` above, where it is the guard that stops a woken shell
  // inheriting a posture no human armed — so it stays a recognized spec field rather than being
  // scrubbed, and a future non-window dormant shape can set it and get the safe behaviour.
  // A WINDOWLESS spawn cannot hold on sign-in (the recovery UI wrote to a window):
  // roll back so launch() reports auth-hold and the caller answers honestly.
  if (spec.windowless && sessionAuth.holdIfNoCredential(s)) { sessions.delete(s.key); sessionSummary.touch(); return { authHold: true }; }
  // Q6 PREFLIGHT: a machine with no Claude Code sign-in can only produce a dead session, so HOLD the
  // launch on the sign-in action instead. Nothing is settled, echoed, or thrown away; the request runs
  // the moment sign-in succeeds.
  if (sessionAuth.holdIfNoCredential(s)) return s;
  await startQuery(s, sdk);
  return s;
}

async function launch(a) {
  if (!a.windowless) return { skipped: 'disabled' }; // ⚠ THE ONLY SPAWN SHAPE LEFT IS WINDOWLESS (F-228)
  const key = store.slotKey(a);
  // FIX N1: the busy checks must ask about the SAME slot `key` names. They were rebuilding
  // `{ channelId, taskId }` by hand, stripping `agentId` — the latent bug D2 fixed in
  // session-park.startResume: for a team-shaped call (agentId set, taskId '') the key says
  // (channel, agent) while the checks ask about (channel, ''), so launch could report a free
  // slot for an agent that is running and then have startSession overwrite it.
  const slot = { channelId: a.channelId, taskId: a.taskId, agentId: a.agentId || null };
  // H1 (LOW): a HELD slot (sign-in wait) answers auth-hold, never busy — post the truth.
  if (isAuthHeldSession(slot)) return { skipped: 'auth-hold' };
  if (hasLiveSession(slot)) return { skipped: 'busy' };
  // THE CONCURRENCY CEILING. ⚠ ONE BRANCH, because there is one spawn shape (the early return
  // above). It used to be two: a WINDOW budget that an adoptable pre-consent card was net-zero
  // against and that freed an untouched parked shell before refusing (AUDIT D4), and this one.
  // Both the adopt and the eviction went with the window (F-228), so a refusal here is plain —
  // there is nothing to reclaim, and `MAX_CONCURRENT_SESSIONS` is a COST ceiling as much as a
  // concurrency one (INVARIANTS §11: every per-session bound multiplies against it).
  if (sessionWindowless.liveCount(sessions) >= sessionWindowless.MAX_CONCURRENT_SESSIONS) return { skipped: 'cap' };
  let sdk;
  try { sdk = await getSdk(); } catch (err) {
    diag('session-engine: SDK unavailable', err && err.message);
    return { skipped: 'no-sdk' };
  }
  if (hasLiveSession(slot)) return { skipped: 'busy' }; // FIX #7: re-check after await — do not overwrite a racing creator's session
  const s = await startSession({
    key,
    channelId: a.channelId,
    taskId: a.taskId,
    workspaceId: a.workspaceId,
    side: a.side,
    profile: a.toolProfile,
    mode: a.mode,
    context: a.context,
    counterpartyId: a.counterpartyId, // FIX L1: bind the feed to the task's other party
    direct: a.direct, // H2: the server's is_direct flag, for the outbound card's recipient line
    firstMessage: a.firstMessage, // startSession frames it inside the per-session nonce fence
    // H2: the posture a HUMAN chose for THIS launch, and the only way one reaches a spawn.
    // `trigger.js` passes the arm it consumed on a consent-approved responder launch;
    // `channel-dir-ipc.js › sessions:launch` passes the channel's durable posture. Anything
    // that passes nothing inherits the reducer's manual/ask.
    // ⚠ `adoptsConsent` RODE HERE and is gone (F-228): it named the ONE spawn allowed to spend
    // the pre-consent card's entry-keyed arm, and there is no card.
    startModes: a.startModes,
    windowless: a.windowless === true, // 2026-08-20: no window, ever, on this shape
    triggerSeq: a.triggerSeq, // the ask's seq — the outbound bridge's seq-join floor
  }, sdk);
  if (!s) return { skipped: 'disabled' };
  if (s.authHold === true) return { skipped: 'auth-hold' };
  return { sessionId: s.sessionId };
}

function launchResponderSession(a) {
  return launch({ ...a, side: 'responder', firstMessage: a.message });
}
function launchRequesterSession(a) {
  return launch({ ...a, side: 'requester', firstMessage: a.goal });
}

function hasLiveSession(a) {
  const s = sessions.get(store.slotKey(a));
  return !!(s && !s.settled);
}

// H1 (LOW) — is the session occupying this (channel, task) slot HELD on the sign-in action
// rather than actually working? The registry cannot tell the difference on its own, and the
// caller's "busy" copy ("I'm still finishing a previous request") is a lie when the truth is
// "nothing is running and nobody can start it until someone signs in on that Mac".
function isAuthHeldSession(a) {
  const s = sessions.get(store.slotKey(a));
  return !!(s && !s.settled && s.state && s.state.authHeld === true);
}

// FIX L1: the counterparty whose replies this session may consume; the listener checks it
// before feeding, so a third party can never inject a turn.
function counterpartyFor(a) {
  const s = sessions.get(store.slotKey(a));
  return s && !s.settled ? (s.counterpartyId || null) : null;
}

// The inbound gate lives in session-gate.js (v2.5 D1): `feedInbound` enqueues a counterparty
// turn on a live or parked session. Its HOLD half went with the surface that answered a hold
// (F-228) — a windowless session's message axis is floored at auto_inbound, so nothing holds.
// ⚠ THE CONSENT REFLOW (item 8) IS DELETED — 2026-08-20, F-228. `openConsentWindow` minted a
// PRE-CONSENT WINDOW on every inbound request: a window per thread, before anyone had looked at
// it, running no agent work until Accept and then ADOPTED by launchResponderSession. The
// decision surfaces are inline on the channels page now (INVARIANTS §6), so there is no card to
// open, adopt, close or release, and `session-consent.js` went with the renderer it painted into.
// Resume machinery (offerResume/startResume/resume) lives in session-park. init(): register the
// renderer->main IPC once, then settle any session live/awaiting when the app died — post the
// interrupted echo and, when the SDK session id survives, offer an opt-in resume (never auto).
async function init() {
  // ⚠ NO IPC TO REGISTER (2026-08-20, F-228). `session-ipc.js` bound 15 handlers resolved from
  // `event.sender` against a session's own window; no session has a webContents any more, so the
  // whole `session:*` sender-binding regime is deleted. INVARIANTS §11 now describes ONE regime.
  const records = store.loadRecords();
  for (const key of Object.keys(records)) {
    const rec = records[key];
    // P1: a 'dormant' (parked) record is EXEMPT from the interrupted echo — it was paused on
    // purpose and stays resumable via P2. Only a live/awaiting record that died echoes.
    if (!rec || store.reloadDisposition(rec.phase) !== 'resume') continue;
    store.setRecordPhase(key, 'ended');
    runLifecycle({ channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId, side: rec.side, sessionId: rec.sessionId, key, sdkSessionId: store.getSdkSessionId(key) }, 'task_failed', { interrupted: true }); // FIX #2: same key+sdk id dedupes with a same-cycle crash echo
    const sdkId = store.getSdkSessionId(key);
    if (sdkId) sessionPark.offerResume(rec, sdkId);
  }
  // AUDIT D5: bound the durable record set (retention policy + protections in session-store). AFTER
  // the scan above, so an interrupted record still echoes and offers its resume before it can age out.
  try { store.pruneRecords({ keep: new Set(sessions.keys()) }); } catch (err) { diag('session-engine: prune failed', err && err.message); }
}

module.exports = {
  init,
  setLifecycleHandlers,
  setSelfIdentity, // item 1: the operator's user id for the self avatar (channel-listener)
  launchResponderSession,
  launchRequesterSession,
  hasLiveSession,
  counterpartyFor,
  // The three session-team.js exports (`summonTeamSession`, `wakeTeamSession`,
  // `acceptsInboundFrom`) went with summoning — docs/ENGINEERING.md §18 F-141 carries that
  // story, including why the inert room-vs-pair slot shape stayed. The LAST of them left its
  // line behind here, and `module.exports` is EVALUATED, so requiring this module threw
  // `ReferenceError: sessionTeam is not defined` — no engine, no windows, no sessions.
  // test/main-exports-defined.test.mjs now pins every main export against what its file binds.
  feedInbound: sessionGate.feedInbound, // v2.5 D1 — the inbound gate (live or parked)
  listLiveSessions: sessionReopen.listLiveSessions, listOrphanRisk: sessionReopen.listOrphanRisk, endLiveSessions: sessionReopen.endLiveSessions, // item 10 tray + C-8 quit guard
  reopenByTask: sessionReopen.reopenByTask, controlByTask: sessionReopen.controlByTask, setModeByTask: sessionReopen.setModeByTask, messageByTask: sessionReopen.messageByTask, narrationFor: (k) => sessionNarration.ringFor(sessions.get(k)), // item 2 + Phase 5 pause/end + F-212's 1:1 lane and work lane — the MAIN-window bridge (channel-dir-ipc)
};
