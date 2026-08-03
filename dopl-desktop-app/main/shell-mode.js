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

  // SPA mode: the renderer owns routing, so main asks for a route over the
  // bridge (app-preload's onNavigate). Returns false when it could not be
  // delivered, so a caller with a remote-mode fallback can take it.
  function navigateTo(path) {
    const win = deps.getMainWindow();
    if (!path || !win || win.isDestroyed()) return false;
    try {
      win.webContents.send('dopl:navigate', { path });
      return true;
    } catch (err) {
      deps.diag('navigate event failed', err && err.message);
      return false;
    }
  }

  // Feature B: a clicked channel notification opens the app and navigates to
  // that workspace's Channels page. SPA mode routes over the bridge (GAP-16's
  // other half); remote mode keeps the loadGuard URL load.
  function navigateToChannels(segment) {
    deps.showMainWindow();
    if (!segment) return;
    if (isSpaMode()) { navigateTo(`/${segment}/channels`); return; }
    const guard = deps.getLoadGuard();
    if (guard) guard.load(`${deps.appOrigin}/${segment}/channels`);
  }

  return { createShellWindow, navigateTo, navigateToChannels };
}

// ─── BEGIN SHELL-MODE-PURE (unit-tested via source extraction) ──────────────
// MAY THE SYNC FEED BE PUT BACK where sign-out took it from?
//
// uiSync.stop() clears the watched workspace on purpose — a new session must never
// inherit the previous one's feed. But the renderer's registry dedupes on its OWN module
// state (`want === current`), so nothing re-issues the watch: a session that dies while
// the window sits on a workspace page, followed by a tray/OAuth re-sign-in, leaves main
// watching nothing and the renderer believing it is watched. Live updates are then dead
// for the rest of the session, with no error anywhere.
//
// So main replays the stashed watch — and ONLY for the SAME operator, which is the exact
// reason stop() cleared it. A different (or unknown) user id gets nothing and waits for
// the renderer to issue its own watch.
function resumeWatchTarget(stash, userId) {
  if (!stash || !stash.workspaceId || !stash.userId || !userId) return null;
  return String(stash.userId) === String(userId) ? stash.workspaceId : null;
}
// ─── END SHELL-MODE-PURE ────────────────────────────────────────────────────

// The whenReady SPA-mode service wiring: bridge registration, auth-state
// fan-out (stop the sync feed on sign-out, restart + rotate on sign-in),
// and the ui-sync start. `deps` adds: uiBridge, authTokens, uiSync,
// broadcastTo() → the live window.
function wireSpaServices(deps) {
  const startUiSync = () =>
    deps.uiSync.start({ getWindow: deps.getMainWindow, getAccessToken: deps.authTokens.getAccessToken });
  let stash = null; // { workspaceId, userId } — what the feed was watching when it stopped
  let lastUserId = null; // the operator it was watching FOR (signed-out carries no id)
  deps.uiBridge.register({ getMainWindow: deps.getMainWindow });
  deps.authTokens.subscribe((state) => {
    try { deps.uiBridge.broadcastAuthState(deps.getMainWindow(), state); } catch (_err) { /* window gone */ }
    const status = state && state.status;
    if (state && state.userId) lastUserId = state.userId;
    if (status === 'signed-out') {
      let watching = null;
      try { watching = deps.uiSync.watchedWorkspace(); } catch (_err) { /* not started */ }
      stash = watching ? { workspaceId: watching, userId: lastUserId } : null;
      try { deps.uiSync.stop(); } catch (_err) { /* not started */ }
    }
    if (status === 'signed-in') {
      try { startUiSync(); } catch (err) { deps.diag('ui-sync restart error', err && err.message); }
      const resume = resumeWatchTarget(stash, state && state.userId);
      stash = null;
      if (resume) {
        try { deps.uiSync.watch(resume); deps.diag('ui-sync: replayed the pre-sign-out watch'); }
        catch (err) { deps.diag('ui-sync watch replay error', err && err.message); }
      }
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
