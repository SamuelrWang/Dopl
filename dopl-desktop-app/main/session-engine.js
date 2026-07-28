// Session engine — the imperative shell (v1.9 Session Window, Track T1).
//
// Owns ONE Claude Agent SDK query() per live session (research §8): a push-based
// AsyncIterable prompt (steering + fed inbound replies), the canUseTool permission
// bridge, the SDK-event -> IPC stream, and the (channelId,taskId) registry with the
// turn/idle/cost caps. ALL decisions delegate to the pure session-reducer; this
// module only executes the reducer's side-effect-free effect descriptors.
//
// SEAM (contract §B.1/§B.5): this module NEVER imports electron.BrowserWindow — the
// window is created by an injected factory (index.js owns creation, T3). It reads
// electron ONLY for ipcMain (renderer->main) and Notification (the opt-in resume
// affordance). Lifecycle echoes (task_started/finished/failed) are handed to T3's
// onLaunched/onEnded handlers, which post them via channel-post.postTaskEvent — the
// engine never builds that message itself.
//
// The dopl bearer stays inside the in-memory mcpServers object (sdk-loader); it is
// never logged or placed on argv (§H-7). settingSources:[] on every session so the
// operator's global allow-list can never shadow a gated tool (§A.5).

const crypto = require('crypto');
const { ipcMain, Notification } = require('electron');
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const framing = require('./prompt-framing');
const { apiFetch } = require('./api');
const { initialSessionState, sessionReducer, nextIdleMs } = require('./session-reducer');
const { buildSessionToolConfig } = require('./session-profiles');
const { getSdk, resolveClaudeExecutable, buildMcpServers, buildScrubbedEnv } = require('./sdk-loader');

// settings.js (T3) owns the window-mode switch + caps (a thin electron-store
// module); require defensively so the engine still loads if it is momentarily
// absent (unit/E2E harnessing), defaulting to window-mode ON.
let settings = null;
try { settings = require('./settings'); } catch (_) { /* absent -> defaults (window-mode ON) */ }
const MAX_WINDOWS = (settings && settings.MAX_SESSION_WINDOWS) || 6;

// ── Module state ─────────────────────────────────────────────────────────────
const sessions = new Map(); // sessionKey -> live session object (in-memory only)
let windowFactory = null; // fn(sessionId) -> BrowserWindow (injected by index.js)
let lifecycle = { onLaunched: null, onEnded: null };
let ipcBound = false;

function windowModeEnabled() {
  return settings ? settings.getWindowMode() : true;
}
function readCaps() {
  if (!settings) return {};
  return {
    turnCap: settings.getTurnCap(),
    idleMs: settings.getIdleTtlMs(),
    costCapUsd: settings.getCostCapUsd(),
  };
}

// The durable-record projection (io.baseRecord), the canUseTool bridge
// (io.makeCanUseTool), and the SDK-message->event mapping (io.handleSdkMessage)
// live in session-io.js (the pre-authorized §E split); the engine calls them with
// its own `dispatch` + the store injected.
const baseRecord = io.baseRecord;

// ── Reducer plumbing ─────────────────────────────────────────────────────────
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
      try {
        if (s.query && s.query.interrupt) s.query.interrupt().catch(() => {});
      } catch (_) { /* best effort */ }
      break;
    case 'abortQuery':
      try {
        if (s.abortController) s.abortController.abort();
      } catch (_) { /* best effort */ }
      try {
        if (s.pushIterator) s.pushIterator.close();
      } catch (_) { /* best effort */ }
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

