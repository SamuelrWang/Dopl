// Session engine — the imperative shell (v2.0 Session Window, Track T3).
//
// Owns ONE Claude Agent SDK query() per live session and executes the pure session-reducer's
// side-effect-free effect descriptors. v2.0 added the CONSENT REFLOW (item 8: a pre-consent
// window that runs NO agent work until Accept, then launchResponderSession ADOPTS it) and
// REOPEN (item 10: live windows hide-on-close + reopen from the tray; render-process-gone is
// the crash signal). Renderer->main IPC lives in session-ipc.js (§O-8). SEAM: never imports
// electron.BrowserWindow (an injected factory creates windows); reads electron only for
// Notification. settingSources:[] on every session so the operator's global allow-list can
// never shadow a gated tool, and the dopl bearer stays inside the in-memory mcpServers
// object (never logged, never on argv).

const crypto = require('crypto');
const { Notification } = require('electron');
const { diag } = require('./diag');
const io = require('./session-io');
const store = require('./session-store');
const avatarCache = require('./avatar-cache');
const sessionReopen = require('./session-reopen');
const sessionPark = require('./session-park');
const framing = require('./prompt-framing');
const { apiFetch } = require('./api');
const { initialSessionState, sessionReducer, nextIdleMs } = require('./session-reducer');
const { buildSessionToolConfig } = require('./session-profiles');
const { getSdk, resolveClaudeExecutable, buildMcpServers, buildScrubbedEnv } = require('./sdk-loader');
const sessionConsent = require('./session-consent');
const sessionIpc = require('./session-ipc');
const channelDirs = require('./channel-dirs');
const replay = require('./session-replay');
const sessionGate = require('./session-gate'); // v2.5 D1: the inbound message gate
const sessionHistory = require('./session-history'); // v2.5 D3: reopened-shell history

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
  if (!settings) return {};
  return { turnCap: settings.getTurnCap(), idleMs: settings.getIdleTtlMs(), costCapUsd: settings.getCostCapUsd() };
}

// Rebuild the tray after a session is hidden / reopened / settled. Lazy-required so the
// engine holds no top-level tray dependency (tray requires nothing back).
function refreshTray() {
  try { require('./tray').refresh(); } catch (_) { /* tray optional */ }
}

// Park + resume machinery (session-park.js) is fed the engine handles it can't require
// (registry, SDK loader, buildSdkOptions — the v1.9 security path, NEVER duplicated — plus
// consume/dispatch/startSession/settle); hoisted, so bind order does not matter.
sessionPark.bind({
  sessions, getSdk, buildSdkOptions, consume, dispatch, startSession, hasLiveSession,
  emit, windowFactoryReady: () => !!windowFactory,
  atWindowCap: () => sessions.size + sessionConsent.count() >= MAX_WINDOWS, // FIX #4: shared window budget for recreateParkedShell
  loadHistory: sessionHistory.load, // D3: a recreated shell paints the channel history
  settleSession: settle, // FIX #7: LRU eviction of an untouched parked shell at the cap
});

// v2.5 D1/D3: same for the inbound gate + history loader (session-gate reaches
// session-park directly, so neither imports back into the engine).
sessionGate.bind({ sessions, dispatch });
sessionHistory.bind({ emit });

// Reopen helpers (session-reopen.js): live registry + tray refresh, plus the P2 fallback
// recreating a parked shell when no live session survives (item 2).
sessionReopen.bind({ sessions, refreshTray, recreateParkedShell: sessionPark.recreateParkedShell });

const baseRecord = io.baseRecord; // durable-record projection (session-io.js)

