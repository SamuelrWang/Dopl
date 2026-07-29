// Session engine — the imperative shell (v2.0 Session Window, Track T3).
//
// Owns ONE Claude Agent SDK query() per live session and executes the pure
// session-reducer's side-effect-free effect descriptors. v2.0 adds the CONSENT
// REFLOW (item 8: a pre-consent window in session-consent.js that runs NO agent work
// until Accept, then launchResponderSession ADOPTS it — one window, no flash) and
// REOPEN (item 10: live windows hide-on-close + reopen from the tray; the real crash
// signal is render-process-gone). Renderer->main IPC lives in session-ipc.js (§O-8).
//
// SEAM: never imports electron.BrowserWindow (an injected factory creates windows);
// reads electron only for Notification. settingSources:[] on every session so the
// operator's global allow-list can never shadow a gated tool; the dopl bearer stays
// inside the in-memory mcpServers object and is never logged or placed on argv.

const crypto = require('crypto');
const { Notification } = require('electron');
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const avatarCache = require('./avatar-cache');
const sessionReopen = require('./session-reopen');
const framing = require('./prompt-framing');
const { apiFetch } = require('./api');
const { initialSessionState, sessionReducer, nextIdleMs } = require('./session-reducer');
const { buildSessionToolConfig } = require('./session-profiles');
const { getSdk, resolveClaudeExecutable, buildMcpServers, buildScrubbedEnv } = require('./sdk-loader');
const sessionConsent = require('./session-consent');
const sessionIpc = require('./session-ipc');
const channelDirs = require('./channel-dirs');
const replay = require('./session-replay');

// settings.js owns the window-mode switch + caps; require defensively so the engine
// still loads if it is momentarily absent (unit/E2E harnessing), defaulting to ON.
let settings = null;
try { settings = require('./settings'); } catch (_) { /* absent -> defaults (window-mode ON) */ }
const MAX_WINDOWS = (settings && settings.MAX_SESSION_WINDOWS) || 6;

const sessions = new Map(); // sessionKey -> live session object (in-memory only)
let windowFactory = null; // fn(sessionId) -> BrowserWindow (injected by index.js)
let lifecycle = { onLaunched: null, onEnded: null };
let selfUserId = null; // operator's own user id (item 1: the self avatar); set by channel-listener
function setSelfIdentity(id) { selfUserId = id || null; }

function windowModeEnabled() {
  return settings ? settings.getWindowMode() : true;
}
function readCaps() {
  if (!settings) return {};
  return { turnCap: settings.getTurnCap(), idleMs: settings.getIdleTtlMs(), costCapUsd: settings.getCostCapUsd() };
}

// Rebuild the tray after a session is hidden / reopened / settled. Lazy-required so
// the engine holds no top-level tray dependency (tray requires nothing back).
function refreshTray() {
  try { require('./tray').refresh(); } catch (_) { /* tray optional */ }
}

// Reopen helpers (session-reopen.js) need the live registry + tray refresh; bind once.
sessionReopen.bind({ sessions, refreshTray });

const baseRecord = io.baseRecord; // durable-record projection (session-io.js)

function dispatch(s, event) {
  const { state, effects } = sessionReducer(s.state, event);
  s.state = state;
  for (const eff of effects) runEffect(s, eff);
}

function runEffect(s, eff) {
  switch (eff.type) {
    case 'emit':
      emit(s, eff.payload);
      break;
    case 'persist':
      store.setRecordPhase(s.key, eff.phase);
      break;
    case 'scheduleIdle':
      scheduleIdle(s);
      break;
    case 'resolvePermission':
      resolvePerm(s, eff.requestId, eff.decision);
      break;
    case 'pushTurn':
      if (s.pushIterator) s.pushIterator.push(io.userMessage(eff.text, eff.priority === 'now' ? 'now' : undefined));
      break;
    case 'pushInbound':
      if (s.pushIterator) s.pushIterator.push(io.userMessage(io.frameContinuation(s.nonce, eff.message, eff.authorName)));
      break;
    case 'interruptQuery':
      try { if (s.query && s.query.interrupt) s.query.interrupt().catch(() => {}); } catch (_) { /* best effort */ }
      break;
    case 'abortQuery':
      try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
      try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
      break;
    case 'lifecycle':
      runLifecycle(s, eff.kind, eff.extra);
      break;
    case 'closeTask':
      closeChannelTask(s, eff.outcome, eff.summary);
      break;
    case 'settle':
      settle(s, eff.outcome);
      break;
    default:
      diag('session-engine: unknown effect', eff && eff.type);
  }
}

