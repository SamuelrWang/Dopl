// Pre-consent window core (v2.0 Session Window, Track T3).
//
// SECURITY (item 8 / §H-1): a pre-consent window runs NO SDK query, NO mcpServers,
// NO canUseTool, NO tool of any kind. It renders the request text (textContent, in
// the renderer) + Accept/Deny and holds the SAME durable consent row open. Accept
// only flips that row (consent.patchDecision 'allow') and pokes the watcher; the
// live session is started ELSEWHERE — the engine ADOPTS this window in
// launchResponderSession and calls startQuery there. `consentTransition` NEVER
// returns a start-query effect (asserted structurally in test/session-consent.test.mjs).
//
// The window handle lives here (a plain Map value); this module imports NO electron
// and never constructs a BrowserWindow — the engine injects the same window factory
// used for live sessions (session-window.createSessionWindow, loadFile-only). The
// pure BEGIN/END block below has no electron/SDK/fs refs, so the test slices it and
// evaluates it verbatim (the WATCHER-PURE idiom).

const store = require('./session-store');
const consent = require('./consent');
const watcher = require('./consent-watcher');
const channelDirs = require('./channel-dirs');
const replay = require('./session-replay');
const { diag } = require('./diag');

// ─── BEGIN SESSION-CONSENT (pure; unit-tested via source extraction) ──────────

// A pre-consent decision state. `pending` is the only non-terminal phase; accepted /
// denied / parked are terminal and every later event is an idempotent no-op so a
// second click (or a decision that already landed on another surface) does nothing
// — first-answer-wins across window / web / notification.
function initialConsentState() {
  return { phase: 'pending' };
}

// The consent decision core. From `pending`:
//   accept      -> accepted; effects [approve, emit consent_resolved:accepted]
//   deny        -> denied;   effects [decline]   (the window is closed by the
//                                                  inboundDenied resolver via close())
//   park/expire -> parked;   NO effects (the row stays pending — answerable later)
// From any terminal phase every event returns the state unchanged with no effects.
//
// NO-WORK-BEFORE-ACCEPT (§H-1): NO branch EVER returns a `startQuery` effect. Accept
// resolves ONLY to `approve` (flip the consent row + poke the watcher) and an emit;
// the SDK query is started later by the engine adopting the window, never here.
function consentTransition(state, event) {
  const phase = state && state.phase;
  const type = event && event.type;
  if (phase !== 'pending') return { state: state, effects: [] };
  if (type === 'accept') {
    return {
      state: { phase: 'accepted' },
      effects: [
        { type: 'approve' },
        { type: 'emit', payload: { type: 'consent_resolved', decision: 'accepted' } },
      ],
    };
  }
  if (type === 'deny') {
    return { state: { phase: 'denied' }, effects: [{ type: 'decline' }] };
  }
  if (type === 'park' || type === 'expire') {
    return { state: { phase: 'parked' }, effects: [] };
  }
  return { state: state, effects: [] };
}

// ─── END SESSION-CONSENT ──────────────────────────────────────────────────────

// After a terminal decision the window shows a brief note; linger before destroying
// it so the "Declined" / "Expired" note is actually visible.
const CLOSE_LINGER_MS = 2500;

const registry = new Map(); // sessionKey -> pending-consent entry
let windowFactory = null; // fn(sessionId) -> BrowserWindow (injected by the engine)

function setWindowFactory(fn) {
  windowFactory = typeof fn === 'function' ? fn : null;
}

function has(key) {
  return registry.has(key);
}
function count() {
  return registry.size;
}
function getBySender(sender) {
  if (!sender) return null;
  for (const e of registry.values()) {
    if (e.win && !e.win.isDestroyed() && e.win.webContents.id === sender.id) return e;
  }
  return null;
}
function getByWatcherKey(watcherKey) {
  for (const e of registry.values()) if (e.watcherKey === watcherKey) return e;
  return null;
}

// Item 3: every session:event flows through the shared transcript replay (session-
// replay.js) — it buffers before first load (the very first consent_request is never
// dropped) AND re-sends the whole [consent_request, folder, consent_resolved?] log on a
// Cmd-R reload, so a reloaded pre-consent window rebuilds instead of going blank.
function sendToEntry(e, payload) {
  if (!e.win || e.win.isDestroyed()) return;
  e.replay.deliver(payload);
}