// FIX F1 (v2.7): dispatch REPORTS whether an effect resolved a LIVE canUseTool promise —
// resolvePerm is the only thing that knows (a park's denyPending may already have
// fail-closed this requestId, in which case there is nothing left to decide). session-ipc
// turns that verdict into the {ok} the renderer's optimistic stamp is gated on, exactly
// like the inbound gate's decideInbound; every other caller ignores the return.
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
    // FIX #9: a park saves the FULL record (cap counters); other flips set the phase only. The
    // EFFECT's phase is authoritative: s.state.phase can be 'awaiting_inbound' when a park
    // lands with a message still held (FIX #6), which would look LIVE on the next boot.
    case 'persist':
      if (eff.phase === 'parked') store.saveRecord({ ...baseRecord(s), phase: eff.phase });
      else store.setRecordPhase(s.key, eff.phase);
      break;
    case 'scheduleIdle': scheduleIdle(s); break;
    // FIX F1: the ONLY effect with a return value — did a live resolver really take it?
    case 'resolvePermission':
      return resolvePerm(s, eff.requestId, eff.decision);
    // io.withSeed gives the FIRST turn of a fresh (nothing-to-resume) shell its full framing
    // + the D3 history seed, exactly once; a normal turn passes straight through.
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
      // park's abort, so no live resolver dangles on a session that survives to resume.
      for (const resolve of s.pendingPermissions.values()) {
        try { resolve({ behavior: 'deny', message: 'Session paused' }); } catch (_) { /* best effort */ }
      }
      s.pendingPermissions.clear();
      s.pendingNames.clear();
      break;
    case 'clearIdle': if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; } break;
    case 'resumeQuery': sessionPark.resumeParked(s); break; // P1 lazy resume: the SAME object
    case 'lifecycle': runLifecycle(s, eff.kind, eff.extra, eff.body); break;
    case 'closeTask': closeChannelTask(s, eff.outcome, eff.summary); break;
    case 'settle': settle(s, eff.outcome); break;
    default: diag('session-engine: unknown effect', eff && eff.type);
  }
}

