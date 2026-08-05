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
//   versionGate                         — the min-version gate module
//   getLoadGuard()                      — remote mode's load guard (or null)
//   showMainWindow()                    — reveal/recreate (calls back in)
//   appOrigin, diag

function isSpaMode() {
  return process.env.DOPL_UI !== 'remote';
}

function makeShellHelpers(deps) {
  function createShellWindow(opts = {}) {
    // THE MINIMUM-VERSION GATE'S ENTIRE ENFORCEMENT POINT. This factory is the
    // one place every "make or show the window" path already goes through, which
    // is what it was extracted for — so a single branch here makes the block
    // total, with no new interception anywhere: the dock icon, the tray's "Open
    // Dopl", a clicked notification and a dopl:// deep link all resolve to the
    // update screen for as long as the gate says so, and go back to resolving to
    // the app the moment it stops. Both shells are covered, because both are
    // downstream of this line. See main/version-gate.js.
    //
    // The window module is required LAZILY (the tray.js idiom) so this file keeps
    // its property of holding no module-scope dependencies at all — its truth
    // tables slice it into a bare scope.
    if (deps.versionGate && deps.versionGate.isBlocked()) {
      const win = require('./update-required-window').createUpdateRequiredWindow();
      deps.setMainWindow(win);
      win.on('closed', () => deps.setMainWindow(null));
      return win;
    }
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

  // Replace whatever is on screen with the window the CURRENT gate verdict calls
  // for. A block and its later release are the same two lines, because both
  // resolve through createShellWindow above. Live SESSION windows are
  // deliberately untouched: the gate blocks the product surface, not an agent
  // mid turn, for the same reason the updater never force-restarts.
  function swapShell() {
    const win = deps.getMainWindow();
    if (win && !win.isDestroyed()) win.destroy();
    deps.setMainWindow(null);
    return createShellWindow({ show: true });
  }

  // The gate's handlers, kept here because both of them are window swaps and
  // this file is where "which window is the shell" is decided. `onWarn` is the
  // caller's (the tray line), since the DEGRADED state has no window at all.
  function wireVersionGate(opts = {}) {
    deps.versionGate.init({
      onBlock: () => swapShell(),
      onRelease: () => {
        require('./update-required-window').closeUpdateRequiredWindow();
        swapShell();
      },
      onWarn: (notice) => { if (opts.onWarn) opts.onWarn(notice); },
    });
  }

  return { createShellWindow, navigateTo, navigateToChannels, swapShell, wireVersionGate };
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
// the ui-sync start, and (§3.3) the session-pill push. `deps` adds: uiBridge,
// authTokens, uiSync, sessionSummary, broadcastTo() → the live window.
function wireSpaServices(deps) {
  const startUiSync = () =>
    deps.uiSync.start({ getWindow: deps.getMainWindow, getAccessToken: deps.authTokens.getAccessToken });
  // SESSION PILLS (rollback plan §3.3). SPA-only, like the sync feed: the retired remote
  // shell has no pills bar to feed. Unlike ui-sync it holds no socket and no credential —
  // it projects in-memory session state — so it is armed once here and never stopped on
  // sign-out: there is nothing running to stop, and the sessions themselves are unaffected
  // by a sign-out (the engine owns their lifetime). `getWindow` is read at SEND time.
  const startSessionSummary = () => {
    if (!deps.sessionSummary) return; // mid-wave / harness
    deps.sessionSummary.start({ getWindow: deps.getMainWindow });
  };
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
      // A sign-in swaps the renderer out of the signed-out screen, so the fresh one has
      // seen no summaries frame; start() resets the digest and repaints it.
      try { startSessionSummary(); } catch (err) { deps.diag('session-summary restart error', err && err.message); }
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
  startSessionSummary();
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
