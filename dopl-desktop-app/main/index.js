const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Shared origins/URLs live in config.js so the window shell and the background
// listener never drift. See config.js for APP_URL / HOME_URL / PROTOCOL.
const { APP_ORIGIN, HOME_URL, PROTOCOL } = require('./config');
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
const { createLoadGuard } = require('./load-guard');
const { diag } = require('./diag');
// v1.9 Session Window: engine seam + window factory / lifecycle echoes + window-mode.
const sessionEngine = require('./session-engine');
const spaWindow = require('./spa-window');
const { isSpaMode, makeShellHelpers, wireSpaServices, spaSignOut } = require('./shell-mode');
const deepLinkModule = require('./deep-link');
const uiBridge = require('./ui-bridge');
const authTokens = require('./auth-tokens');
const uiSync = require('./ui-sync');
const settings = require('./settings');
const sessionWindow = require('./session-window');
// Phase-4 prerequisite: the server-authoritative minimum-version gate. Policy in
// min-version.js, shell in version-gate.js, screen in update-required-window.js.
const versionGate = require('./version-gate');
const wake = require('./wake');

const store = new Store();
let mainWindow = null;
let loadGuard = null; // owns the main window's load lifecycle (load-guard.js)
let latestPendingSegment = null; // most-recent pending channel (tray "Pending: N" target)

// isAppOrigin / maybeBeginAuth (the M4 sign-in CSRF nonce) live in auth-actions.js
// alongside the tray's sign-in entry point, so every path that starts a sign-in
// arms the gate identically.
const { isAppOrigin, maybeBeginAuth } = authActions;

// ── Window ────────────────────────────────────────────────────────────────────
// `opts.show === true` forces the window visible once painted even on a hidden
// login launch — an explicit open (tray, notification click, deep link) must
// always surface the window, whereas the initial background launch respects
// openAsHidden. Without this, recreating the window while wasOpenedHidden() is
// still true would silently leave it hidden.
function createMainWindow(opts = {}) {
  const forceShow = opts.show === true;
  const saved = store.get('windowBounds');
  const bounds = saved && typeof saved.width === 'number'
    ? saved
    : { width: 1280, height: 860 };

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 600,
    title: 'Dopl',
    backgroundColor: '#0b0b0f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (saved && typeof saved.x === 'number') {
    mainWindow.setPosition(saved.x, saved.y);
  }

  // The guard owns every remote load: it shows a local loading screen before the
  // first paint (so the window is never a black backgroundColor), runs a watchdog
  // that recovers a hung load in seconds, and auto-retries did-fail-load.
  loadGuard = createLoadGuard({
    window: mainWindow,
    homeUrl: HOME_URL,
    loadingFile: path.join(__dirname, '../renderer/loading.html'),
    offlineFile: path.join(__dirname, '../renderer/offline.html'),
    resetMainPool: api.resetPool,
    diag,
  });

  loadApp();

  // When launched at login as a hidden background listener, stay in the tray —
  // don't pop the window. Otherwise show once the content is painted.
  mainWindow.once('ready-to-show', () => {
    if (forceShow || !wasOpenedHidden()) mainWindow.show();
  });

  // Persist window bounds.
  const persist = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    store.set('windowBounds', mainWindow.getBounds());
  };
  mainWindow.on('resize', persist);
  mainWindow.on('move', persist);

  // Closing the window HIDES it (keeps the renderer — and thus the live
  // Supabase session cookies — alive for the background listener). The app
  // only really exits via tray Quit / before-quit, which sets app.isQuitting.
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    if (loadGuard) { loadGuard.dispose(); loadGuard = null; }
    mainWindow = null;
  });

  wireNavigation(mainWindow.webContents);
}

