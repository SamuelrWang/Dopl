// The helpers every "make/show/navigate the window" call site must go through.
//
// THERE USED TO BE TWO SHELLS, and a mode switch chose between them: the bundled SPA
// (default since 1.8.0) and a retired remote wrapper that loaded the website. This module
// exists because calling the wrapper's factory directly resurrected the wrong window in SPA
// mode (fleet audit 2026-08-03, high) — dock activate, tray show and notification clicks all
// did it. Stage D (2026-08-06) deleted that shell: the web pages it loaded went with the rest
// of the retirement, so the rollback led to 404s.
//
// ONE SHELL NOW, AND THE SINGLE-FACTORY RULE STILL MATTERS — for a different reason. The
// MIN-VERSION GATE rides `createShellWindow`, so that being the only way to make a SHELL is
// what makes the block total. A second SHELL factory is a window the gate does not cover.
//
// ⚠ THE POP-OUT (main/popout-window.js, wiring plan Phase 10) IS NOT A SECOND SHELL AND DOES
// NOT WEAKEN THAT. It is never the main-window slot, it is never resurrected by activate/tray/
// notification, and it refuses to open at all while the gate is blocking — the refusal lives
// at its ONE entry point (`channel-dir-ipc.js › threads:openWindow`), so the block stays
// total without a second interception point here.
//
// State stays in index.js; this module is given accessors, never the
// variables. `deps`:
//   getMainWindow()/setMainWindow(win)  — the one main-window slot
//   createSpaWindow()                   — the bundled factory
//   registerAppWindow(win)              — main/app-windows.js › register (Phase 10)
//   versionGate                         — the min-version gate module
//   showMainWindow()                    — reveal/recreate (calls back in)
//   appOrigin, diag

