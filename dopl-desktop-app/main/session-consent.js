// Pre-consent window core (v2.0 Session Window, Track T3).
//
// ⚠ NOT THE DEFAULT PATH ANY MORE (2026-08-18, wiring plan Phase 9 — "windowing
// inverts"). An inbound request no longer mints a window before anyone has looked at
// it: the notification fires, and clicking it FOCUSES the main app on the channel,
// where the Inbox's launch panel is the decision surface. The ONE gate is
// `main/settings.js › getPreConsentWindow()` (default OFF), read at the ONE call site,
// `main/trigger.js › handleTrigger`. Do not add a second gate here — a module that
// refuses on its own behalf is a second answer to the same question, and the C-9
// window-budget leak is what a divided answer costs.
//
// ⚠ THE CAPABILITY IS DELIBERATELY INTACT. Nothing in this file was removed or
// narrowed for the flip: the window factory, the adopt handoff, the arms, the linger
// and the release all behave exactly as they did, so opting back in restores the old
// path byte-for-byte — and Phase 10's opt-in pop-out is built on this machinery.
//
// SECURITY (item 8 / §H-1): a pre-consent window runs NO SDK query, NO mcpServers,
// NO canUseTool, NO tool of any kind. It renders the request text (textContent, in
// the renderer) + Accept/Deny and holds the SAME durable consent row open. Accept
// only flips that row (consent.submitDecision 'allow') and pokes the watcher; the
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
    // FIX 1 (2026-08-02) — THE POSTURE THE OPERATOR PICKS ON *THIS* CARD, before Accept.
    // The two selects in the pre-consent window were live the whole time and wired to
    // NOTHING: their IPC resolved from the live-session registry, which a consent window is
    // not in, so main answered {ok:false} and the preload dropped it. They land here now
    // (session-ipc falls back to this registry) and session-engine.startSession CONSUMES
    // this on adopt, so the spawn starts on the pair the human was looking at when they
    // clicked Accept. `null` = untouched, which is what keeps manual/ask the default.
    modes: null,
    // ...and the MODEL picked on this same card, by the same rule and for the same reason
    // (armModel / takeStartModel below). `null` = untouched, which keeps 'default'.
    model: null,
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

