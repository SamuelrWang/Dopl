const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Shared origins/URLs live in config.js so the window shell and the background
// listener never drift. See config.js for APP_URL / APP_ORIGIN / PROTOCOL.
// (HOME_URL is gone — it named `/canvas`, which the website retirement deleted,
// and the SPA routes in the renderer rather than loading a URL at all.)
const { APP_ORIGIN, PROTOCOL } = require('./config');
const auth = require('./auth');
const authActions = require('./auth-actions');
const appMenu = require('./app-menu');
const tray = require('./tray');
const updater = require('./updater');
const listener = require('./channel-listener');
const targeting = require('./targeting');
const versionSkew = require('./version-skew');
const channelDirs = require('./channel-dirs');
const channelDirIpc = require('./channel-dir-ipc');
const mcpConfig = require('./mcp-config');
const api = require('./api');
const { diag } = require('./diag');
// v1.9 Session Window: engine seam + window factory / lifecycle echoes + window-mode.
const sessionEngine = require('./session-engine');
const spaWindow = require('./spa-window');
// Phase 10: the registry of APP-OWNED windows — the shell plus any pop-out thread window.
// It is what every renderer-reachable ipcMain.handle is bound to, and registration happens
// only at window creation, in main. See main/app-windows.js's header.
const appWindows = require('./app-windows');
const { makeShellHelpers, wireSpaServices, spaSignOut } = require('./shell-mode');
const deepLinkModule = require('./deep-link');
const uiBridge = require('./ui-bridge');
const authTokens = require('./auth-tokens');
const uiSync = require('./ui-sync');
const settings = require('./settings');
const triggerOutcomes = require('./trigger-outcomes'); // the engine's lifecycle echo seam (2026-08-20)
// Phase-4 prerequisite: the server-authoritative minimum-version gate. Policy in
// min-version.js, shell in version-gate.js, screen in update-required-window.js.
const versionGate = require('./version-gate');
const wake = require('./wake');
// C-8: the before-quit teardown — the dialog, the wait path, and the bounded final flush.
const quitGuard = require('./quit-guard');

const store = new Store();
let mainWindow = null;
let latestPendingSegment = null; // most-recent pending channel (tray "Pending: N" target)

// `isAppOrigin` / `maybeBeginAuth` were destructured here for `wireNavigation`, which is
// deleted (see below). index.js no longer opens anything externally, so the M4 sign-in CSRF
// nonce is armed in exactly ONE place — `authActions.beginSignIn` — which is stronger than
// the two call sites this line existed to share.

// ── Window ────────────────────────────────────────────────────────────────────
// THE REMOTE WRAPPER IS GONE (Stage D, 2026-08-06). `createMainWindow` built a
// BrowserWindow around `loadURL(https://www.usedopl.com/canvas)` and handed its load
// lifecycle to `load-guard.js` — a loading screen before first paint, a watchdog for a
// hung network load, and did-fail-load retries. All of that existed because the product
// UI arrived over the network. It has not since 1.8.0: `spa-window.js` does
// `loadFile(renderer/app/index.html)`, off local disk, and the web pages it used to load
// were deleted with the rest of Stage D — so the rollback path now leads to 404s.
//
// `createShellWindow` (shell-mode.js) is the ONE factory every "make or show the window"
// path goes through, and the min-version gate is its single enforcement point.
// `wasOpenedHidden()` MOVED to main/spa-window.js (2026-08-07). It was read only by the
// deleted `createMainWindow`, so it sat here unreferenced while the app went on
// registering itself as a hidden login item below — the intent surviving nowhere but a
// function nobody called. It now lives beside the one factory that decides whether to show.

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createShellWindow({ show: true }); // force visible even on a hidden login launch
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  // The old remote shell primed a loading screen here so a hung network load never
  // revealed the bare backgroundColor. The SPA paints from disk, so there is no hung
  // load to cover and nothing to prime.
  mainWindow.show();
  mainWindow.focus();
}

const shellHelpers = makeShellHelpers({
  getMainWindow: () => mainWindow,
  setMainWindow: (win) => { mainWindow = win; },
  createSpaWindow: spaWindow.createSpaWindow,
  // Phase 10: bind the shell as an app window the moment it is built. Without this the
  // guards have nothing to admit and the whole privileged surface is dead.
  registerAppWindow: appWindows.register,
  // The min-version gate rides this ONE factory (see shell-mode.js).
  versionGate,
  showMainWindow: (...a) => showMainWindow(...a),
  appOrigin: APP_ORIGIN,
  diag,
});
const createShellWindow = shellHelpers.createShellWindow;
const navigateToChannels = shellHelpers.navigateToChannels;