// ── Effect executors ─────────────────────────────────────────────────────────
// Emit to the renderer, buffering until the page has finished loading so the very
// first `init` event is never dropped by a not-yet-attached onEvent listener.
function emit(s, payload) {
  if (!s.win || s.win.isDestroyed()) return;
  if (s.loaded) safeSend(s, payload);
  else s.emitQueue.push(payload);
}
function safeSend(s, payload) {
  try {
    s.win.webContents.send('session:event', payload);
  } catch (err) {
    diag('session-engine: send failed', err && err.message);
  }
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
  const info = {
    channelId: s.channelId,
    taskId: s.taskId,
    workspaceId: s.workspaceId,
    side: s.side,
    sessionId: s.sessionId,
  };
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

// The DB status flip for a first-class task (op:"close"). The task_finished/failed
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

// Terminal: drop the live handles, mark the record ended, and free the registry
// slot. A task that is actually DONE (close_task completed/failed) also drops the
// resume map entry; every other end (operator End / idle / cost / crash) KEEPS the
// sdkSessionId so the interrupted session stays resumable (§A.8).
function settle(s, outcome) {
  if (s.settled) return;
  s.settled = true;
  if (s.idleTimer) {
    clearTimeout(s.idleTimer);
    s.idleTimer = null;
  }
  store.setRecordPhase(s.key, 'ended');
  if (outcome === 'completed' || outcome === 'failed') store.clearSdkSessionId(s.key);
  sessions.delete(s.key);
}

// ── Window binding ───────────────────────────────────────────────────────────
function bindWindow(s) {
  const wc = s.win.webContents;
  s.emitQueue = [];
  s.loaded = false;
  const flush = () => {
    s.loaded = true;
    const q = s.emitQueue;
    s.emitQueue = [];
    for (const p of q) safeSend(s, p);
  };
  wc.on('did-finish-load', flush);
  if (!wc.isLoading()) flush();
  s.win.on('closed', () => {
    // The window vanished (crash or operator close). If the session had not
    // already settled, treat it as an interrupted crash (posts the same
    // task_failed{interrupted:true} echo the reload path posts).
    if (!s.settled) dispatch(s, { type: 'crash' });
  });
}

// ── SDK query start ──────────────────────────────────────────────────────────
function buildSdkOptions(s) {
  const cfg = buildSessionToolConfig(s.profile);
  const options = {
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

// ── IPC (renderer -> main; sessionId bound from the window, never trusted) ─────
function ensureIpc() {
  if (ipcBound) return;
  ipcBound = true;
  ipcMain.handle('session:send', (e, p) => withSession(e, (s) => dispatch(s, { type: 'steer', text: String((p && p.text) || ''), priority: p && p.priority })));
  ipcMain.handle('session:permission', (e, p) => withSession(e, (s) => dispatch(s, {
    type: 'permission_decision',
    requestId: p && p.requestId,
    decision: p && p.decision,
    name: s.pendingNames.get(p && p.requestId),
  })));
  ipcMain.handle('session:release-inbound', (e) => withSession(e, (s) => {
    const pend = io.shiftInbound(s);
    if (!pend) return;
    dispatch(s, { type: 'inbound_released', message: pend.message, authorName: pend.authorName });
    const next = s.pendingInbound[0]; // I-LOW(a): surface the next held reply, if any
    if (next) dispatch(s, { type: 'inbound_arrived', pendingId: next.pendingId, message: next.message, authorName: next.authorName });
  }));
  ipcMain.handle('session:interrupt', (e) => withSession(e, (s) => dispatch(s, { type: 'interrupt' })));
  ipcMain.handle('session:end', (e) => withSession(e, (s) => dispatch(s, { type: 'end' })));
  ipcMain.handle('session:close-task', (e, p) => withSession(e, (s) => dispatch(s, { type: 'close_task', outcome: p && p.outcome, summary: p && p.summary })));
}
function withSession(e, fn) {
  const s = sessionByWebContents(e && e.sender);
  if (!s) return { ok: false };
  try {
    fn(s);
  } catch (err) {
    diag('session-engine: ipc handler error', err && err.message);
  }
  return { ok: true };
}
function sessionByWebContents(sender) {
  if (!sender) return null;
  for (const s of sessions.values()) {
    if (s.win && !s.win.isDestroyed() && s.win.webContents.id === sender.id) return s;
  }
  return null;
}

// ── Public API (frozen §B.5) ─────────────────────────────────────────────────
function setWindowFactory(fn) {
  windowFactory = typeof fn === 'function' ? fn : null;
}
function setLifecycleHandlers(handlers) {
  lifecycle = {
    onLaunched: handlers && handlers.onLaunched,
    onEnded: handlers && handlers.onEnded,
  };
}

// Build the in-memory session object, open its window, and start the query. Shared
// by launch (a fresh nonce-fenced first turn) and resume (options.resume + a
// trusted continuation nudge). The per-session nonce is minted HERE so the first
// turn's fence and every fed-inbound continuation share the SAME unpredictable
// token — a placeholder nonce would let injected content in the first (untrusted)
// turn forge the fence.
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
    mode: state.mode,
    counterpartyId: spec.counterpartyId || null, // FIX L1: the task's other party
    state,
    context: spec.context || {},
    nonce,
    firstTurn,
    resumeSdkId: spec.resumeSdkId || null,
    startedAt: Date.now(),
    lastTotalCost: 0,
    pendingPermissions: new Map(),
    pendingNames: new Map(),
    pendingInbound: [], // I-LOW(a): bounded FIFO of held interactive inbound replies
    idleTimer: null,
    settled: false,
    win: null,
    query: null,
    abortController: null,
    pushIterator: null,
  };
  sessions.set(s.key, s);
  store.saveRecord(baseRecord(s)); // phase 'launching' until system/init flips it
  try {
    s.win = windowFactory(sessionId);
    if (!s.win) throw new Error('window factory returned nothing');
  } catch (err) {
    sessions.delete(s.key);
    diag('session-engine: window factory failed', err && err.message);
    return null;
  }
  bindWindow(s);
  ensureIpc();
  await startQuery(s, sdk);
  return s;
}

async function launch(a) {
  if (!windowModeEnabled() || !windowFactory) return { skipped: 'disabled' };
  const key = store.sessionKey(a.channelId, a.taskId);
  if (hasLiveSession({ channelId: a.channelId, taskId: a.taskId })) return { skipped: 'busy' };
  if (sessions.size >= MAX_WINDOWS) return { skipped: 'cap' };
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

// The two entry points differ only in `side` + which field carries the first turn;
// everything else (incl. FIX L1's counterpartyId) rides through on `...a`.
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

// FIX L1: the member whose channel replies this live session is allowed to consume
// as turns (its counterparty — the task's other party). The listener checks the
// inbound author against this before feeding, so a THIRD party posting in the same
// channel can never inject a turn into someone else's task loop.
function counterpartyFor(a) {
  const s = sessions.get(store.sessionKey(a.channelId, a.taskId));
  return s && !s.settled ? (s.counterpartyId || null) : null;
}

function feedInbound(a) {
  const s = sessions.get(store.sessionKey(a.channelId, a.taskId));
  if (!s || s.settled) return false;
  const item = { pendingId: crypto.randomUUID(), message: a.message, authorName: a.authorName };
  const disp = io.queueInbound(s, item, s.state.mode === 'interactive'); // I-LOW(a): don't overwrite a held reply
  if (disp === 'dispatch') dispatch(s, { type: 'inbound_arrived', pendingId: item.pendingId, message: a.message, authorName: a.authorName });
  return disp !== 'full'; // 'full' -> not consumed, listener falls through to notify
}

// Startup: settle any session that was live/awaiting when the app died (§A.8). Post
// the interrupted echo (so the requester's web card stops pulsing) and, when the
// SDK session id survives, offer an opt-in "Resume session" notification. NEVER
// auto-reopens a window or auto-continues a loop.
async function init() {
  ensureIpc();
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

async function resume(rec, sdkSessionId) {
  if (!windowFactory || hasLiveSession({ channelId: rec.channelId, taskId: rec.taskId })) return;
  let sdk;
  try {
    sdk = await getSdk();
  } catch (_) {
    return;
  }
  const nudge = 'The session was resumed after an interruption. Continue where you left off and await the next channel reply.';
  await startSession({
    key: store.sessionKey(rec.channelId, rec.taskId),
    channelId: rec.channelId,
    taskId: rec.taskId,
    workspaceId: rec.workspaceId,
    side: rec.side,
    profile: rec.profile,
    mode: rec.mode,
    counterpartyId: rec.counterpartyId || null, // FIX L1: restore the counterparty binding
    context: {},
    rawFirstTurn: nudge,
    resumeSdkId: sdkSessionId,
  }, sdk);
}

module.exports = {
  init,
  setWindowFactory,
  setLifecycleHandlers,
  launchResponderSession,
  launchRequesterSession,
  hasLiveSession,
  counterpartyFor,
  feedInbound,
};
