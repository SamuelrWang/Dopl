// Which shell is the main window — the bundled SPA (default since 1.8.0) or
// the retired remote wrapper (DOPL_UI=remote, the rollback path) — and the
// helpers every "make/show/navigate the window" call site must go through.
// Calling createMainWindow directly resurrects the remote shell in SPA mode
// (fleet audit 2026-08-03, high): dock activate, tray show and notification
// clicks all recreated the wrong window.
//
// State stays in index.js; this module is given accessors, never the
// variables. `deps`:
//   getMainWindow()/setMainWindow(win)  — the one main-window slot
//   createMainWindow(opts)              — the legacy remote factory
//   createSpaWindow()                   — the bundled factory
//   getLoadGuard()                      — remote mode's load guard (or null)
//   showMainWindow()                    — reveal/recreate (calls back in)
//   appOrigin, diag

function isSpaMode() {
  return process.env.DOPL_UI !== 'remote';
}

function makeShellHelpers(deps) {
  function createShellWindow(opts = {}) {
    if (isSpaMode()) {
      const win = deps.createSpaWindow();
      deps.setMainWindow(win);
      win.on('closed', () => deps.setMainWindow(null));
      if (opts.show !== false) win.show();
      return win;
    }
    return deps.createMainWindow(opts);
  }

  // Feature B: a clicked channel notification opens the app and navigates to
  // that workspace's Channels page. SPA mode: the renderer owns routing, so
  // main sends a navigate event over the bridge (GAP-16's other half);
  // remote mode keeps the loadGuard URL load.
  function navigateToChannels(segment) {
    deps.showMainWindow();
    const win = deps.getMainWindow();
    if (!segment || !win || win.isDestroyed()) return;
    if (isSpaMode()) {
      try {
        win.webContents.send('dopl:navigate', { path: `/${segment}/channels` });
      } catch (err) { deps.diag('navigate event failed', err && err.message); }
      return;
    }
    const guard = deps.getLoadGuard();
    if (guard) guard.load(`${deps.appOrigin}/${segment}/channels`);
  }

  return { createShellWindow, navigateToChannels };
}

// The whenReady SPA-mode service wiring: bridge registration, auth-state
// fan-out (stop the sync feed on sign-out, restart + rotate on sign-in),
// and the ui-sync start. `deps` adds: uiBridge, authTokens, uiSync,
// broadcastTo() → the live window.
function wireSpaServices(deps) {
  const startUiSync = () =>
    deps.uiSync.start({ getWindow: deps.getMainWindow, getAccessToken: deps.authTokens.getAccessToken });
  deps.uiBridge.register({ getMainWindow: deps.getMainWindow });
  deps.authTokens.subscribe((state) => {
    try { deps.uiBridge.broadcastAuthState(deps.getMainWindow(), state); } catch (_err) { /* window gone */ }
    const status = state && state.status;
    if (status === 'signed-out') { try { deps.uiSync.stop(); } catch (_err) { /* not started */ } }
    if (status === 'signed-in') {
      try { startUiSync(); } catch (err) { deps.diag('ui-sync restart error', err && err.message); }
      try { deps.uiSync.refreshAuth(); } catch (err) { deps.diag('ui-sync auth-refresh error', err && err.message); }
    }
  });
  startUiSync();
}

// Tray sign-out, SPA shape: drop the credential and PUSH the transition —
// the renderer swaps to the sign-in screen; no remote page is ever loaded.
function spaSignOut(deps) {
  return deps.auth.signOut().then(() => {
    try { deps.authTokens.onSignOut(); } catch (_err) { /* not started */ }
    try { deps.listener.restart(); } catch (_err) { /* best effort */ }
    deps.showMainWindow();
  });
}

module.exports = { isSpaMode, makeShellHelpers, wireSpaServices, spaSignOut };