// Emits flow through the replay (buffered pre-load, re-sent on reload). Reshow a hidden
// window on a gated request (item 10) OR a `counterparty` reply (v2.2 item 3 primary),
// surfacing the operator's OWN window — which still runs NO gated tool on its own.
function emit(s, payload) {
  if (!s.win || s.win.isDestroyed()) return;
  if (s.windowHidden && payload && (payload.type === 'permission_request' || payload.type === 'counterparty')) {
    try { s.win.show(); } catch (_) { /* best effort */ }
    s.windowHidden = false;
    refreshTray();
  }
  s.replay.deliver(payload);
}
function safeSend(s, payload) {
  try {
    s.win.webContents.send('session:event', payload);
  } catch (err) {
    diag('session-engine: send failed', err && err.message);
  }
}

// Item 5/7: push the REAL resolved folder LABEL (short-form, never the abs path §H-9).
function emitFolder(s) {
  try { emit(s, { type: 'folder', label: channelDirs.resolvedDirLabel(s.channelId) }); }
  catch (_) { /* best effort */ }
}

function scheduleIdle(s) {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => {
    if (!s.settled) dispatch(s, { type: 'idle_timeout' });
  }, nextIdleMs(s.state));
}

function resolvePerm(s, requestId, decision) {
  const resolve = s.pendingPermissions.get(requestId);
  if (!resolve) return;
  s.pendingPermissions.delete(requestId);
  s.pendingNames.delete(requestId);
  // FIX M1: FAIL CLOSED — resolve ALLOW only on an explicit 'allow' (the reducer
  // maps allow-once/allow-task -> 'allow'); anything else, incl. unknown, denies.
  resolve(decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied by operator' });
}

function runLifecycle(s, kind, extra) {
  const info = { channelId: s.channelId, taskId: s.taskId, workspaceId: s.workspaceId, side: s.side, sessionId: s.sessionId };
  try {
    if (kind === 'task_started') {
      if (lifecycle.onLaunched) lifecycle.onLaunched(info);
    } else if (lifecycle.onEnded) {
      lifecycle.onEnded(info, kind, extra || {});
    }
  } catch (err) {
    diag('session-engine: lifecycle handler error', err && err.message);
  }
}

// The DB status flip for a first-class task (op:"close"); the task_finished/failed
// message echo is separate (runLifecycle). No-op when there is no task id.
async function closeChannelTask(s, outcome, summary) {
  if (!s.taskId) return;
  try {
    const res = await apiFetch(`/api/channels/${s.channelId}/tasks/${encodeURIComponent(s.taskId)}`, {
      method: 'PATCH',
      workspaceId: s.workspaceId,
      body: { op: 'close', outcome, summary },
      timeoutMs: 15000,
    });
    diag('session-engine: close_task', res.ok ? 'ok' : `failed ${res.status}`);
  } catch (err) {
    diag('session-engine: close_task error', err && err.message);
  }
}

// Terminal: drop the live handles, mark the record ended, DESTROY the window (item 10
// hid it until here), free the registry slot. A DONE task (close_task completed/
// failed) drops the resume map entry; every other end KEEPS the sdkSessionId.
function settle(s, outcome) {
  if (s.settled) return;
  s.settled = true;
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  store.setRecordPhase(s.key, 'ended');
  if (outcome === 'completed' || outcome === 'failed') store.clearSdkSessionId(s.key);
  sessions.delete(s.key);
  if (s.win && !s.win.isDestroyed()) { try { s.win.destroy(); } catch (_) { /* best effort */ } }
  refreshTray();
}

function bindWindow(s) {
  const wc = s.win.webContents;
  // Item 3: the replay owns the transcript ring + sent cursor. A reload (did-start-
  // loading rewinds, did-finish-load re-sends) is NEITHER close nor crash below.
  s.replay = replay.createReplay(wc, (p) => safeSend(s, p));
  wc.on('did-start-loading', s.replay.onReload);
  wc.on('did-finish-load', s.replay.onLoad);
  if (!wc.isLoading()) s.replay.onLoad();
  // Item 10: hide-on-close keeps a closed LIVE window's renderer + transcript for a
  // tray reopen (destroyed only on settle); render-process-gone is the crash signal.
  s.win.on('close', (e) => {
    // Hide for a tray Reopen, but never veto during app Quit (or it can't exit).
    if (!s.settled && !require('electron').app.isQuitting) {
      e.preventDefault();
      s.win.hide();
      s.windowHidden = true;
      refreshTray();
    }
  });
  wc.on('render-process-gone', () => { if (!s.settled) dispatch(s, { type: 'crash' }); });
}

function buildSdkOptions(s) {
  const cfg = buildSessionToolConfig(s.profile);
  const options = {
    // Item 7: the per-channel folder (else ~/Downloads) as the SDK cwd — session
    // windows set none before (the real bug). cwd is context (§H-9), not a fence.
    cwd: channelDirs.sessionSpawnDir(s.channelId),
    allowedTools: cfg.preApproved, // pre-approved => SHADOWED, no button (§A.5)
    disallowedTools: cfg.disallowedTools,
    mcpServers: buildMcpServers(cfg.doplToolsPolicy),
    settingSources: [], // ALWAYS — the global allow-list can never shadow a gate
    permissionMode: 'default', // FIX M2: pin — bypass/acceptEdits/dontAsk short-circuit canUseTool
    env: buildScrubbedEnv(), // FIX M2: strip permission-mode env knobs, keep auth (sdk-loader)
    canUseTool: io.makeCanUseTool(s, dispatch),
    abortController: s.abortController,
    includePartialMessages: false,
  };
  if (cfg.builtinTools.length) options.tools = cfg.builtinTools; // positive bound; [] => full offers all, gated
  const bin = resolveClaudeExecutable();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  if (s.resumeSdkId) options.resume = s.resumeSdkId;
  return options;
}

async function startQuery(s, sdk) {
  s.abortController = new AbortController();
  s.pushIterator = io.makePushIterator();
  const q = sdk.query({ prompt: s.pushIterator, options: buildSdkOptions(s) });
  s.query = q;
  s.pushIterator.push(io.userMessage(s.firstTurn));
  consume(s, q); // fire-and-forget consumer loop
}

async function consume(s, q) {
  try {
    for await (const msg of q) io.handleSdkMessage(s, msg, dispatch, store);
  } catch (err) {
    if (!isAbortError(err)) {
      diag('session-engine: query error', err && err.message);
      if (!s.settled) dispatch(s, { type: 'crash' });
    }
  }
}
function isAbortError(err) {
  return !!err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')));
}

function getSessionBySender(sender) { // renderer->main resolution for session-ipc
  if (!sender) return null;
  for (const s of sessions.values()) {
    if (s.win && !s.win.isDestroyed() && s.win.webContents.id === sender.id) return s;
  }
  return null;
}

function setWindowFactory(fn) {
  windowFactory = typeof fn === 'function' ? fn : null;
  sessionConsent.setWindowFactory(windowFactory); // consent windows use the same factory
}
function setLifecycleHandlers(handlers) {
  lifecycle = {
    onLaunched: handlers && handlers.onLaunched,
    onEnded: handlers && handlers.onEnded,
  };
}

// Build the session object, open (or ADOPT) its window, start the query (launch +
// resume). The per-session nonce is minted HERE so the first turn's fence + every
// fed-inbound continuation share the SAME token (else injected content forges it).
async function startSession(spec, sdk) {
  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');
  const state = initialSessionState({ mode: spec.mode, side: spec.side, ...readCaps() });
  const firstTurn = spec.rawFirstTurn
    ? spec.rawFirstTurn
    : framing.buildFencedTurn({ side: spec.side, message: spec.firstMessage, context: spec.context, nonce });
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
    // O-6: the counterparty display name labels the agent's op=post ("Sent to X").
    counterpartyName: (spec.context && (spec.context.authorName || spec.context.targetName)) || null,
    state,
    context: spec.context || {},
    nonce,
    firstTurn,
    resumeSdkId: spec.resumeSdkId || null,
    startedAt: Date.now(),
    lastTotalCost: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pendingInbound: [], // bounded FIFO of held interactive inbound replies
    idleTimer: null,
    settled: false, windowHidden: false,
    win: null, query: null, abortController: null, pushIterator: null,
  };
  sessions.set(s.key, s);
  store.saveRecord(baseRecord(s)); // phase 'launching' until system/init flips it
  // Item 8 step 4: ADOPT the pre-consent window if one is open (one window, no flash
  // — the renderer flips consent->running on `init`), else open a fresh window.
  const adopted = sessionConsent.takeForAdopt(s.key);
  try {
    s.win = (adopted && adopted.win && !adopted.win.isDestroyed()) ? adopted.win : windowFactory(sessionId);
    if (!s.win) throw new Error('window factory returned nothing');
  } catch (err) {
    sessions.delete(s.key);
    diag('session-engine: window factory failed', err && err.message);
    return null;
  }
  bindWindow(s);
  emitFolder(s);
  // Item 1/5/6: warm avatars ride init; a cold cache follows with an `avatars` event.
  s.selfAvatar = avatarCache.cachedForUser(selfUserId);
  s.peerAvatar = avatarCache.cachedForUser(s.counterpartyId);
  avatarCache.resolveForSession(s, { selfUserId, peerUserId: s.counterpartyId }, (p) => emit(s, p));
  await startQuery(s, sdk);
  return s;
}

