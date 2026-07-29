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
// The engine's runLifecycle hands a flat info object { channelId, taskId,
// workspaceId, side, sessionId }. postTaskEvent needs only channel.id, workspaceId,
// and a stable seq for the idempotent clientMsgId (it does NOT read channel.name),
// so the coupling is tiny: the taskId doubles as the seq component, giving a
// deterministic per-session id the server dedupes on a crash replay.
//
// I-LOW(b): this cross-user lifecycle dedupe is DELIBERATE — a crash echo, the
// reload interrupted-echo, and a double-end all collapse to ONE server row per
// (kind, channel, taskId) so the requester's card settles exactly once. Kept as-is.
function echoTargets(info) {
  const i = info || {};
  const seq = i.seq != null ? i.seq : (i.taskId || i.sessionId || 'session');
  return {
    entry: { channel: { id: i.channelId }, workspaceId: i.workspaceId },
    m: { seq },
    taskId: i.taskId || undefined,
  };
}

// task_started the instant the session's SDK system/init lands (§A.3 launched).
function onLaunched(info) {
  const { entry, m, taskId } = echoTargets(info);
  if (!entry.channel.id) return;
  Promise.resolve(postTaskEvent(entry, m, 'task_started', taskId))
    .catch((err) => diag('session onLaunched echo error', err && err.message));
}

// task_finished / task_failed when the session ends (End / close_task / crash). The
// engine is authoritative: it passes the resolved `kind` and the `extra` metadata
// (e.g. { interrupted:true }); idle/cost-cap ends leave the task open and never
// call this. We pass `kind`+`extra` straight through and derive the SAME generic
// body the headless echoes use for the matching flags (onInterrupted / inboundDenied)
// so the web renders the identical calm "Interrupted"/"Declined" state.
function onEnded(info, kind, extra) {
  const { entry, m, taskId } = echoTargets(info);
  if (!entry.channel.id) return;
  const meta = extra || {};
  const k = kind === 'task_failed' || kind === 'task_finished' ? kind : 'task_finished';
  const body = meta.interrupted ? 'Request interrupted' : meta.declined ? 'Request declined' : undefined;
  Promise.resolve(postTaskEvent(entry, m, k, taskId, meta, body))
    .catch((err) => diag('session onEnded echo error', err && err.message));
}

const lifecycleHandlers = { onLaunched, onEnded };

module.exports = { createSessionWindow, lifecycleHandlers };