// The menu's "Home". The renderer owns routing, so this asks it to go to boot.
function loadApp() {
  shellHelpers.navigateTo('/');
}

// ── Navigation / link handling ─────────────────────────────────────────────────
// `wireNavigation(contents)` LIVED HERE AND IS DELETED (2026-08-07). Its only call site
// was the last line of `createMainWindow`, so Stage D left it unreachable — and worse than
// merely dead: its docblock said "this is how sign-in leaves the app: the login page calls
// window.open('/auth/desktop-start')", which the SPA window now DENIES outright
// (`spa-window.js` installs `setWindowOpenHandler(() => ({ action: 'deny' }))` plus
// will-navigate/will-redirect/will-frame-navigate policing). An editor reading it would
// have believed a mechanism the shell forbids. A test also pinned its CSRF-arming line, so
// the suite was green about a path that could not run; that assertion now pins the live one.
//
// THE LIVE PATH: sign-in leaves through `authActions.beginSignIn` → `maybeBeginAuth(url)` →
// `shell.openExternal` (`auth-actions.js:73`), which is the one place the M4 nonce is armed.

// ── Menu ────────────────────────────────────────────────────────────────────
// The menu-bar template lives in app-menu.js (extracted at the 500-line cap).
function buildMenu() {
  appMenu.build({ onHome: loadApp, getWindow: () => mainWindow });
}

