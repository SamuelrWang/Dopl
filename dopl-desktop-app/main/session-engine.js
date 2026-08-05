// Session engine — the imperative shell (v2.0 Session Window, Track T3).
//
// Owns ONE Claude Agent SDK query() per live session and executes the pure session-reducer's
// side-effect-free effect descriptors. v2.0 added the CONSENT REFLOW (item 8: a pre-consent window
// running NO agent work until Accept, then ADOPTED by launchResponderSession) and REOPEN (item 10:
// live windows hide-on-close + tray reopen; render-process-gone is the crash signal). Renderer->main
// IPC lives in session-ipc.js (§O-8). SEAM: this file imports NO electron at all — an injected
// factory creates windows and session-shell.js owns the rest of the window plumbing. SECURITY: settingSources:[] always, so the
// global allow-list can never shadow a gated tool; the dopl bearer stays in the in-memory mcpServers
// object (never logged, never on argv, never on disk since C1).

const crypto = require('crypto');
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const avatarCache = require('./avatar-cache');
const sessionReopen = require('./session-reopen');
const sessionPark = require('./session-park');
const framing = require('./prompt-framing');
const { closeTask } = require('./session-close-task'); // §2 split: the engine holds no HTTP dep
const sessionAuth = require('./session-auth'); // Q6 preflight + in-window sign-in
const { initialSessionState, sessionReducer, idleTimeout } = require('./session-reducer');
const { getSdk } = require('./sdk-loader');
const sessionQuery = require('./session-query'); // §3 split: SDK options + the query lifecycle (H1)
const { buildSdkOptions, startQuery, consume } = sessionQuery;
const sessionModel = require('./session-model'); // the frozen model enum (argv), coerced here too
const sessionConsent = require('./session-consent');
const sessionIpc = require('./session-ipc');
const sessionGate = require('./session-gate'); // v2.5 D1: the inbound message gate
const sessionHistory = require('./session-history'); // v2.5 D3: reopened-shell history
const sessionTeam = require('./session-team'); // D2: summoned, room-bound TEAM sessions
const sessionShell = require('./session-shell'); // §2 split: the electron window plumbing

// settings.js owns the window-mode switch + caps; required defensively so the engine still
// loads if it is momentarily absent (unit/E2E harnessing), defaulting to ON.
let settings = null;
try { settings = require('./settings'); } catch (_) { /* absent -> defaults (window-mode ON) */ }
const MAX_WINDOWS = (settings && settings.MAX_SESSION_WINDOWS) || 6;

const sessions = new Map(); // sessionKey -> live session object (in-memory only)
let windowFactory = null; // fn(sessionId) -> BrowserWindow (injected by index.js)
let lifecycle = { onLaunched: null, onEnded: null };
let selfUserId = null; // operator's own user id (item 1: the self avatar); set by channel-listener
function setSelfIdentity(id) { selfUserId = id || null; }

function windowModeEnabled() { return settings ? settings.getWindowMode() : true; }
function readCaps() {
  return settings ? { turnCap: settings.getTurnCap(), idleMs: settings.getIdleTtlMs(), costCapUsd: settings.getCostCapUsd() } : {};
}

// Rebuild the tray after a session is hidden / reopened / settled. Lazy-required so the engine holds no top-level tray dependency (tray requires nothing back).
function refreshTray() { try { require('./tray').refresh(); } catch (_) { /* tray optional */ } }

