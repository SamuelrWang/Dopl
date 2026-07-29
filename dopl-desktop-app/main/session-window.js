// Session window factory + lifecycle echoes (v1.9 Session Window, Track T3).
//
// The session engine (T1) owns the SDK run and the IPC event stream but NEVER
// imports electron.BrowserWindow — index.js injects a window factory via
// sessionEngine.setWindowFactory (§B.5 seam). This module IS that factory plus the
// two lifecycle-echo handlers the engine calls (onLaunched/onEnded), which post the
// task_started / task_finished / task_failed channel events through the EXISTING
// channel-post.postTaskEvent so the web session-card story stays byte-for-byte
// coherent with today (§A.3). It is split out of index.js only to respect the §2
// 500-line cap; index.js still owns the wiring (setWindowFactory + setLifecycle
// handlers + init, before listener.start).

const path = require('path');
const { BrowserWindow } = require('electron');
const { postTaskEvent } = require('./channel-post');
const { diag } = require('./diag');

// A NEW LOCAL surface (§A.4 / A.6): loadFile ONLY (never a remote URL),
// contextIsolation + sandbox + nodeIntegration:false, the dedicated session
// preload as the ENTIRE privileged bridge. The sessionId rides as a query param the
// preload reads; the main side re-derives it authoritatively from event.sender, so a
// forged id can never target another session. Light-only background (no theme logic).
function createSessionWindow(sessionId) {
  const win = new BrowserWindow({
    // Item 7 (v2.2): default window size = the MIN size, so the window opens at its
    // most compact footprint and the operator grows it only when they want to.
    width: 520,
    height: 600,
    minWidth: 520,
    minHeight: 600,
    title: 'Dopl Session',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/session/session-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/session/session.html'), {
    query: { sid: String(sessionId == null ? '' : sessionId) },
  });
  win.once('ready-to-show', () => win.show());

  // Defense in depth on top of the page CSP: this window is NEVER a general browser.
  // Deny every window.open and block any navigation away from the local file. v2.0
  // item 10: the engine binds close -> HIDE (a live session's window is kept alive for
  // a tray reopen, destroyed only on settle) and render-process-gone -> crash (the
  // real interrupt signal, task stays resumable). A pre-consent window (session-
  // consent.js) instead PARKS on close — the request stays answerable elsewhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!String(url).startsWith('file://')) event.preventDefault();
  });

  return win;
}

// ── Lifecycle echoes (engine → channel) ──────────────────────────────────────
// The engine's runLifecycle hands a flat info object { channelId, taskId, workspaceId,
// side, sessionId, key, sdkSessionId }. postTaskEvent needs only channel.id, workspaceId,
// and a `seq` for the idempotent clientMsgId `${kind}-${channelId}-${seq}` (it does NOT
// read channel.name), so the coupling is tiny.
//
// ─── BEGIN SESSION-WINDOW-PURE (echo-id derivation; unit-tested via source extraction) ──
//
// FIX #2: `seq` folds a per-resume-CYCLE discriminator into a STABLE base, so a NEW cycle
// (a park->resume or a P2 recreate) posts a NEW server row while a RETRY within one cycle
// still collapses to one (the server dedupes on the identical clientMsgId).
//   base  = the first-class taskId, else the STABLE sessionKey (channelId:taskId) — never
//           the per-launch ephemeral sessionId, so a P2 recreate (fresh sessionId, same
//           key) can't post under a different id.
//   cycle = the SDK session id (a resumed query mints a fresh one at its own system/init),
//           falling back to the per-object sessionId for a PRE-INIT crash so two distinct
//           cycles that both die before init still get distinct rows.
// The DELIBERATE same-cycle dedupe (I-LOW(b)) is preserved: a crash echo and the reload
// interrupted-echo share one cycle's sdk id, so they still collapse to ONE server row.
function echoSeq(info) {
  const i = info || {};
  if (i.seq != null) return i.seq;
  const base = i.taskId || i.key || i.sessionId || 'session';
  const cycle = i.sdkSessionId || i.sessionId || 'init';
  return base + '#' + cycle;
}
function echoTargets(info) {
  const i = info || {};
  return {
    entry: { channel: { id: i.channelId }, workspaceId: i.workspaceId },
    m: { seq: echoSeq(i) },
    taskId: i.taskId || undefined,
  };
}
// ─── END SESSION-WINDOW-PURE ──────────────────────────────────────────────────────────

// task_started the instant the session's SDK system/init lands (§A.3 launched).
function onLaunched(info) {
  const { entry, m, taskId } = echoTargets(info);
  if (!entry.channel.id) return;
  Promise.resolve(postTaskEvent(entry, m, 'task_started', taskId))
    .catch((err) => diag('session onLaunched echo error', err && err.message));
}

// task_finished / task_failed when the session ends (End / cap / close_task / crash).
// The engine is authoritative: it passes the resolved `kind`, the `extra` metadata (e.g.
// { interrupted:true }), and — for P3 (v1.7.4) — an explicit calm `bodyOverride`. IDLE
// no longer calls this at all (it parks). The turn/cost caps ride { capped:true } and
// the operator End rides { ended:true }, so the web renders a calm terminal state
// (P4) exactly like the interrupted/declined echoes; the task stays OPEN (no closeTask).
// `bodyOverride` wins; else we derive a generic body from the metadata flags.
function onEnded(info, kind, extra, bodyOverride) {
  const { entry, m, taskId } = echoTargets(info);
  if (!entry.channel.id) return;
  const meta = extra || {};
  const k = kind === 'task_failed' || kind === 'task_finished' ? kind : 'task_finished';
  const body = bodyOverride
    || (meta.interrupted ? 'Request interrupted'
      : meta.declined ? 'Request declined'
        : meta.capped ? 'Limit reached'
          : meta.ended ? 'Session ended'
            : undefined);
  Promise.resolve(postTaskEvent(entry, m, k, taskId, meta, body))
    .catch((err) => diag('session onEnded echo error', err && err.message));
}

const lifecycleHandlers = { onLaunched, onEnded };

module.exports = { createSessionWindow, lifecycleHandlers };
