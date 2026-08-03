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
// `devUrl` is the resolved DOPL_UI_DEV_URL ('' in production). Parsing is
// defensive: a URL we cannot parse is refused, never waved through.
function isAllowedNavigation(url, devUrl) {
  const target = String(url || '');
  if (target.startsWith('file://')) return true;
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
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devUrl())) event.preventDefault();
  });

  return win;
}

module.exports = { createSpaWindow, isAllowedNavigation, INDEX_HTML };
