const { app, BrowserWindow, Menu, shell, powerMonitor } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Shared origins/URLs live in config.js so the window shell and the background
// listener never drift. See config.js for APP_URL / HOME_URL / PROTOCOL.
const { APP_ORIGIN, HOME_URL, PROTOCOL } = require('./config');
const auth = require('./auth');
const tray = require('./tray');
const updater = require('./updater');
const listener = require('./channel-listener');
const spawner = require('./session-spawner');
const channelDirs = require('./channel-dirs');
const channelDirIpc = require('./channel-dir-ipc');
const mcpConfig = require('./mcp-config');
const api = require('./api');
const { createLoadGuard } = require('./load-guard');
const { diag } = require('./diag');

const store = new Store();
let mainWindow = null;
let loadGuard = null; // owns the main window's load lifecycle (load-guard.js)
let pendingDeepLink = null; // deep link received before the window is ready
let latestPendingSegment = null; // most-recent pending channel (tray "Pending: N" target)

// In-app navigation is limited to the app's own web origin. Sign-in runs in the
// SYSTEM BROWSER (Supabase PKCE requires it), so OAuth provider hosts are NOT
// kept in-window — they're opened externally and hand the session back via the
// dopl:// deep link.
function isAppUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.origin === APP_ORIGIN) return true;
    if (u.hostname === 'usedopl.com' || u.hostname.endsWith('.usedopl.com')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

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
    createMainWindow({ show: true }); // force visible even on a hidden login launch
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  // Never reveal a window that has never painted remote content (a hung load
  // would show the bare dark backgroundColor) — put the loading screen up first.
  if (loadGuard) loadGuard.ensureNotBlank();
  mainWindow.show();
  mainWindow.focus();
}

// Feature B: clicking a channel notification opens the app and navigates the
// webview to that workspace's Channels page. `segment` is the canonical
// `{slug}-{publicId}` URL segment supplied by the listener.
function navigateToChannels(segment) {
  showMainWindow();
  if (!segment || !mainWindow || mainWindow.isDestroyed() || !loadGuard) return;
  loadGuard.load(`${APP_ORIGIN}/${segment}/channels`);
}

function loadApp() {
  if (loadGuard) loadGuard.load(HOME_URL);
}

// M4: when we hand an app-origin sign-in URL to the system browser, arm the
// pending-auth gate and tag the URL with our state nonce. captureFromFragment()
// then refuses any dopl:// session that wasn't initiated here. Non-auth URLs are
// returned unchanged.
function maybeBeginAuth(urlStr) {
  try {
    const u = new URL(urlStr);
    if (!isAppUrl(urlStr) || !/\/auth\//i.test(u.pathname)) return urlStr;
    const nonce = auth.beginPendingAuth();
    if (!u.searchParams.has('state')) u.searchParams.set('state', nonce);
    return u.toString();
  } catch (_) {
    return urlStr;
  }
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

  // In-window navigation stays on the app's own origin; anything else goes to the
  // system browser so the wrapper never becomes a general-purpose browser.
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(maybeBeginAuth(url));
    }
  });

  // Offline / load failure / hung-load recovery is owned by the load guard
  // (main/load-guard.js): it shows the offline screen AND auto-retries on a
  // backoff, replacing the old did-fail-load dead end.
}

// ── Menu ────────────────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: 'Dopl',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Home',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => loadApp(),
        },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => {
            // Electron 32+: navigation moved onto webContents.navigationHistory.
            const nav = mainWindow && mainWindow.webContents.navigationHistory;
            if (nav && nav.canGoBack()) nav.goBack();
          },
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => {
            const nav = mainWindow && mainWindow.webContents.navigationHistory;
            if (nav && nav.canGoForward()) nav.goForward();
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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

  const target = `${APP_ORIGIN}/auth/desktop-complete#${fragment}`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (loadGuard) loadGuard.load(target);
    else mainWindow.loadURL(target).catch((err) => console.error('[deeplink] load failed:', err && err.message));
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
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

    // Menu-bar tray for the background role. The terminal-mode checkbox (v1.2
    // Feature 3) reflects + toggles the run-in-Terminal spawn setting.
    tray.create({
      onOpen: () => showMainWindow(),
      onQuit: () => { app.isQuitting = true; app.quit(); },
      onUpdate: () => updater.quitAndInstall(),
      // Round B: clicking "Pending: N" opens the app to the most-recent pending
      // channel (reusing the notification-click open path), else just the window.
      onPending: () => {
        if (latestPendingSegment) navigateToChannels(latestPendingSegment);
        else showMainWindow();
      },
      terminalMode: spawner.getRunInTerminal(),
      onToggleTerminal: () => {
        const on = spawner.setRunInTerminal(!spawner.getRunInTerminal());
        tray.setTerminalMode(on);
        diag('setting: runInTerminal ->', on);
      },
      // Round C: the "Channel folders" submenu. Accessors are read fresh on every
      // tray rebuild; setting/clearing a folder rebuilds the menu so it reflects
      // the change at once. The chosen path stays local (channel-dirs.js).
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
    channelDirIpc.register({ onChanged: () => tray.refresh() });

    // Auto-update (electron-updater ↔ GitHub Releases). Silent download; the
    // tray gains a "Restart to install" item when one is ready.
    updater.init({ onReady: (version) => tray.setUpdateReady(version) });

    createMainWindow();
    flushPendingDeepLink();

    // Start the Channels listener; it drives the tray status label. The
    // openChannel handler lets a clicked notification open + navigate the window;
    // onPending feeds the tray "Pending: N" count + remembers the newest pending
    // channel so the tray item can open straight to it (Round B).
    listener.start((status) => tray.update(status), {
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
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow({ show: true });
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