async function launch(a) {
  if (!windowModeEnabled() || !windowFactory) return { skipped: 'disabled' };
  const key = store.sessionKey(a.channelId, a.taskId);
  if (hasLiveSession({ channelId: a.channelId, taskId: a.taskId })) return { skipped: 'busy' };
  // Adopting a pre-consent window is net-zero on the window budget; only a fresh
  // window counts against the shared cap (live sessions + open consent windows).
  const adoptable = sessionConsent.has(key);
  if (!adoptable && sessions.size + sessionConsent.count() >= MAX_WINDOWS) return { skipped: 'cap' };
  let sdk;
  try {
    sdk = await getSdk();
  } catch (err) {
    diag('session-engine: SDK unavailable', err && err.message);
    return { skipped: 'no-sdk' };
  }
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
    firstMessage: a.firstMessage, // startSession frames it inside the per-session nonce fence
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
  const s = sessions.get(store.sessionKey(a.channelId, a.taskId));
  return !!(s && !s.settled);
}

// FIX L1: the counterparty whose channel replies this session may consume as turns;
// the listener checks it before feeding so a third party can never inject a turn.
function counterpartyFor(a) {
  const s = sessions.get(store.sessionKey(a.channelId, a.taskId));
  return s && !s.settled ? (s.counterpartyId || null) : null;
}

