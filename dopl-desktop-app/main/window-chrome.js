// THE WINDOW'S OWN CHROME (2026-09-13) — the two ops a FRAMELESS app window needs once macOS
// stops drawing its buttons.
//
// WHY IT EXISTS. `main/agent-window.js` took `frame: false` on Samuel's Wispr-Flow ruling, so the
// agent pop-out has no close button and no zoom button unless its renderer draws them. Drawing
// them is the renderer's job; ACTING on them is not — a page cannot close or zoom its own window.
//
// ⚠ IT IS ITS OWN MODULE AND THAT IS THE §1 SEAM, NOT A PREFERENCE. `main/session-ipc-ops.js` is
// the file these would otherwise join and it is at 508 lines — past the cap the desktop takes no
// exception to (`eslint.config.js`'s own header) — and its subject is SESSIONS, while this one's
// is a WINDOW. Nothing here knows what a session is.
//
// ⚠ EACH OP ACTS ON THE CALLER'S OWN WINDOW AND CANNOT NAME ANOTHER. That is the whole security
// content of this file, and it is structural: the target is `BrowserWindow.fromWebContents(
// event.sender)`, so there is no id, no key and no payload to forge. `agent-window.js ›
// closeAgentWindow`'s header states the rule this obeys — *"a renderer that could shut another app
// window is a nuisance primitive with no feature behind it"* — and a window closing ITSELF is not
// that: it is the same authority the native close button handed the operator until today.
//
// ⚠ THE SENDER BINDING IS THE SAME ONE EVERY PRIVILEGED HANDLER TAKES, written LITERALLY here for
// the reason `ipc-guards.js`'s header gives: hoisting `appWindowOnly` into a shared factory would
// pass review and disarm the structural check that catches the next op. Absent `getSenderIds` (a
// mid-wave caller, a harness) every handler fails CLOSED.
//
// ⚠ REFUSALS SHARE ONE SHAPE — `{ ok: false }` for a foreign sender, an iframe, an unbound
// surface and a window that has already gone — so a hostile page learns nothing from the
// difference. Same rule as `channel-dir-ipc.js`.

const { ipcMain, BrowserWindow } = require('electron');
const { isAppWindowSender } = require('./ipc-guards');
const { diag } = require('./diag');

/**
 * THE CALLER'S OWN WINDOW, or null. Best effort by construction: a window mid-teardown must
 * answer a refusal rather than throw out of an ipc handler.
 */
function ownWindow(event) {
  try {
    const win = BrowserWindow.fromWebContents(event && event.sender);
    return win && !win.isDestroyed() ? win : null;
  } catch (err) {
    diag('window chrome: could not resolve the sender\'s window —', (err && err.message) || String(err));
    return null;
  }
}

function register(opts = {}) {
  const getSenderIds = typeof opts.getSenderIds === 'function' ? opts.getSenderIds : () => null;

  // Wrap a handler so it only ever runs for a bound sender — byte-for-byte the wrapper
  // `channel-dir-ipc.js` and `session-ipc-ops.js` write at every one of their handle sites.
  const appWindowOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isAppWindowSender(event, getSenderIds())) {
      diag('window chrome: refused', name, '— sender is not an app window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  // CLOSE THIS WINDOW — what the native close button did. `close()`, never `destroy()`: the
  // `closed` event is how `agent-window.js` frees the window's budget slot, and a destroyed
  // window skips the lifecycle every other close path runs.
  ipcMain.handle('window:close', appWindowOnly('window:close', { ok: false }, (event) => {
    const win = ownWindow(event);
    if (!win) return { ok: false };
    try {
      win.close();
    } catch (err) {
      diag('window chrome: close failed —', (err && err.message) || String(err));
      return { ok: false };
    }
    return { ok: true };
  }));

  // ZOOM / UN-ZOOM — what the green button did, which is a TOGGLE and must stay one: a
  // renderer that could only maximize would have no way back to the operator's own size.
  // ⚠ IT ANSWERS THE RESULTING STATE so the glyph can follow it, and reads that state back off
  // the window rather than assuming the call landed.
  ipcMain.handle('window:toggleMaximize', appWindowOnly('window:toggleMaximize', { ok: false }, (event) => {
    const win = ownWindow(event);
    if (!win) return { ok: false };
    try {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { ok: true, maximized: win.isMaximized() === true };
    } catch (err) {
      diag('window chrome: toggleMaximize failed —', (err && err.message) || String(err));
      return { ok: false };
    }
  }));
}

module.exports = { register };
