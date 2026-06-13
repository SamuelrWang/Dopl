const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');

// ── Config ──────────────────────────────────────────────────────────────────
const APP_URL = process.env.DOPL_APP_URL || 'https://www.usedopl.com/';
const APP_ORIGIN = new URL(APP_URL).origin;

// Hosts we allow to open as in-app popup windows (OAuth / sign-in flows).
// Everything else that tries to open a new window is sent to the system browser.
const AUTH_HOSTS = [
  'accounts.google.com',
  'appleid.apple.com',
  'github.com',
  'login.microsoftonline.com',
];

const store = new Store();
let mainWindow = null;

function isAuthHost(host) {
  return AUTH_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// Internal = the app itself or an auth provider mid-flow → navigate in-window.
function isInternalUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.origin === APP_ORIGIN) return true;
    // Also treat the bare/apex usedopl.com (and any subdomain) as internal.
    if (u.hostname === 'usedopl.com' || u.hostname.endsWith('.usedopl.com')) return true;
    if (isAuthHost(u.hostname)) return true;
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
  mainWindow.loadURL(APP_URL).catch((err) => {
    console.error('[load] failed:', err && err.message);
  });
}

function showOffline() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadFile(path.join(__dirname, '../renderer/offline.html')).catch(() => {});
}

// ── Navigation / link handling ─────────────────────────────────────────────────
function wireNavigation(contents) {
  // window.open / target=_blank
  contents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) {
      // Allow auth/same-origin popups to open as a real child window so OAuth
      // popup flows complete, then return to the app.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // In-window navigation: keep app + auth hosts in-window, push the rest to the
  // system browser so the wrapper never becomes a general-purpose browser.
  contents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
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

// ── Lifecycle ─────────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createMainWindow();

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