function feedInbound(a) {
  const s = sessions.get(store.sessionKey(a.channelId, a.taskId));
  if (!s || s.settled) return false;
  const item = { pendingId: crypto.randomUUID(), message: a.message, authorName: a.authorName };
  const disp = io.queueInbound(s, item, s.state.mode === 'interactive'); // don't overwrite a held reply
  if (disp === 'dispatch') dispatch(s, { type: 'inbound_arrived', pendingId: item.pendingId, message: a.message, authorName: a.authorName });
  return disp !== 'full'; // 'full' -> not consumed, listener falls through to notify
}

// ── Consent reflow (item 8) — thin wrappers; bodies live in session-consent.js ─
// openConsentWindow (trigger.handleTrigger, window-mode ON + pending row): open a
// pre-consent window that runs NO agent work until Accept. Budget-gate the shared cap
// here — session-consent cannot see the live sessions.
function openConsentWindow(spec) {
  if (!windowModeEnabled() || !windowFactory) return { skipped: 'disabled' };
  if (sessions.size + sessionConsent.count() >= MAX_WINDOWS) return { skipped: 'cap' };
  return sessionConsent.open({ ...spec, sessionId: crypto.randomUUID() });
}
function decideConsent(sender, decision) { // in-window Accept/Deny (session-ipc)
  return sessionConsent.decide(sender, decision);
}
function closeConsentWindow(watcherKey, decision) { // inboundDenied / inboundExpired
  return sessionConsent.close(watcherKey, decision);
}
function getConsentBySender(sender) {
  return sessionConsent.getBySender(sender);
}