// A hidden window RESHOWS on anything that needs the operator: a gated tool request (item
// 10), a `counterparty` reply (v2.2 item 3), a HELD inbound message (v2.5 D1), or an
// outbound post awaiting Send / Deny on its inline card (v2.7 L3). Surfacing a window runs
// NO gated tool. Emits ride the replay.
const RESHOW_TYPES = new Set(['permission_request', 'counterparty', 'inbound_pending', 'outbound_gate']);
function emit(s, payload) {
  if (!s.win || s.win.isDestroyed()) return;
  if (s.windowHidden && payload && RESHOW_TYPES.has(payload.type)) {
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

// Item 5/7: the REAL resolved folder LABEL (short-form, never the abs path §H-9).
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

// Returns TRUE only when a live awaited resolver was actually taken (FIX F1): no resolver
// means the request is already decided (a park deny-closed it) and the caller must NOT
// report success — a renderer that believed a blanket {ok:true} stamped a denied post 'sent'.
function resolvePerm(s, requestId, decision) {
  const resolve = s.pendingPermissions.get(requestId);
  if (!resolve) return false;
  s.pendingPermissions.delete(requestId);
  s.pendingNames.delete(requestId);
  // FIX M1: FAIL CLOSED — ALLOW only on an explicit 'allow' (the reducer maps
  // allow-once/allow-task -> 'allow'); anything else, unknown included, denies.
  resolve(decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied by operator' });
  return true;
}

function runLifecycle(s, kind, extra, body) {
  const info = { channelId: s.channelId, taskId: s.taskId, workspaceId: s.workspaceId, side: s.side, sessionId: s.sessionId, key: s.key, sdkSessionId: s.sdkSessionId }; // FIX #2: key+sdkSessionId (cycle) -> echoTargets dedup
  try {
    if (kind === 'task_started') {
      if (lifecycle.onLaunched) lifecycle.onLaunched(info);
    } else if (lifecycle.onEnded) {
      // P3: `body` is the calm one-liner a capped/ended lifecycle carries (undefined ->
      // the handler derives one from the metadata flags).
      lifecycle.onEnded(info, kind, extra || {}, body);
    }
  } catch (err) {
    diag('session-engine: lifecycle handler error', err && err.message);
  }
}

// The DB status flip for a first-class task (op:"close"); the task_finished/failed message
// echo is separate (runLifecycle). No-op when there is no task id.
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

// Terminal: drop the live handles, mark the record ended, DESTROY the window (item 10 hid it
// until here), free the registry slot. A DONE task drops the resume map entry; every other
// end KEEPS the sdkSessionId — what makes FIX #7's shell eviction lossless.
function settle(s, outcome) {
  if (s.settled) return;
  s.settled = true;
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
  store.saveRecord(baseRecord(s)); // FIX #9: full record (phase 'ended') persists cap counters for a P2 rehydrate
  if (outcome === 'completed' || outcome === 'failed') store.clearSdkSessionId(s.key);
  sessions.delete(s.key);
  if (s.win && !s.win.isDestroyed()) { try { s.win.destroy(); } catch (_) { /* best effort */ } }
  refreshTray();
}

function bindWindow(s) {
  const wc = s.win.webContents;
  // Item 3: the replay owns the transcript ring + sent cursor. A reload (did-start-loading
  // rewinds, did-finish-load re-sends) is NEITHER close nor crash below.
  s.replay = replay.createReplay(wc, (p) => safeSend(s, p));
  wc.on('did-start-loading', s.replay.onReload);
  wc.on('did-finish-load', s.replay.onLoad);
  if (!wc.isLoading()) s.replay.onLoad();
  // Item 10: hide-on-close keeps a closed LIVE window's renderer + transcript for a tray
  // reopen (destroyed only on settle); render-process-gone is the crash signal.
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
    // Item 7: the per-channel folder (else ~/Downloads) as the SDK cwd. Context (§H-9), not a fence.
    cwd: channelDirs.sessionSpawnDir(s.channelId),
    allowedTools: cfg.preApproved, // pre-approved => SHADOWED, no button (§A.5)
    disallowedTools: cfg.disallowedTools,
    mcpServers: buildMcpServers(cfg.doplToolsPolicy),
    settingSources: [], // ALWAYS — the global allow-list can never shadow a gate
    permissionMode: 'default', // FIX M2: pin — bypass/acceptEdits/dontAsk short-circuit canUseTool
    env: buildScrubbedEnv(), // FIX M2: strip permission-mode env knobs, keep auth (sdk-loader)
    canUseTool: io.makeCanUseTool(s, dispatch),
    abortController: s.abortController,
    // LOAD-BEARING for v2.7 L3 (FIX F4): the outbound card shows the operator the bytes a
    // post is about to send, so the streamed tool_use input must be the WHOLE, FINAL input.
    // `includePartialMessages: false` keeps fragments off the card, and NO `hooks` option is
    // ever set (a PreToolUse hook could rewrite the input after the card painted it, so the
    // approved surface would stop matching what runs). The card re-asserts its body from the
    // canUseTool input as a belt; these two keep the stream-time paint honest as well.
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
    // FIX #1b: `q` tags this loop; a park->resume swaps s.query, so s.query !== q => SUPERSEDED (ignore its tail + late rejection).
    for await (const msg of q) { if (s.query !== q) return; io.handleSdkMessage(s, msg, dispatch, store); }
  } catch (err) {
    if (s.query !== q) return;
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
function setLifecycleHandlers(h) {
  lifecycle = { onLaunched: h && h.onLaunched, onEnded: h && h.onEnded };
}

// Build the session object, open (or ADOPT) its window, start the query (launch + resume).
// The per-session nonce is minted HERE so the first turn's fence + every fed-inbound
// continuation share the SAME token (else injected content forges it).
async function startSession(spec, sdk) {
  const sessionId = crypto.randomUUID();
  const nonce = crypto.randomBytes(8).toString('hex');
  const state = initialSessionState({ mode: spec.mode, side: spec.side, ...readCaps() });
  // P2: a reopen fallback opens a PARKED SHELL — a live window, NO SDK query yet. It boots
  // parked so a lazy wake (P1) resumes it; baseRecord persists s.state.phase = 'parked'.
  if (spec.parkedShell) { state.phase = 'parked'; state.parked = true; state.activity = 'parked'; state.turns = Number(spec.turns) || 0; state.costUsd = Number(spec.costUsd) || 0; } // FIX #9: P2 shell rehydrates the cap budget
  const firstTurn = spec.parkedShell ? ''
    : spec.rawFirstTurn ? spec.rawFirstTurn
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
    // FIX F2/F3: a parked shell with NOTHING to resume starts a BRAND-NEW sdk session and
    // buildSdkOptions sets no system prompt, so its first turn must carry the full v1.9 framing
    // (role, SECURITY RULES, delivery instruction; without it the agent answers in the window and
    // the peer gets nothing). `freshFraming` is the ONE-SHOT marker io.withSeed consumes,
    // `freshRun` the stable twin session-history reads.
    freshRun: spec.parkedShell === true && !spec.resumeSdkId,
    freshFraming: spec.parkedShell === true && !spec.resumeSdkId,
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
  // P2: a parked shell starts NO query — session-park paints the header/note and it waits
  // for a lazy wake. Everything else launches (or resumes) its SDK query now.
  if (spec.parkedShell) { sessionPark.emitParkedShell(s); return s; }
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
  if (hasLiveSession({ channelId: a.channelId, taskId: a.taskId })) return { skipped: 'busy' }; // FIX #7: re-check after await — do not overwrite a racing creator's session
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

// FIX L1: the counterparty whose replies this session may consume; the listener checks it
// before feeding, so a third party can never inject a turn.
function counterpartyFor(a) {
  const s = sessions.get(store.sessionKey(a.channelId, a.taskId));
  return s && !s.settled ? (s.counterpartyId || null) : null;
}

// The inbound gate lives in session-gate.js (v2.5 D1): feedInbound (live or parked) and
// feedInboundForTask (recreate the shell first) both HOLD the turn for an operator Accept
// unless auto-approve / the standing task grant is on. Re-exported below.
// ── Consent reflow (item 8) — thin wrappers; bodies live in session-consent.js. This one
// opens a pre-consent window (trigger.handleTrigger, window-mode ON + a pending row) that
// runs NO agent work until Accept; the shared cap is gated HERE because session-consent
// cannot see the live sessions.
function openConsentWindow(spec) {
  if (!windowModeEnabled() || !windowFactory) return { skipped: 'disabled' };
  if (sessions.size + sessionConsent.count() >= MAX_WINDOWS) return { skipped: 'cap' };
  return sessionConsent.open({ ...spec, sessionId: crypto.randomUUID() });
}
// decideConsent / closeConsentWindow / getConsentBySender are pass-throughs (re-exported
// verbatim below); resume machinery (offerResume/startResume/resume) lives in session-park.
// init(): register the renderer->main IPC once (session-ipc), then settle any session that was
// live/awaiting when the app died — post the interrupted echo and, when the SDK session id
// survives, offer an opt-in resume. NEVER auto-reopens.
async function init() {
  sessionIpc.register({ getSessionBySender, getConsentBySender: sessionConsent.getBySender, dispatch, decideConsent: sessionConsent.decide });
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
  feedInbound: sessionGate.feedInbound, // v2.5 D1 — the inbound gate (live or parked)
  feedInboundForTask: sessionGate.feedInboundForTask, // v2.5 D1 — gate + recreate the shell
  openConsentWindow, // consent reflow (item 8) — called by trigger.js
  decideConsent: sessionConsent.decide,
  closeConsentWindow: sessionConsent.close,
  getConsentBySender: sessionConsent.getBySender,
  listLiveSessions: sessionReopen.listLiveSessions, // reopen (item 10) — tray via index.js
  reopenWindow: sessionReopen.reopenWindow,
  reopenByTask: sessionReopen.reopenByTask, // item 2 — MAIN-window bridge (channel-dir-ipc)
};