// Park + resume machinery (session-park.js) is fed the engine handles it can't require: the registry, SDK loader, buildSdkOptions (the v1.9 security path, NEVER duplicated), plus consume/dispatch/startSession/settle. Hoisted, so bind order does not matter.
sessionPark.bind({
  sessions, getSdk, buildSdkOptions, consume, dispatch, startSession, hasLiveSession,
  emit, windowFactoryReady: () => !!windowFactory,
  atWindowCap: () => sessions.size + sessionConsent.count() >= MAX_WINDOWS, // FIX #4: shared window budget for recreateParkedShell
  loadHistory: sessionHistory.load, // D3: a recreated shell paints the channel history
  settleSession: settle, // FIX #7: LRU eviction of an untouched parked shell at the cap
  resolveChannelContext: require('./channel-context').resolve, // Q6b: a shell for a thread with NO local record
});
// §3 split: session-query owns the option assembly + the consume loop, but needs the engine's
// dispatch and the replay-aware quiet emit (neither module requires back into the engine).
sessionQuery.bind({ dispatch, emitQuiet });
// Q6: same injection for the preflight + in-window sign-in. `startQuery` is the SHARED deferred
// launch (session-query), so an auth hold never assembles a second query and inherits H1's
// supersede-before-relaunch; `denyPending` fail-closes before it parks.
sessionAuth.bind({ sessions, getSdk, startQuery, dispatch, emit, denyPending: denyPendingPermissions, getSessionBySender });
// v2.5 D1/D3: same for the inbound gate + history loader (neither imports back into the engine).
sessionGate.bind({ sessions, dispatch });
sessionHistory.bind({ emit });
// D2: the TEAM lane (a summon greets the CHANNEL and opens NO window; a later wake opens the
// room-bound parked shell, and the pair/room feed predicate). Same injection discipline as
// session-park / session-gate — it gets the engine's private registry and its single
// construction site, and requires nothing back.
sessionTeam.bind({ sessions, startSession, getSdk, emit, windowModeEnabled, atWindowCap: sessionPark.atCapAfterEvict, windowFactoryReady: () => !!windowFactory, getSelfId: () => selfUserId });
// §2 split: the electron window plumbing (replay wiring, hide-on-close, the crash signal, the
// folder label). It gets `emit` rather than owning it — the RESHOW rule is session policy.
sessionShell.bind({ dispatch, refreshTray, emit });
// Reopen helpers (session-reopen.js): live registry + tray refresh + the P2 shell fallback (item 2).
sessionReopen.bind({ sessions, refreshTray, recreateParkedShell: sessionPark.recreateParkedShell });

const baseRecord = io.baseRecord; // durable-record projection (session-io.js)

// FIX F1 (v2.7): dispatch REPORTS whether an effect resolved a LIVE canUseTool promise (only
// resolvePerm knows; a park's denyPending may have fail-closed the requestId already). session-ipc
// turns that into the {ok} the renderer's optimistic stamp is gated on; other callers ignore it.
function dispatch(s, event) {
  const { state, effects } = sessionReducer(s.state, event);
  s.state = state;
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
    // `eff.threadId` is the thread THIS turn arrived in: a fresh room-bound shell's first turn is
    // framed with it, so the agent is ordered to read the exchange it is being woken into.
    case 'pushInbound':
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.withSeed(s, io.frameContinuation(s.nonce, eff.message, eff.authorName), eff.threadId)));
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
    case 'closeTask': closeTask(s, eff.outcome, eff.summary); break;
    case 'settle': settle(s, eff.outcome, eff.keepWindow === true); break;
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

// A hidden window RESHOWS on anything that needs the operator: a gated tool request (item 10), a `counterparty` reply
// (v2.2 item 3), a HELD inbound message (v2.5 D1), or an outbound post awaiting Send / Deny on its card (v2.7 L3). Surfacing runs NO gated tool; emits ride the replay.
const RESHOW_TYPES = new Set(['permission_request', 'counterparty', 'inbound_pending', 'outbound_gate']);
function emit(s, payload) {
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

// The task status flip (op:"close") lives in session-close-task.js (§2 split); the lifecycle echo stays here.
// Terminal: drop the live handles, mark the record ended, DESTROY the window (item 10 hid it), free the slot. A DONE task drops the resume entry; every other end KEEPS the sdkSessionId (FIX #7).
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
  sessions.delete(s.key);
  if (!keepWindow && s.win && !s.win.isDestroyed()) { try { s.win.destroy(); } catch (_) { /* best effort */ } }
  refreshTray();
}

function getSessionBySender(sender) { // renderer->main resolution for session-ipc
  if (!sender) return null;
  for (const s of sessions.values()) { if (s.win && !s.win.isDestroyed() && s.win.webContents.id === sender.id) return s; }
  return null;
}