// Startup: register the renderer->main IPC once (session-ipc), then settle any
// session that was live/awaiting when the app died — post the interrupted echo and,
// when the SDK session id survives, offer an opt-in resume. NEVER auto-reopens.
async function init() {
  sessionIpc.register({ getSessionBySender, getConsentBySender, dispatch, decideConsent });
  const records = store.loadRecords();
  for (const key of Object.keys(records)) {
    const rec = records[key];
    if (!rec || store.reloadDisposition(rec.phase) === 'ignore') continue;
    store.setRecordPhase(key, 'ended');
    runLifecycle({ channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId, side: rec.side, sessionId: rec.sessionId }, 'task_failed', { interrupted: true });
    const sdkId = store.getSdkSessionId(key);
    if (sdkId) offerResume(rec, sdkId);
  }
}

function offerResume(rec, sdkSessionId) {
  try {
    if (!Notification || (Notification.isSupported && !Notification.isSupported())) return;
    const n = new Notification({ title: 'Resume session', body: 'A Dopl session was interrupted. Click to resume it.' });
    n.on('click', () => {
      resume(rec, sdkSessionId).catch((err) => diag('session-engine: resume failed', err && err.message));
    });
    n.show();
  } catch (err) {
    diag('session-engine: offerResume failed', err && err.message);
  }
}

// Shared resume: reopen a settled task resuming its SDK session with a given first turn.
async function startResume(rec, sdkSessionId, rawFirstTurn) {
  if (!windowFactory || hasLiveSession({ channelId: rec.channelId, taskId: rec.taskId })) return false;
  let sdk;
  try { sdk = await getSdk(); } catch (_) { return false; }
  const s = await startSession({
    key: store.sessionKey(rec.channelId, rec.taskId),
    channelId: rec.channelId, taskId: rec.taskId, workspaceId: rec.workspaceId,
    side: rec.side, profile: rec.profile, mode: rec.mode,
    counterpartyId: rec.counterpartyId || null, // FIX L1: restore the counterparty binding
    context: {}, rawFirstTurn, resumeSdkId: sdkSessionId,
  }, sdk);
  return !!s;
}

async function resume(rec, sdkSessionId) { // opt-in resume from the interrupted notice
  const nudge = 'The session was resumed after an interruption. Continue where you left off and await the next channel reply.';
  return startResume(rec, sdkSessionId, nudge);
}

// Item 3 secondary: reopen a SETTLED requester (its sdkSessionId survived an idle/
// interrupt end), resuming with the peer's reply FRAMED — fresh nonce, words stay DATA,
// gated tools still gate on reopen (§H-4).
async function resumeRequesterForReply(rec, sdkSessionId, reply) {
  const firstTurn = io.frameContinuation(crypto.randomBytes(8).toString('hex'), reply && reply.message, reply && reply.authorName);
  return startResume(rec, sdkSessionId, firstTurn);
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
  feedInbound,
  resumeRequesterForReply, // item 3 secondary — bounded requester continuation
  openConsentWindow, // consent reflow (item 8) — called by trigger.js
  decideConsent,
  closeConsentWindow,
  getConsentBySender,
  listLiveSessions: sessionReopen.listLiveSessions, // reopen (item 10) — tray via index.js
  reopenWindow: sessionReopen.reopenWindow,
  reopenByTask: sessionReopen.reopenByTask, // item 2 — MAIN-window bridge (channel-dir-ipc)
};