// Open the pre-consent window. The engine gates the shared window budget first, so
// here we only mint the window, register the entry, and emit the request + folder.
function open(spec) {
  if (!windowFactory) return { skipped: 'disabled' };
  const key = store.sessionKey(spec.channelId, spec.taskId);
  if (registry.has(key)) return { skipped: 'exists' };
  let win;
  try {
    win = windowFactory(spec.sessionId || key);
    if (!win) throw new Error('window factory returned nothing');
  } catch (err) {
    diag('session-consent: window factory failed', err && err.message);
    return { skipped: 'no-window' };
  }
  const e = {
    key,
    watcherKey: spec.watcherKey,
    channelId: spec.channelId,
    taskId: spec.taskId,
    workspaceId: spec.workspaceId,
    rowId: spec.rowId,
    // F-118 / BLOCKER B-1: the entry deliberately carries NO display strings. It used to
    // keep the requester and channel names for the attended prefill; that prompt now takes
    // three ids and nothing else, and the names are peer-typed, so the entry does not hold
    // them either. They still reach the RENDERER below, where they are display data.
    win,
    cstate: initialConsentState(),
    replay: null, // item 3: set in bind() — the transcript ring + reload re-send
    decided: false,
    detach: null,
  };
  bind(e);
  registry.set(key, e);
  sendToEntry(e, {
    type: 'consent_request',
    requestId: spec.rowId,
    from: spec.requesterName || null,
    summary: spec.summary || null,
    bodyText: spec.bodyPreview || null,
    taskTitle: spec.taskTitle || null,
    channelName: spec.channelName || null,
    toolProfileLabel: spec.toolProfileLabel || null,
    cwdLabel: spec.cwdLabel || null,
  });
  // Item 5: the folder pill shows the REAL resolved dir, computed from spec.channelId
  // here (never null; "~/Downloads" default) so trigger.js stays untouched (§H-6).
  sendToEntry(e, { type: 'folder', label: channelDirs.resolvedDirLabel(spec.channelId) });
  return { ok: true };
}

function bind(e) {
  const wc = e.win.webContents;
  // Item 3: the shared replay owns the transcript ring + sent cursor. did-start-loading
  // (a reload) rewinds it; did-finish-load flushes everything unseen. Same discipline
  // as the engine — a reloaded consent window re-shows its request instead of blanking.
  e.replay = replay.createReplay(wc, (p) => { try { wc.send('session:event', p); } catch (err) { diag('session-consent: send failed', err && err.message); } });
  // OS close WITHOUT a decision is a PARK (item 8 step 7, mirrors the web "Dismiss
  // parks"): leave the row pending + the watcher record await-inbound so the request
  // stays answerable from web/notification until the 24h TTL. A DECIDED / adopted
  // entry was already removed, so this only fires on a genuine park.
  const onClose = () => {
    if (!e.decided) e.cstate = consentTransition(e.cstate, { type: 'park' }).state;
    registry.delete(e.key);
  };
  wc.on('did-start-loading', e.replay.onReload);
  wc.on('did-finish-load', e.replay.onLoad);
  if (!wc.isLoading()) e.replay.onLoad();
  e.win.on('close', onClose);
  e.detach = () => {
    try { wc.removeListener('did-start-loading', e.replay.onReload); } catch (_) { /* best effort */ }
    try { wc.removeListener('did-finish-load', e.replay.onLoad); } catch (_) { /* best effort */ }
    try { e.win.removeListener('close', onClose); } catch (_) { /* best effort */ }
  };
}

function runEffect(e, eff) {
  if (eff.type === 'approve') {
    consent.patchDecision(e.workspaceId, e.rowId, 'allow');
    watcher.poke(e.watcherKey);
  } else if (eff.type === 'decline') {
    consent.patchDecision(e.workspaceId, e.rowId, 'deny');
    watcher.poke(e.watcherKey);
  } else if (eff.type === 'emit') {
    sendToEntry(e, eff.payload);
  }
}

// The in-window Accept / Deny (item 8 steps 3 / 5). Resolve the entry from the
// window (never a payload id), run the pure transition, then execute its effects.
function decide(sender, decision) {
  const e = getBySender(sender);
  if (!e) return { ok: false };
  const { state, effects } = consentTransition(e.cstate, { type: decision === 'accept' ? 'accept' : 'deny' });
  e.cstate = state;
  e.decided = true;
  for (const eff of effects) runEffect(e, eff);
  return { ok: true };
}

// Adopt handoff (item 8 step 4): the engine reuses this window for the live session.
// Detach our listeners and drop the entry so the engine's bindWindow owns it cleanly
// (its close→hide + render-process-gone→crash replace our park-on-close).
function takeForAdopt(key) {
  const e = registry.get(key);
  if (!e) return null;
  e.decided = true; // suppress the park path during the handoff
  if (e.detach) e.detach();
  registry.delete(key);
  return { win: e.win };
}

// Terminal close (item 8 steps 5/6 — inboundDenied / inboundExpired): tell the
// renderer, then destroy the window after a short linger so the note is visible.
// No-op if the window was already adopted or parked (key not found).
function close(watcherKey, decision) {
  const e = getByWatcherKey(watcherKey);
  if (!e) return;
  e.decided = true;
  if (e.detach) e.detach();
  registry.delete(e.key);
  const resolved = decision === 'expired' ? 'expired' : 'denied';
  try {
    if (e.win && !e.win.isDestroyed()) e.win.webContents.send('session:event', { type: 'consent_resolved', decision: resolved });
  } catch (_) { /* window gone */ }
  const win = e.win;
  setTimeout(() => { try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) { /* best effort */ } }, CLOSE_LINGER_MS);
}

module.exports = {
  // pure core (also re-exported for the shell + tests)
  initialConsentState,
  consentTransition,
  // registry + window lifecycle
  setWindowFactory,
  open,
  decide,
  close,
  takeForAdopt,
  getBySender,
  has,
  count,
};
