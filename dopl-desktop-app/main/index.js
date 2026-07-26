const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Shared origins/URLs live in config.js so the window shell and the background
// listener never drift. See config.js for APP_URL / HOME_URL / PROTOCOL.
const { APP_ORIGIN, HOME_URL, PROTOCOL } = require('./config');
const auth = require('./auth');
const tray = require('./tray');
const updater = require('./updater');
const listener = require('./channel-listener');
const mcpConfig = require('./mcp-config');
const { diag } = require('./diag');

const store = new Store();
let mainWindow = null;
let pendingDeepLink = null; // deep link received before the window is ready

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
function createMainWindow() {
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
    titleBarStyle: 'hiddenInset',
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

  loadApp();

  // When launched at login as a hidden background listener, stay in the tray —
  // don't pop the window. Otherwise show once the content is painted.
  mainWindow.once('ready-to-show', () => {
    if (!wasOpenedHidden()) mainWindow.show();
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
  mainWindow.on('closed', () => { mainWindow = null; });

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
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Feature B: clicking a channel notification opens the app and navigates the
// webview to that workspace's Channels page. `segment` is the canonical
// `{slug}-{publicId}` URL segment supplied by the listener.
function navigateToChannels(segment) {
  showMainWindow();
  if (!segment || !mainWindow || mainWindow.isDestroyed()) return;
  const url = `${APP_ORIGIN}/${segment}/channels`;
  mainWindow.loadURL(url).catch((err) =>
    console.error('[nav] channels load failed:', err && err.message)
  );
}

function loadApp() {
  mainWindow.loadURL(HOME_URL).catch((err) => {
    console.error('[load] failed:', err && err.message);
  });
}

function showOffline() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadFile(path.join(__dirname, '../renderer/offline.html')).catch(() => {});
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

  // Offline / load failure → fallback screen (ignore sub-frame + user-aborted).
  contents.on('did-fail-load', (event, errorCode, errorDesc, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // ERR_ABORTED (normal during redirects)
    console.error('[did-fail-load]', errorCode, errorDesc, validatedURL);
    showOffline();
  });
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
    mainWindow.loadURL(target).catch((err) => console.error('[deeplink] load failed:', err && err.message));
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

    // Menu-bar tray for the background role.
    tray.create({
      onOpen: () => showMainWindow(),
      onQuit: () => { app.isQuitting = true; app.quit(); },
      onUpdate: () => updater.quitAndInstall(),
    });

    // Auto-update (electron-updater ↔ GitHub Releases). Silent download; the
    // tray gains a "Restart to install" item when one is ready.
    updater.init({ onReady: (version) => tray.setUpdateReady(version) });

    createMainWindow();
    flushPendingDeepLink();

    // Start the Channels listener; it drives the tray status label. The
    // openChannel handler lets a clicked notification open + navigate the window.
    listener.start((status) => tray.update(status), { openChannel: navigateToChannels });

    // Feature E: ensure the Claude CLI has the Dopl MCP configured (best-effort;
    // no-ops when signed out or the CLI/endpoint isn't available).
    mcpConfig.ensureMcpConfig().catch((err) => diag('mcp-config startup error', err && err.message));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        showMainWindow();
      }
    });
  });

  // Tear the listener down cleanly on real quit (tray Quit sets isQuitting).
  app.on('before-quit', () => {
    app.isQuitting = true;
    try { listener.stop(); } catch (_) {}
  });

  // Background listener role: the app stays resident even with no windows.
  // (On macOS the window is hidden rather than closed, so this rarely fires;
  // keeping it a no-op means Win/Linux also stay in the tray until Quit.)
  app.on('window-all-closed', () => {});
}
