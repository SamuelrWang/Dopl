// Session window factory (v1.9 Session Window, Track T3).
//
// The session engine (T1) owns the SDK run and the IPC event stream but NEVER
// imports electron.BrowserWindow — index.js injects a window factory via
// sessionEngine.setWindowFactory (§B.5 seam). This module IS that factory. It is split
// out of index.js only to respect the §2 500-line cap.
//
// ⚠ THIS FILE IS UNREACHABLE AND IS BEING DELETED (F-228, INVARIANTS §11).
// `settings.getWindowMode()` answers false unconditionally, so `session-engine.js`
// refuses every non-windowless launch and nothing ever calls this factory. The lifecycle
// echo that used to share the file has already MOVED to `main/trigger-outcomes.js ›
// lifecycleHandlers` — see the note at the foot of this file.

const path = require('path');
const { BrowserWindow } = require('electron');

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

// ⚠ THE LIFECYCLE ECHO MOVED OUT ON 2026-08-20 — `main/trigger-outcomes.js ›
// lifecycleHandlers`. It was never about windows: it is the calm `task_progress`
// `session_ended` note that tells a WAITING PEER this machine stopped, a WINDOWLESS
// session raises it exactly as a windowed one did, and §11's quit guard depends on it.
// It lived here only because this file happened to be what index.js already handed to
// `setLifecycleHandlers`. Moved AHEAD of this file's deletion (F-228) so the deletion
// could not take peer notification with it.

module.exports = { createSessionWindow };