// THE PAGE A CHANNEL NOTIFICATION LANDS ON, as one string. `channels` since the
// CUTOVER (wiring plan Phase 12, 2026-08-18) — it held `channels-v2` between
// Phase 9 and the cutover, while the Inbox and the launch panel lived behind a
// temporary route beside the old two-pane page. One constant, so the rename was
// one edit rather than a grep.
// Mirrors a row in `apps/desktop-ui/src/routes.tsx › WORKSPACE_PAGES`; the hand
// copy that the drift test guards is `deep-link-target.js`, not this.
// ⚠ EXPORTED SINCE 2026-08-18 (Phase 10). `main/popout-window.js` was its one outside
// reader and IS NO LONGER ONE (2026-08-19): the pop-out lands on its own thread-only route
// now, and carries that page string itself. The export stays for the tests that slice this
// file; nothing else in main navigates to the channels page.
const CHANNELS_PAGE = 'channels';

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
    const win = deps.createSpaWindow(opts);
    deps.setMainWindow(win);
    // ⚠ BIND IT AS AN APP WINDOW (wiring plan Phase 10). This is what makes every
    // renderer-reachable `ipcMain.handle` answer the shell at all — the guards ask the
    // registry, not the main-window slot, since the widening. Registration happens HERE,
    // at CREATION, in main; nothing renderer-reachable can add to that set.
    // ⚠ THE UPDATE-REQUIRED SCREEN IS DELIBERATELY *NOT* REGISTERED: it takes its own
    // preload, reaches no `dopl:*` handler, and a blocking screen with the app's privileged
    // surface bound to it would be the block leaking a door.
    if (deps.registerAppWindow) deps.registerAppWindow(win);
    win.on('closed', () => deps.setMainWindow(null));
    if (opts.show !== false) win.show();
    return win;
  }

  // The renderer owns routing, so main asks for a route over the bridge
  // (app-preload's onNavigate). Returns false when it could not be delivered.
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
  // that workspace's Channels page, over the bridge (GAP-16's other half).
  //
  // WIRING PLAN PHASE 9 — WINDOWING INVERTS. This is the whole "focus the app"
  // half of the inversion, and it already existed; what was missing was the
  // CHANNEL. `channelId` is optional and every existing caller (the tray's
  // "Pending: N") still lands on the page itself.
  //
  // ⚠ BOTH INTERPOLATED VALUES ARE SERVER DATA ENTERING A ROUTER PATH, and both
  // are checked by the ONE module that owns that question —
  // `deep-link-target.js › isSafeSegment`, the same character rule every
  // deep-link segment passes (INVARIANTS §11). A second regex here would be a
  // second answer to it. An unusable segment shows the window and navigates
  // nowhere; an unusable channel id degrades to the page, which is exactly what
  // a notification with no channel already does. Required LAZILY (the tray.js
  // idiom above) so this file keeps its module-scope dependency freedom.
  function navigateToChannels(segment, channelId, threadId) {
    deps.showMainWindow();
    if (!segment) return;
    const { isSafeSegment } = require('./deep-link-target');
    if (!isSafeSegment(segment)) return;
    const page = `/${segment}/${CHANNELS_PAGE}`;
    if (!isSafeSegment(channelId)) return navigateTo(page);
    // `?thread=` is a SELECTION the channels page already reads (Phase 10); a
    // notification about a THREAD lands on the thread (Samuel, 2026-08-20).
    const suffix = isSafeSegment(threadId) ? `?thread=${threadId}` : '';
    navigateTo(`${page}/${channelId}${suffix}`);
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
// the ui-sync start, (§3.3) the session-pill push and (§3.5) the session-state
// writer. `deps` adds: uiBridge, authTokens, uiSync, sessionSummary,
// sessionStatePush, and the app-window registry accessors.
//
// ⚠ EVERY MAIN→RENDERER PUSH BELOW FANS OUT OVER THE REGISTRY SINCE 2026-08-18 (wiring plan
// Phase 10), not over the main-window slot. A pop-out that renders stale data with no error
// anywhere is the failure mode INVARIANTS §11 names, and it applies to all three feeds: the
// ui-sync doorbell (the transcript stops updating), the summaries push (the Agents surface
// freezes) and the auth state (the worst — a window still showing a signed-out session's
// data). `getAppWindows()` is read at SEND time, never captured.
function wireSpaServices(deps) {
  const appWindows = () => {
    try { return typeof deps.getAppWindows === 'function' ? deps.getAppWindows() : []; }
    catch (_err) { return []; }
  };
  const startUiSync = () =>
    deps.uiSync.start({ getWindows: appWindows, getAccessToken: deps.authTokens.getAccessToken });
  // SESSION PILLS (rollback plan §3.3). SPA-only, like the sync feed: the retired remote
  // shell has no pills bar to feed. Unlike ui-sync it holds no socket and no credential —
  // it projects in-memory session state — so it is armed once here and never stopped on
  // sign-out: there is nothing running to stop, and the sessions themselves are unaffected
  // by a sign-out (the engine owns their lifetime). `getWindow` is read at SEND time.
  const startSessionSummary = () => {
    if (!deps.sessionSummary) return; // mid-wave / harness
    deps.sessionSummary.start({ getWindows: appWindows });
  };
  // THE SESSION-STATE WRITER (rollback §3.5 / F-147) — the server half of the same
  // projection, so `read_sessions` can answer "what is flint doing?" over MCP. It is armed
  // HERE because this is where the pill projection and the operator's identity already meet:
  // it subscribes to session-summary's change event (its trigger) and reads `getAuthState()`
  // for the operator it may honestly report as (its cross-account guard). SPA-only for the
  // same reason the pills are — the remote shell is the retired website (§9.3) and does not
  // grow capabilities, and `authTokens` does not even start there.
  const startSessionStatePush = () => {
    if (!deps.sessionStatePush || !deps.sessionSummary) return; // mid-wave / harness
    deps.sessionStatePush.start({
      getUserId: () => (deps.authTokens.getAuthState() || {}).userId || null,
      summary: deps.sessionSummary,
    });
  };
  let stash = null; // { workspaceId, userId } — what the feed was watching when it stopped
  let lastUserId = null; // the operator it was watching FOR (signed-out carries no id)
  deps.uiBridge.register({ getSenderIds: deps.getSenderIds });
  deps.authTokens.subscribe((state) => {
    try { deps.uiBridge.broadcastAuthState(appWindows(), state); } catch (_err) { /* windows gone */ }
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
      // A fresh credential is not a STATE change, so the writer's own trigger would never
      // fire on it — and a run that starts signed out has a previous run's rows to clear
      // and possibly a live session to report. One cycle, off the current projection.
      try { if (deps.sessionStatePush) deps.sessionStatePush.kick(); }
      catch (err) { deps.diag('session-state push kick error', err && err.message); }
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
  startSessionStatePush();
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

module.exports = { makeShellHelpers, wireSpaServices, spaSignOut, CHANNELS_PAGE };