// ── Deep link (dopl://) ─────────────────────────────────────────────────────────
// Two verbs, both owned by deep-link.js (extracted at the 500-line cap): the
// OAuth/magic-link session handoff `dopl://auth#<tokens>`, and `dopl://open`,
// which shows the app and — when the link names one — the linked page. The
// grammar and the web-path → SPA-route map are the pure deep-link-target.js.
// `arm` registers the protocol and the macOS 'open-url' delivery, and hands back
// the two entry points the rest of this file needs.
const deepLink = deepLinkModule.arm({
  auth,
  authTokens,
  listener,
  mcpConfig,
  showMainWindow: (...a) => showMainWindow(...a),
  navigateTo: (path) => shellHelpers.navigateTo(path),
  getMainWindow: () => mainWindow,
  appOrigin: APP_ORIGIN,
  diag,
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows/Linux deliver deep links as a launch arg; macOS uses 'open-url'.
    const link = argv.find((a) => a.startsWith(PROTOCOL + '://'));
    if (link) deepLink.handle(link);
    showMainWindow();
  });

  app.whenReady().then(() => {
    // Present a clean Chrome User-Agent (no "Electron/x" or app-name token) so
    // the web app and any third-party widgets don't treat us as an odd client.
    try {
      app.userAgentFallback = app.userAgentFallback
        .replace(/ Electron\/[^\s]+/i, '')
        .replace(new RegExp(' ' + app.getName() + '\\/[^\\s]+', 'i'), '');
    } catch (_) {}

    // Launch at login as a hidden background listener.
    try {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    } catch (err) {
      console.warn('[login-item] failed:', err && err.message);
    }

    buildMenu();

    // Menu-bar tray for the background role. Terminal mode is RETIRED (§G Q2); the
    // "Sessions" submenu carries the "Run sessions in a window" toggle (default ON).
    tray.create({
      onOpen: () => showMainWindow(),
      onQuit: () => { app.isQuitting = true; app.quit(); },
      // "Update ready — restart to install": restarts straight away when nothing
      // is live, and asks first (naming the session) when an agent is mid turn.
      onUpdate: () => updater.requestRestart(),
      // "Check for updates now": the publish loop's answer to a 4h interval.
      onCheckUpdates: () => updater.checkNow(),
      // Q4 fix 3: the escape hatch. "Sign in…" appears only while the listener
      // reports signed out and runs the same CSRF-gated external OAuth flow the
      // web login page does; "Sign out" clears the blob AND the cookie jar, then
      // reloads the app (which resolves to /login) and re-reconciles the listener.
      onSignIn: () => authActions.beginSignIn({ showWindow: showMainWindow }),
      onSignOut: () => { void spaSignOut({ auth, authTokens, listener, showMainWindow }); },
      // Round B: clicking "Pending: N" opens the app to the most-recent pending
      // channel (reusing the notification-click open path), else just the window.
      onPending: () => {
        if (latestPendingSegment) navigateToChannels(latestPendingSegment);
        else showMainWindow();
      },
      // ⚠ The windowMode toggle and the "Sessions" submenu accessors are GONE with
      // window mode (2026-08-20, settings.js header) — no session window is ever minted.
      // Round C "Channel folders": accessors read fresh on every rebuild; the chosen
      // path stays local (channel-dirs.js). A set/clear rebuilds the menu.
      getChannels: () => listener.listWatchedChannels(),
      getChannelDirLabel: (id) => channelDirs.liveChannelDirLabel(id),
      onSetChannelDir: (id) => {
        channelDirs
          .promptAndSetChannelDir(id)
          .catch((err) => diag('channel-dir set error', err && err.message))
          .finally(() => tray.refresh());
      },
      onClearChannelDir: (id) => {
        channelDirs.clearChannelDir(id);
        tray.refresh();
      },
    });

    // In-app "Change folder" control. The channel UI (which runs in the remote
    // webview) reaches the native folder picker through these three narrow,
    // label-only IPC handlers. onChanged refreshes the tray so its "Channel
    // folders" submenu stays in sync with a change made from the web control.
    // H3: the sender binding — every handler in that file answers only an APP-OWNED
    // window's own top frame, never an iframe inside it. ⚠ WIDENED 2026-08-18 (wiring
    // plan Phase 10, Samuel's ruling — option (a)): `getSenderIds` was `getMainWindow`,
    // so the subject is now the registry (shell + pop-outs) rather than the one slot.
    // An ACCESSOR, not a snapshot: register() runs before any window exists, the shell is
    // rebuilt on reopen, and a pop-out can appear or close at any moment.
    channelDirIpc.register({ onChanged: () => tray.refresh(), getSenderIds: () => appWindows.senderIds() });

    // Auto-update (electron-updater ↔ GitHub Releases). Silent download with
    // progress on the tray; the tray gains an "Update ready — restart to
    // install" item (plus the tooltip) when one is staged, and the download
    // completing offers a one-click restart. Never auto-restarts: the operator
    // decides, because a restart mid-turn kills a live spawned session (Q10c) —
    // which is why the prompt is handed the live-session list rather than
    // guessing that nothing is running.
    updater.init({
      onReady: (version) => tray.setUpdateReady(version),
      onNote: (text, opts) => tray.setUpdateNote(text, opts),
      // Feeds the min-version gate. Two things ride this: the blocking screen's
      // live download narration, and the anti-brick guard — a check that
      // COMPLETED and found nothing is the only honest evidence that a floor is
      // above the newest build that exists, and it degrades the block.
      onState: () => versionGate.onUpdaterState(),
      getLiveSessions: () => sessionEngine.listLiveSessions(),
    });

    // The Phase-4 minimum-version gate. `GET /api/version` carries the floor; a
    // build below it swaps the app window for the blocking update screen and back
    // again through the one shell factory. Every failure to get an answer
    // (offline, timeout, 5xx, a malformed floor) leaves the app OPEN — see
    // min-version.js for the full fail-open table.
    shellHelpers.wireVersionGate({ onWarn: (notice) => tray.setVersionFloor(notice) });

    // Q10b: a peer running an OLDER build is the standing explanation for "the
    // fix works here and not there". version-skew.js reads the server-stamped
    // metadata.appVersion off their messages and reports each (peer, build) once;
    // the tray keeps the latest as a quiet, disabled line.
    versionSkew.setHandlers({ onSkew: (skew) => tray.setPeerSkew(skew) });

    // The token authority's PROACTIVE timer. It used to be gated on SPA mode, because the
    // retired remote page ran its own supabase-js against the SAME rotating refresh-token
    // family — main rotating at ~80% of token life left that page holding a stale refresh
    // token, and Supabase's reuse detection revoked the family (hourly sign-outs of the
    // rollback shell). With the remote shell deleted there is no second refresher, so this
    // is now the only one and runs unconditionally. wireSpaServices owns the ONE
    // uiBridge.register call.
    {
      try { authTokens.start(); } catch (err) { diag('authTokens.start error', err && err.message); }
      wireSpaServices({
        uiBridge, authTokens, uiSync, diag,
        sessionSummary: require('./session-summary'), // §3.3: the session-pill push
        sessionNarration: require('./session-narration'), // the agent window's work lane (F-212)
        sessionStatePush: require('./session-state-push'), // §3.5 / F-147: the server half
        // Phase 10: the bridge is bound to the REGISTRY, and every main→renderer push fans
        // out over it — a pop-out that never hears the doorbell, the summaries or a
        // SIGN-OUT is the silent-staleness failure INVARIANTS §11 names.
        getSenderIds: () => appWindows.senderIds(),
        getAppWindows: () => appWindows.liveWindows(),
      });
      createShellWindow({ show: false });
    }
    deepLink.flushPending();

    // Session seam: lifecycle handlers, then init() (registers session IPC + reloads records) BEFORE listener.start.
    // ⚠ THE WINDOW FACTORY INJECTION IS GONE (2026-08-20, F-228). `setWindowFactory` was the
    // §B.5 seam that let the engine mint a session window without importing electron; there
    // is no session window, so there is nothing to inject and the seam is deleted rather than
    // fed a null. The LIFECYCLE ECHO below survives and moved with the retirement — it is the
    // calm `session_ended` note a WAITING PEER needs, raised by windowless sessions too.
    sessionEngine.setLifecycleHandlers(triggerOutcomes.lifecycleHandlers);
    try { sessionEngine.init(); } catch (err) { diag('sessionEngine.init error', err && err.message); }

    // Q11: the legacy-reply registry is durable now. targeting.js stays
    // dependency-free (its truth tables slice the block into a bare `new
    // Function` scope), so the store is INJECTED here, before any loop can
    // classify a message. Expired and over-cap records are purged on load. A
    // failure here leaves the old in-memory registry, whose only cost is one
    // spurious consent prompt per restarted exchange.
    try {
      const adopted = targeting.useLegacyThreadStore(store);
      diag('legacy-thread registry: adopted', adopted, 'record(s) from disk');
    } catch (err) {
      diag('legacy-thread registry load error', err && err.message);
    }

    // Start the Channels listener; it drives the tray status label. The
    // openChannel handler lets a clicked notification open + navigate the window
    // — since Phase 9 it is handed (segment, channelId) and lands ON the channel,
    // which is the "windowing inverts" ruling's whole focus-the-app half;
    // onPending feeds the tray "Pending: N" count + remembers the newest pending
    // channel so the tray item can open straight to it (Round B — segment only,
    // so it lands on the page and the Inbox badge takes it from there).
    listener.start((status, meta) => tray.update(status, meta), {
      openChannel: navigateToChannels,
      onPending: ({ count, segment }) => {
        if (segment) latestPendingSegment = segment;
        tray.setPendingCount(count);
      },
    });

    // Feature E: ensure the Claude CLI has the Dopl MCP configured (best-effort;
    // no-ops when signed out or the CLI/endpoint isn't available).
    mcpConfig.ensureMcpConfig().catch((err) => diag('mcp-config startup error', err && err.message));

    // Wake-from-sleep fast catch-up. The fan-out (and the reason each participant
    // is in it) lives in wake.js, extracted at the 500-line cap when the gate
    // joined it; resume + unlock-screen fire together and are coalesced there.
    wake.arm({
      listener, api, authTokens, uiSync, versionGate,
    });

    app.on('activate', () => {
      // Clicking the dock icon is an explicit request to see the app, so force
      // the window visible even if this process was launched hidden at login.
      if (!mainWindow || mainWindow.isDestroyed()) {
        createShellWindow({ show: true });
      } else {
        showMainWindow();
      }
    });
  });

  // THE QUIT TEARDOWN (C-8, 2026-08-08). This was a two-line handler — set `isQuitting`,
  // stop the listener — and the audit's C-8 is what it left out: it never iterated the
  // session registry, so every live `sdk.query()` kept a bundled `claude` child running
  // after the app was gone, with this session's pre-approved `dopl_channel` access still
  // in hand. main/quit-guard.js owns the whole decision now (extracted rather than inlined
  // because it is a dialog, a wait loop and a bounded flush, and index.js is wiring): it
  // NAMES the threads a quit would interrupt, offers Quit anyway / Wait for them to finish,
  // ends each session through the reducer's calm `inactive` terminal so the waiting peer is
  // told, and races one final session-state push so this machine's rows do not outlive it.
  // It fails OPEN on every path — a quit the operator asked for always happens.
  //
  // (Round B's windowless-modal veto is still gone as dead code: consent is a notification
  // plus a durable row, neither of which can take the app down on dismissal.)
  quitGuard.arm({
    listener,
    listOrphanRisk: () => sessionEngine.listOrphanRisk(),
    endLiveSessions: () => sessionEngine.endLiveSessions(),
    flushSessionState: () => require('./session-state-push').flush(),
  });

  // Background listener role: the app stays resident even with no windows.
  // (On macOS the window is hidden rather than closed, so this rarely fires;
  // keeping it a no-op means Win/Linux also stay in the tray until Quit.)
  app.on('window-all-closed', () => {});
}
