const { app, BrowserWindow, Menu, shell, powerMonitor } = require('electron');
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
const uiBridge = require('./ui-bridge');
const authTokens = require('./auth-tokens');
const uiSync = require('./ui-sync');
const settings = require('./settings');
const sessionWindow = require('./session-window');

const store = new Store();
let mainWindow = null;
let loadGuard = null; // owns the main window's load lifecycle (load-guard.js)
let pendingDeepLink = null; // deep link received before the window is ready
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
  getLoadGuard: () => loadGuard,
  showMainWindow: (...a) => showMainWindow(...a),
  appOrigin: APP_ORIGIN,
  diag,
});
const createShellWindow = shellHelpers.createShellWindow;
const navigateToChannels = shellHelpers.navigateToChannels;

function loadApp() {
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
// The system browser finishes OAuth and redirects to dopl://auth#<tokens>. macOS
// routes that to this app; we load the in-app completion page with the same
// fragment so the app's window adopts the session.
function openDeepLink(url) {
  let fragment = '';
  try {
    const u = new URL(url);
    fragment = u.hash ? u.hash.slice(1) : u.search.slice(1);
  } catch (_) {
    const i = url.indexOf('#');
    if (i >= 0) fragment = url.slice(i + 1);
  }
  // Capture the Supabase tokens into the encrypted main-process store so the
  // background listener has a session (and a refresh token) even when the
  // window is hidden. The renderer's completion page also sets its own cookies.
  //
  // M4: only adopt the session if THIS app initiated the sign-in recently. A
  // rejected fragment (injected dopl:// link, or an expired flow) is dropped
  // entirely — we neither persist it nor navigate the window to adopt it.
  const accepted = auth.captureFromFragment(fragment);
  if (!accepted) {
    console.warn('[deeplink] auth fragment rejected (no pending sign-in / expired) — ignoring');
    return;
  }
  // Deterministic re-arm of the token authority on fresh credentials (C15) —
  // replaces timing guesses; no-op when start() hasn't run.
  try { authTokens.onSignIn(); } catch (err) { diag('token re-arm error', err && err.message); }

  if (isSpaMode()) {
    // SPA: the captured tokens ARE the session — loading the remote
    // desktop-complete cookie page here stranded the window on "Signing
    // you in…"; onSignIn() above pushed the transition that flips the UI.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  } else {
    const target = `${APP_ORIGIN}/auth/desktop-complete#${fragment}`;
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (loadGuard) loadGuard.load(target);
      else mainWindow.loadURL(target).catch((err) => console.error('[deeplink] load failed:', err && err.message));
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  }

  // Give the completion page a moment to establish cookies, then (re)start the
  // listener against the fresh session and ensure the CLI's Dopl MCP config.
  setTimeout(() => {
    listener.restart();
    mcpConfig.ensureMcpConfig().catch((err) => diag('mcp-config post-signin error', err && err.message));
  }, 3000);
}

function handleDeepLink(url) {
  if (!url || !url.startsWith(PROTOCOL + '://')) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    openDeepLink(url);
  } else {
    pendingDeepLink = url; // arrived before the window existed — flush on ready
  }
}

function flushPendingDeepLink() {
  if (pendingDeepLink) {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    openDeepLink(url);
  }
}

// Register as the handler for dopl:// (also declared in Info.plist via build config).
app.setAsDefaultProtocolClient(PROTOCOL);

// macOS delivers deep links via 'open-url' (can fire before the app is ready).
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows/Linux deliver deep links as a launch arg; macOS uses 'open-url'.
    const link = argv.find((a) => a.startsWith(PROTOCOL + '://'));
    if (link) handleDeepLink(link);
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
      getLiveSessions: () => sessionEngine.listLiveSessions(),
    });

    // Q10b: a peer running an OLDER build is the standing explanation for "the
    // fix works here and not there". version-skew.js reads the server-stamped
    // metadata.appVersion off their messages and reports each (peer, build) once;
    // the tray keeps the latest as a quiet, disabled line.
    versionSkew.setHandlers({ onSkew: (skew) => tray.setPeerSkew(skew) });

    // Desktop migration: SPA is the default shell; DOPL_UI=remote is the
    // rollback. Token authority starts in BOTH modes — additive beside
    // cookies, and the credential's only refresher once the remote page
    // (whose Supabase client refreshed the jar) is gone. wireSpaServices
    // owns the ONE uiBridge.register call (a second handle() would throw).
    try { authTokens.start(); } catch (err) { diag('authTokens.start error', err && err.message); }
    if (isSpaMode()) {
      wireSpaServices({
        uiBridge, authTokens, uiSync, diag,
        getMainWindow: () => mainWindow,
      });
      createShellWindow({ show: false });
    } else {
      createMainWindow();
    }
    flushPendingDeepLink();

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

    // Wake-from-sleep fast catch-up. On resume (and screen unlock) kick the
    // listener: abort in-flight long-polls so they re-await from their cursors
    // immediately, beat presence, and reconcile. reconcile is single-flight and
    // wake() is debounced here, so a resume+unlock pair (they fire together) does
    // one pass — not two. powerMonitor is only valid after the app is ready.
    let lastWakeAt = 0;
    const onWake = (reason) => {
      const now = Date.now();
      if (now - lastWakeAt < 3000) return; // coalesce resume+unlock / rapid unlocks
      lastWakeAt = now;
      diag('powerMonitor:', reason, '— waking listener + resetting pools');
      // Listener long-polls self-recover on their own; the shared pool resets are
      // what fix the multi-minute hang after a network transition.
      try { listener.wake(); } catch (err) { diag('wake error', err && err.message); }
      try { api.resetPool(); } catch (err) { diag('wake pool-reset error', err && err.message); } // (2b) main-process undici pool
      try { authTokens.onWake(); } catch (err) { diag('wake token error', err && err.message); } // (2d) refresh a stale access token now, not at the late alarm
      try { uiSync.onWake(); } catch (err) { diag('wake ui-sync error', err && err.message); } // (2e) rejoin the SPA's sync feed on fresh sockets
      try { if (loadGuard) loadGuard.onWake(); } catch (err) { diag('wake guard error', err && err.message); } // (2a) renderer pool + (2c) retry a hung load
    };
    try {
      powerMonitor.on('resume', () => onWake('resume'));
      powerMonitor.on('unlock-screen', () => onWake('unlock-screen'));
    } catch (err) {
      console.warn('[powerMonitor] wiring failed:', err && err.message);
    }

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
