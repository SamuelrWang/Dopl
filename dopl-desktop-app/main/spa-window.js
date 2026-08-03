// The BUNDLED UI window (docs/DESKTOP-MIGRATION-PLAN.md Phase 2).
//
// This is the window that replaces `loadURL('https://www.usedopl.com/canvas')`.
// It renders `renderer/app/` — the Vite build of `apps/desktop-ui` — as a LOCAL
// page, which flips the whole trust model: today's main window hosts REMOTE
// content and therefore gets the deliberately-minimal `renderer/preload.js`
// bridge; this one hosts our own bundle and gets the typed data bridge
// (`renderer/app-preload.js` + `main/ui-bridge.js`).
//
// The security shape is `main/session-window.js`'s, verbatim, because that is
// the repo's proven pattern for a local Electron page:
//   • contextIsolation + sandbox + nodeIntegration:false, one dedicated preload
//     as the ENTIRE privileged surface;
//   • `loadFile` in production — never a remote URL;
//   • every `window.open` denied, every navigation off the loaded page blocked;
//   • a page CSP (`default-src 'none'`, no `connect-src`) shipped in the built
//     index.html by the SPA's own build — see apps/desktop-ui/vite.config.ts.
//     The renderer never touches the network; main does, behind IPC.
//
// NOT WIRED YET. index.js still creates the remote main window; see
// dopl-desktop-app/WIRING.md for the two-line integration.

const path = require('path');
const { BrowserWindow } = require('electron');

const INDEX_HTML = path.join(__dirname, '../renderer/app/index.html');
const PRELOAD = path.join(__dirname, '../renderer/app-preload.js');

// ─── BEGIN SPA-WINDOW-PURE (navigation policy; unit-testable via source extraction) ──
//
// The ONE question this window asks about a URL: may the renderer navigate the
// top frame there? Production answers "only the file: page we loaded"; dev adds
// the Vite origin (HMR reloads the page on some edits). Everything else — a
// link to usedopl.com, an OAuth redirect, an attacker-controlled href — is
// refused here and, if it is a legitimate outbound link, goes through
// `window.dopl.openExternal` into the system browser instead.
//
// `devUrl` is the resolved DOPL_UI_DEV_URL ('' in production); `indexHref` is
// the pathToFileURL href of the ONE local document this window may show. A
// bare `file://` prefix test would admit ANY local document — which inherits
// the window.dopl bridge and (CSP being a per-document <meta>) carries no CSP
// — so the file: comparison is exact on the path, ignoring query/hash.
// Parsing is defensive: a URL we cannot parse is refused, never waved through.
function isAllowedNavigation(url, devUrl, indexHref) {
  const target = String(url || '');
  if (target.startsWith('file:')) {
    if (!indexHref) return false;
    try {
      const t = new URL(target);
      const allowed = new URL(indexHref);
      return t.protocol === 'file:' && t.pathname === allowed.pathname;
    } catch (_err) {
      return false;
    }
  }
  if (!devUrl) return false;
  try {
    return new URL(target).origin === new URL(devUrl).origin;
  } catch (_err) {
    return false;
  }
}
// ─── END SPA-WINDOW-PURE ─────────────────────────────────────────────────────

// Dev serves the Vite dev server (HMR, no rebuild); production loads the file.
// Resolved per call, not at require time, so a test or a relaunch sees the
// current env.
function devUrl() {
  return process.env.DOPL_UI_DEV_URL || '';
}

function createSpaWindow() {
  const dev = devUrl();

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Dopl',
    // --bg-base from the design tokens, so the first paint is not white flash.
    backgroundColor: '#f5f7fa',
    show: false,
    webPreferences: {
      // The renderer's document origin is file:// — user-facing URLs (MCP
      // endpoints, join links) must come from the REAL app origin, passed
      // as a preload constant, never derived from the document.
      additionalArguments: [`--dopl-app-origin=${require('./config').APP_ORIGIN}`],
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (dev) {
    win.loadURL(dev);
  } else {
    win.loadFile(INDEX_HTML);
  }
  win.once('ready-to-show', () => win.show());

  // Defense in depth on top of the page CSP. This window is never a browser.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The same predicate polices EVERY top-frame steering primitive: direct
  // navigation, server-issued redirects, and subframe navigations (frames are
  // frame-src 'none' in the built CSP, but dev loadURL carries no CSP).
  const indexHref = require('node:url').pathToFileURL(INDEX_HTML).href;
  const policeNavigation = (event, url) => {
    if (!isAllowedNavigation(url, devUrl(), indexHref)) event.preventDefault();
  };
  win.webContents.on('will-navigate', policeNavigation);
  win.webContents.on('will-redirect', policeNavigation);
  win.webContents.on('will-frame-navigate', (event) => {
    // Only the main frame may navigate at all; any subframe navigation is
    // refused outright.
    if (!event.isMainFrame) { event.preventDefault(); return; }
    policeNavigation(event, event.url);
  });

  return win;
}

module.exports = { createSpaWindow, isAllowedNavigation, INDEX_HTML };