// F-067: the in-window Accept/Deny goes through submitDecision, so a PATCH that never
// lands re-notifies instead of leaving a closed window over a still-pending row. NO
// channelName is passed: the entry deliberately carries no display strings (F-118 /
// B-1 above — the names are peer-typed), and the copy degrades to the channel-less
// variant rather than reintroducing them here.
function runEffect(e, eff) {
  if (eff.type === 'approve') {
    consent.submitDecision(e.workspaceId, e.rowId, 'allow');
    watcher.poke(e.watcherKey);
  } else if (eff.type === 'decline') {
    consent.submitDecision(e.workspaceId, e.rowId, 'deny');
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

// FIX 1 — ARM the two axes on a PENDING card. session-ipc routes here when a mode change
// arrives from a window no live session owns, which during the consent phase is every one of
// them. This module is the only writer.
//
// BOTH AXES ARE ALWAYS STORED TOGETHER, the untouched one at its most restrictive member, so
// a half-set pair can never read as more permissive than it is. The values are coerced by the
// CALLER (session-ipc, against session-profiles' canonical tables, which is the same gate a
// live session's change passes) — this stores what it is handed and echoes it straight back
// to the card, so the select can only ever show a value main really recorded.
//
// A DECIDED (accepted / denied / parked / adopted) entry refuses: after Accept the posture is
// already being consumed by the spawn, so a late change would silently not apply. The refusal
// is what the renderer reverts on, which is FIX 2's whole point — the control never lies.
function armModes(e, axis, mode) {
  if (!e || e.decided) return null;
  const cur = e.modes || { tools: 'manual', messages: 'ask' };
  e.modes = axis === 'tools'
    ? { tools: mode, messages: cur.messages }
    : { tools: cur.tools, messages: mode };
  sendToEntry(e, { type: 'modes', tool: e.modes.tools, message: e.modes.messages });
  return { tools: e.modes.tools, messages: e.modes.messages };
}

// SINGLE USE, and scoped to the CONSENT ENTRY rather than to the channel. startSession calls
// this at its adopt site: the pair applies to the spawn this exact card approves and to
// nothing else, so a second request on the same channel — and every other agent of it — finds
// nothing. That is deliberately NOT another channel-keyed arm (channel-prefs.js): the arm
// dies with the card it was picked on, so there is no residue for a later launch to inherit
// and no shared key for N agents to race over.
function takeStartModes(key) {
  const e = registry.get(key);
  if (!e || !e.modes) return null;
  const modes = e.modes;
  e.modes = null;
  return modes;
}

// THE MODEL PICKED ON *THIS* CARD, before Accept. A SIBLING of armModes rather than a third
// member of its payload: the model is not a permission, so folding it into the pair that both
// axes travel as would have made a posture echo carry something that is not a posture, and a
// half-set pair would then have two different meanings. Everything else is identical — the
// value is coerced by the CALLER (session-ipc, against the frozen enum in session-model), it is
// echoed straight back so the select can only show what main recorded, and a DECIDED card
// refuses, which is what the renderer reverts on.
function armModel(e, model) {
  if (!e || e.decided) return null;
  e.model = model;
  sendToEntry(e, { type: 'model', choice: e.model });
  return { model: e.model };
}

// SINGLE USE and scoped to the CONSENT ENTRY, exactly like takeStartModes: the pick applies to
// the spawn this one card approves and to nothing else, so there is no channel-keyed residue
// for a later launch to inherit and no shared key for N agents to race over.
function takeStartModel(key) {
  const e = registry.get(key);
  if (!e || !e.model) return null;
  const model = e.model;
  e.model = null;
  return model;
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

// Drop an entry from the registry and take its window down after the linger. The ONE
// teardown, shared by the terminal close below and by `release` — a second copy is how the
// budget leak in C-9 stayed invisible: `decide()` marked the entry decided and every reader
// went on counting it.
function drop(e) {
  e.decided = true;
  if (e.detach) e.detach();
  registry.delete(e.key);
  const win = e.win;
  setTimeout(() => { try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) { /* best effort */ } }, CLOSE_LINGER_MS);
}

// Terminal close (item 8 steps 5/6 — inboundDenied / inboundExpired): tell the
// renderer, then destroy the window after a short linger so the note is visible.
// No-op if the window was already adopted or parked (key not found).
function close(watcherKey, decision) {
  const e = getByWatcherKey(watcherKey);
  if (!e) return;
  const resolved = decision === 'expired' ? 'expired' : 'denied';
  try {
    if (e.win && !e.win.isDestroyed()) e.win.webContents.send('session:event', { type: 'consent_resolved', decision: resolved });
  } catch (_) { /* window gone */ }
  drop(e);
}

// C-9 (2026-08-08) — RELEASE AN ACCEPTED ENTRY THAT NO SPAWN WILL EVER ADOPT.
//
// THE LEAK. `decide()` sets `decided` and leaves the entry in the registry, deliberately:
// the window is about to be reused, and `startSession`'s `takeForAdopt` is what removes it.
// But adoption happens ONLY on the branch where a live session really starts. Every other
// exit from `trigger.inboundApproved` left the entry behind forever — `{skipped:'busy'}`,
// `'auth-hold'`, `'cap'`, `'no-sdk'`, `'disabled'`, and the refetch's `gone`. `count()` feeds
// `atWindowCap` (sessions + open consent windows vs MAX_WINDOWS), so each leak permanently
// spent one of six slots; and `evictIdleShell` walks only the SESSION registry, so a leaked
// entry could not be reclaimed by the one mechanism that exists for exactly that. Six
// accepted requests that did not become sessions and the desktop opens nothing, ever again.
//
// THE FIX IS THE RELEASE, NOT A SWEEPER. A timer or an LRU over decided entries would be
// guessing at when the adopt is not coming; the caller KNOWS — it is holding the skip reason.
// So every terminal in trigger.js says so here, and `takeForAdopt` stays the one path that
// keeps the window alive.
//
// NO `consent_resolved` IS SENT. The card already painted "Accepted" when the operator
// clicked, and this is not a second decision: the request is being answered somewhere else
// (headlessly), or answered with a courtesy reply, or it is gone. Sending 'denied' here — the
// only other value `close` can express — would tell the operator their Accept was refused.
// Idempotent and safe on a key with no entry, so callers need no guard of their own.
function release(watcherKey, reason) {
  const e = getByWatcherKey(watcherKey);
  if (!e) return false;
  diag('session-consent: releasing an accepted entry no spawn adopted —', reason || 'unknown');
  drop(e);
  return true;
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
  release, // C-9: the window budget is given back on every terminal that is not an adopt
  armModes, // FIX 1: the pre-consent posture selects write here
  takeStartModes, // ...and startSession consumes it, once, on adopt
  armModel, // 2026-08-02: the pre-consent MODEL select, same entry, same single-use rule
  takeStartModel,
  takeForAdopt,
  getBySender,
  has,
  count,
};