function setWindowFactory(fn) { // consent windows use the same factory
  windowFactory = typeof fn === 'function' ? fn : null;
  sessionConsent.setWindowFactory(windowFactory);
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
  // FIX 1 (2026-08-02) — THE PRE-CONSENT CARD IS ITSELF A POSTURE SOURCE, and the preferred one.
  // Its two selects are live before Accept; session-ipc stores the pick on that card's OWN
  // registry entry and it is consumed here, once, keyed by the entry rather than by the channel,
  // so it applies to the spawn that exact card approves and no sibling launch can race it.
  // `spec.startModes` (channel-prefs, from the web card) is now the COMPATIBILITY path.
  //
  // FIX 1b (BLOCKER, 2026-08-02) — ...AND ONLY THE SPAWN THAT ADOPTS THAT CARD MAY SPEND IT. The
  // entry is keyed sessionKey(channelId, taskId), the SAME key recreateParkedShell,
  // openFromChannel and startResume all spawn under, and this read ran on
  // every one of them: a pending card armed a PEER-DRIVEN shell wake at bypass/auto_both (see
  // `operatorArmed` below), and the operator's own later Accept then started at manual/ask
  // because the arm was already spent. launch() alone sets `adoptsConsent`, off the same
  // sessionConsent.has(key) it computes to decide whether this spawn ADOPTS the card's window.
  // The gate rides the KEY, because the arm is entry-keyed: a null key takes nothing.
  //
  // FIX 4 — OPERATOR-ARMED, the one thing that reaches a PARKED SHELL. A shell is normally woken
  // by something that is NOT the approving human, so it refuses a handed-in posture; but
  // session-team.js spawns EVERY team session as a parked shell, which made a team session
  // unarmable rather than careful. The gate opens for a consent card just accepted, or a caller
  // that explicitly threads `operatorArmed`; a bare recreate, reopen, resume or wake sets neither.
  const consentModes = sessionConsent.takeStartModes(spec.adoptsConsent === true ? spec.key : null);
  const armedModes = consentModes || spec.startModes;
  const operatorArmed = !!consentModes || spec.operatorArmed === true;
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
    model: sessionModel.normalizeModel(sessionConsent.takeStartModel(spec.adoptsConsent === true ? spec.key : null) || spec.model),
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
    // or the agent answers in the window and the peer gets nothing. `freshFraming` is the ONE-SHOT marker io.withSeed consumes, `freshRun` the stable twin session-history reads.
    freshRun: spec.parkedShell === true && !spec.resumeSdkId,
    freshFraming: spec.parkedShell === true && !spec.resumeSdkId,
    idleTimer: null,
    settled: false, windowHidden: false,
    win: null, query: null, abortController: null, pushIterator: null,
  };
  sessions.set(s.key, s);
  store.saveRecord(baseRecord(s)); // phase 'launching' until system/init flips it
  // Item 8 step 4: ADOPT an open pre-consent window (no flash — the renderer flips consent->running on `init`), else open a fresh one.
  const adopted = sessionConsent.takeForAdopt(s.key);
  try {
    s.win = (adopted && adopted.win && !adopted.win.isDestroyed()) ? adopted.win : windowFactory(sessionId);
    if (!s.win) throw new Error('window factory returned nothing');
  } catch (err) {
    sessions.delete(s.key);
    diag('session-engine: window factory failed', err && err.message);
    return null;
  }
  sessionShell.bindWindow(s);
  sessionShell.emitFolder(s);
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
  // P2: a parked shell starts NO query (session-park paints the header/note; it waits for a lazy wake). Everything else launches now.
  if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }
  // Q6 PREFLIGHT: a machine with no Claude Code sign-in can only produce a dead session, so HOLD the
  // launch on the sign-in action instead. Nothing is settled, echoed, or thrown away; the request runs
  // the moment sign-in succeeds.
  if (sessionAuth.holdIfNoCredential(s)) return s;
  await startQuery(s, sdk);
  return s;
}

