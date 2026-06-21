const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');

// ── Config ──────────────────────────────────────────────────────────────────
const APP_URL = process.env.DOPL_APP_URL || 'https://www.usedopl.com/';
const APP_ORIGIN = new URL(APP_URL).origin;

// The desktop app opens straight into the product, never the marketing site —
// someone who installed the app has no reason to see the landing page. `/canvas`
// resolves server-side: signed-out → /login, brand-new user → /onboarding,
// otherwise the user's default workspace canvas. So a signed-out user lands on
// the auth screen, not the landing page.
const HOME_URL = new URL('/canvas', APP_URL).toString();

// Custom URL scheme used to hand the OAuth session back from the system browser
// into this app (dopl://auth#access_token=…&refresh_token=…). Registered with
// macOS via setAsDefaultProtocolClient + CFBundleURLTypes in package.json.
const PROTOCOL = 'dopl';

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

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Persist window bounds.
  const persist = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    store.set('windowBounds', mainWindow.getBounds());
  };
  mainWindow.on('resize', persist);
  mainWindow.on('move', persist);

  mainWindow.on('closed', () => { mainWindow = null; });

  wireNavigation(mainWindow.webContents);
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

// ── Navigation / link handling ─────────────────────────────────────────────────
function wireNavigation(contents) {
  // window.open / target=_blank → always open in the system browser. This is how
  // sign-in leaves the app: the login page calls window.open('/auth/desktop-start')
  // and OAuth runs in the real browser, then returns via the dopl:// deep link.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // In-window navigation stays on the app's own origin; anything else goes to the
  // system browser so the wrapper never becomes a general-purpose browser.
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
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
          click: () => { if (mainWindow && mainWindow.webContents.canGoBack()) mainWindow.webContents.goBack(); },
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => { if (mainWindow && mainWindow.webContents.canGoForward()) mainWindow.webContents.goForward(); },
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
  const target = `${APP_ORIGIN}/auth/desktop-complete#${fragment}`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(target).catch((err) => console.error('[deeplink] load failed:', err && err.message));
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Present a clean Chrome User-Agent (no "Electron/x" or app-name token) so
    // the web app and any third-party widgets don't treat us as an odd client.
    try {
      app.userAgentFallback = app.userAgentFallback
        .replace(/ Electron\/[^\s]+/i, '')
        .replace(new RegExp(' ' + app.getName() + '\\/[^\\s]+', 'i'), '');
    } catch (_) {}

    buildMenu();
    createMainWindow();
    flushPendingDeepLink();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
