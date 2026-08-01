// session-shell.js — the engine's ELECTRON WINDOW PLUMBING.
//
// SPLIT NOTE (§2, 2026-07-31): extracted from session-engine.js, which sits at the 500-line
// cap and had just been edited by trimming a comment to buy the line back — the exact
// anti-pattern ENGINEERING.md names, for this exact file. This is the honest seam, and it is
// worth more than the lines: session-engine.js now imports NO electron at all. Its header
// always claimed the window is an injected factory and that it "reads electron only for
// Notification", and both drifted — `Notification` had become a dead import, and the
// hide-on-close handler read `require('electron').app` inline. Everything electron-shaped that
// is not the factory itself lives here now.
//
// WHAT THIS OWNS: how a session TALKS TO ITS WINDOW and how a window talks back.
//   - the replay wiring (the transcript ring survives a renderer reload)
//   - hide-on-close, so a closed LIVE window can be reopened from the tray
//   - render-process-gone, the crash signal
//   - the two window-only sends (the raw IPC push, and the resolved folder label)
// WHAT IT DOES NOT OWN: the reducer, the effect runner, and `emit` / `emitQuiet` themselves —
// those are the engine's, because the RESHOW rule is a policy about session state rather than
// about windows. They are injected, the same way session-park / session-gate / session-team
// take the engine's private handles. Nothing here requires the engine back, so no cycle.

const { app } = require('electron');
const replay = require('./session-replay');
const channelDirs = require('./channel-dirs');
const { diag } = require('./diag');

// The engine binds { dispatch, refreshTray, emit } at load; read at CALL time, so bind order
// at module load does not matter.
let deps = null;
function bind(d) {
  deps = d || null;
}

function safeSend(s, payload) {
  try { s.win.webContents.send('session:event', payload); }
  catch (err) { diag('session-shell: send failed', err && err.message); }
}

// Item 5/7: the REAL resolved folder LABEL (short-form, never the abs path §H-9).
function emitFolder(s) {
  try { deps.emit(s, { type: 'folder', label: channelDirs.resolvedDirLabel(s.channelId) }); } catch (_) { /* best effort */ }
}

function bindWindow(s) {
  const wc = s.win.webContents;
  // Item 3: the replay owns the transcript ring + sent cursor; a reload (did-start-loading rewinds,
  // did-finish-load re-sends) is NEITHER close nor crash below. C5: `init` is its sticky head.
  s.replay = replay.createReplay(wc, (p) => safeSend(s, p));
  wc.on('did-start-loading', s.replay.onReload);
  wc.on('did-finish-load', s.replay.onLoad);
  if (!wc.isLoading()) s.replay.onLoad();
  // Item 10: hide-on-close keeps a closed LIVE window's renderer + transcript for a tray reopen (destroyed only on settle); render-process-gone is the crash signal.
  s.win.on('close', (e) => {
    // Hide for a tray Reopen, but never veto during app Quit (or it can't exit).
    if (!s.settled && !app.isQuitting) {
      e.preventDefault();
      s.win.hide();
      s.windowHidden = true;
      deps.refreshTray();
    }
  });
  wc.on('render-process-gone', () => { if (!s.settled) deps.dispatch(s, { type: 'crash' }); });
}

module.exports = { bind, bindWindow, safeSend, emitFolder };