async function launch(a) {
  if (!windowModeEnabled() || !windowFactory) return { skipped: 'disabled' };
  const key = store.slotKey(a);
  // FIX N1: the busy checks must ask about the SAME slot `key` names. They were rebuilding
  // `{ channelId, taskId }` by hand, stripping `agentId` — the latent bug D2 fixed in
  // session-park.startResume: for a team-shaped call (agentId set, taskId '') the key says
  // (channel, agent) while the checks ask about (channel, ''), so launch could report a free
  // slot for an agent that is running and then have startSession overwrite it.
  const slot = { channelId: a.channelId, taskId: a.taskId, agentId: a.agentId || null };
  // H1 (LOW): distinguish "a session is working here" from "a session is HELD here waiting for
  // a sign-in" so the caller can post the truth instead of asking the peer to resend into a
  // slot nothing will ever free on its own.
  if (isAuthHeldSession(slot)) return { skipped: 'auth-hold' };
  if (hasLiveSession(slot)) return { skipped: 'busy' };
  // Adopting a pre-consent window is net-zero on the budget; only a FRESH window counts against the shared cap.
  // AUDIT D4: at the cap, free an untouched parked shell first (sessionPark.atCapAfterEvict) instead of
  // degrading a REAL inbound trigger to headless. Fail-restrictive: still a cap skip if nothing frees.
  const adoptable = sessionConsent.has(key);
  if (!adoptable && sessionPark.atCapAfterEvict()) return { skipped: 'cap' };
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
    // H2: present ONLY on a consent-approved responder launch, where trigger.js consumed
    // the operator's single-use arm. launchRequesterSession never sets it (no card was
    // shown for the operator's own goal), so a requester window starts at manual/ask.
    startModes: a.startModes,
    adoptsConsent: adoptable, // FIX 1b: the ONLY spawn allowed to spend that card's single-use arm
  }, sdk);
  if (!s) return { skipped: 'disabled' };
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

// The inbound gate lives in session-gate.js (v2.5 D1): feedInbound (live or parked) and feedInboundForTask (recreate
// the shell first) both HOLD the turn for an operator Accept unless auto-approve / the standing task grant is on.
// ── Consent reflow (item 8) — thin wrappers over session-consent.js. This one opens a pre-consent window that runs
// NO agent work until Accept; the cap is gated HERE (session-consent cannot see the live sessions). decideConsent / closeConsentWindow / getConsentBySender are pass-throughs.
function openConsentWindow(spec) {
  if (!windowModeEnabled() || !windowFactory) return { skipped: 'disabled' };
  if (sessionPark.atCapAfterEvict()) return { skipped: 'cap' }; // AUDIT D4: free an idle shell first
  return sessionConsent.open({ ...spec, sessionId: crypto.randomUUID() });
}
// Resume machinery (offerResume/startResume/resume) lives in session-park. init(): register the
// renderer->main IPC once, then settle any session live/awaiting when the app died — post the
// interrupted echo and, when the SDK session id survives, offer an opt-in resume (never auto).
async function init() {
  sessionIpc.register({ getSessionBySender, getConsentBySender: sessionConsent.getBySender, dispatch, decideConsent: sessionConsent.decide, emitToSession: emit });
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
  setWindowFactory,
  setLifecycleHandlers,
  setSelfIdentity, // item 1: the operator's user id for the self avatar (channel-listener)
  launchResponderSession,
  launchRequesterSession,
  hasLiveSession,
  counterpartyFor,
  summonTeamSession: sessionTeam.summon, // D2 — /new-agent GREETS the channel; it opens no window
  wakeTeamSession: sessionTeam.ensureSession, // D2 — being addressed is what opens the shell
  acceptsInboundFrom: sessionTeam.acceptsInboundFrom, // D2 — the pair fence vs the room binding
  feedInbound: sessionGate.feedInbound, // v2.5 D1 — the inbound gate (live or parked)
  feedInboundForTask: sessionGate.feedInboundForTask, // v2.5 D1 — gate + recreate the shell
  armRequestStatus: sessionPark.armRequestStatus, // 2026-08-05 — the request strip on the operator's OWN typed request
  noteRequestStatus: sessionPark.noteRequestStatus, // ...and its lifecycle strip advances from wire events only
  openConsentWindow, // consent reflow (item 8) — called by trigger.js
  decideConsent: sessionConsent.decide,
  closeConsentWindow: sessionConsent.close,
  getConsentBySender: sessionConsent.getBySender,
  listLiveSessions: sessionReopen.listLiveSessions, // reopen (item 10) — tray via index.js
  reopenWindow: sessionReopen.reopenWindow,
  reopenByTask: sessionReopen.reopenByTask, // item 2 — MAIN-window bridge (channel-dir-ipc)
};