// True when macOS launched us as a hidden login item (openAsHidden).
function wasOpenedHidden() {
  try {
    return process.platform === 'darwin' && !!app.getLoginItemSettings().wasOpenedAsHidden;
  } catch (_) {
    return false;
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createShellWindow({ show: true }); // force visible even on a hidden login launch
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  // Never reveal a window that has never painted remote content (a hung load
  // would show the bare dark backgroundColor) — put the loading screen up first.
  if (loadGuard) loadGuard.ensureNotBlank();
  mainWindow.show();
  mainWindow.focus();
}

const shellHelpers = makeShellHelpers({
  getMainWindow: () => mainWindow,
  setMainWindow: (win) => { mainWindow = win; },
  createMainWindow,
  createSpaWindow: spaWindow.createSpaWindow,
  // The min-version gate rides this ONE factory (see shell-mode.js).
  versionGate,
  getLoadGuard: () => loadGuard,
  showMainWindow: (...a) => showMainWindow(...a),
  appOrigin: APP_ORIGIN,
  diag,
});
const createShellWindow = shellHelpers.createShellWindow;
const navigateToChannels = shellHelpers.navigateToChannels;

// The menu's "Home" (and the remote shell's initial load). SPA mode has no loadGuard, so
// this was a silent no-op on a user-visible control — route the renderer to boot instead.
function loadApp() {
  if (isSpaMode()) { shellHelpers.navigateTo('/'); return; }
  if (loadGuard) loadGuard.load(HOME_URL);
}

// ── Navigation / link handling ─────────────────────────────────────────────────
function wireNavigation(contents) {
  // window.open / target=_blank → always open in the system browser. This is how
  // sign-in leaves the app: the login page calls window.open('/auth/desktop-start')
  // and OAuth runs in the real browser, then returns via the dopl:// deep link.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(maybeBeginAuth(url));
    return { action: 'deny' };
  });

  // In-window navigation stays on the app's own EXACT origin (FIX S3: it used to
  // admit every *.usedopl.com host, which is what made auth-cookies.js's
  // "origin-locked" claim false); anything else goes to the system browser so the
  // wrapper never becomes a general-purpose browser.
  contents.on('will-navigate', (event, url) => {
    if (!isAppOrigin(url)) {
      event.preventDefault();
      shell.openExternal(maybeBeginAuth(url));
    }
  });

  // Offline / load failure / hung-load recovery is owned by the load guard
  // (main/load-guard.js): it shows the offline screen AND auto-retries on a
  // backoff, replacing the old did-fail-load dead end.
}

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
  getLoadGuard: () => loadGuard,
  isSpaMode,
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
      onSignOut: () => {
        if (isSpaMode()) {
          void spaSignOut({ auth, authTokens, listener, showMainWindow });
          return;
        }
        authActions
          .signOut({
            showWindow: showMainWindow,
            load: (url) => { if (loadGuard) loadGuard.load(url); },
            onSignedOut: () => listener.restart(),
          })
          .catch((err) => diag('sign-out error', err && err.message));
      },
      // Round B: clicking "Pending: N" opens the app to the most-recent pending
      // channel (reusing the notification-click open path), else just the window.
      onPending: () => {
        if (latestPendingSegment) navigateToChannels(latestPendingSegment);
        else showMainWindow();
      },
      windowMode: settings.getWindowMode(),
      onToggleWindowMode: () => {
        const on = settings.setWindowMode(!settings.getWindowMode());
        tray.setWindowMode(on);
        diag('setting: sessionWindowMode ->', on);
      },
      // Item 10: the "Sessions" submenu lists live sessions; a hidden one reopens.
      getSessions: () => sessionEngine.listLiveSessions(),
      onReopenSession: (id) => sessionEngine.reopenWindow(id),
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
    // H3: `getMainWindow` BINDS every handler in that file to this window's own
    // top frame — the remote page can no longer be spoken for by anything else
    // (or by an iframe inside it). Lazy, because the window outlives register()
    // and is rebuilt on reopen.
    channelDirIpc.register({ onChanged: () => tray.refresh(), getMainWindow: () => mainWindow });

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

    // Desktop migration: SPA is the default shell; DOPL_UI=remote is the rollback. The
    // token authority's PROACTIVE timer starts in SPA mode ONLY — in remote mode the
    // page's own supabase-js still refreshes the jar, and both sides share ONE rotating
    // refresh-token family, so main rotating at ~80% of token life left the page holding
    // a stale refresh token and Supabase's reuse detection revoked the family (hourly
    // sign-outs of the rollback shell). On-demand refresh needs no timer and is
    // unaffected. wireSpaServices owns the ONE uiBridge.register call.
    if (isSpaMode()) {
      try { authTokens.start(); } catch (err) { diag('authTokens.start error', err && err.message); }
      wireSpaServices({
        uiBridge, authTokens, uiSync, diag,
        getMainWindow: () => mainWindow,
      });
      createShellWindow({ show: false });
    } else {
      createMainWindow();
    }
    deepLink.flushPending();

    // Session seam: factory + lifecycle handlers, then init() (registers session IPC + reloads records) BEFORE listener.start.
    sessionEngine.setWindowFactory(sessionWindow.createSessionWindow);
    sessionEngine.setLifecycleHandlers(sessionWindow.lifecycleHandlers);
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
    // openChannel handler lets a clicked notification open + navigate the window;
    // onPending feeds the tray "Pending: N" count + remembers the newest pending
    // channel so the tray item can open straight to it (Round B).
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
      getLoadGuard: () => loadGuard,
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

  // Tear the listener down cleanly on real quit (tray Quit sets isQuitting).
  //
  // Round B removed the app-modal consent dialog, so the windowless-modal quit
  // guard that used to live here (before-quit veto keyed on
  // consent.isConsentModalGuardActive) is gone as dead code: with no consent
  // dialog on screen there is no spurious AppKit terminate to veto. Consent is now
  // a non-blocking native notification + durable server row, neither of which can
  // take the app down on dismissal. This handler is back to a plain teardown.
  app.on('before-quit', () => {
    app.isQuitting = true;
    try { listener.stop(); } catch (_) {}
  });

  // Background listener role: the app stays resident even with no windows.
  // (On macOS the window is hidden rather than closed, so this rarely fires;
  // keeping it a no-op means Win/Linux also stay in the tray until Quit.)
  app.on('window-all-closed', () => {});
}
