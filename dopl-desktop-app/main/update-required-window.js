// The BLOCKING "update required" window — the one screen a build below the
// server's minimum version is allowed to show.
//
// WHY IT IS A WINDOW AND NOT A BANNER IN THE SPA. The gate has to hold when the
// SPA is the thing that is too old to be trusted, so the block cannot live
// inside it. This is a local page with its own preload, created by the SAME
// factory every "open the app" path already goes through (shell-mode.js
// createShellWindow), which is what makes the block total without a single new
// interception point: the dock icon, the tray's "Open Dopl", a notification
// click and a dopl:// deep link all land here for as long as the gate says so,
// because they all end up asking that factory for a window.
//
// QUIT ALWAYS WORKS, and is stated on the screen rather than implied. The tray's
// Quit, Cmd+Q and the button below are three independent ways out; none of them
// goes through the gate. A forced upgrade is a nudge, not a hostage situation.
//
// SECURITY. The window's shape is session-window.js / spa-window.js verbatim:
// contextIsolation + sandbox + nodeIntegration:false, one dedicated preload as
// the entire privileged surface, `loadFile` only, every window.open denied and
// every navigation off the loaded document refused. The three IPC handlers are
// SENDER-BOUND to this window's own top frame (the H3 idiom from
// channel-dir-ipc.js), because `restart` and `quit` end the process and no other
// renderer has any business reaching them.

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const versionGate = require('./version-gate');
const { diag } = require('./diag');

const PAGE = path.join(__dirname, '../renderer/update-required.html');
const PRELOAD = path.join(__dirname, '../renderer/update-required-preload.js');
const STATE_CHANNEL = 'update-gate:state';

let win = null;
let unsubscribe = null;
let registered = false;

// TRUE only for this window's own top frame. Resolved at CALL time (the window
// is rebuilt whenever the gate re-blocks) and defensive about `senderFrame`,
// which throws once a frame is detached: a frame we cannot read is refused.
//
// ⚠ THE THIRD COPY OF THE F-221 GUARD, and it was the last lenient one. Until
// 2026-08-18 (wave-2 fix pass) this read
// `if (frame && sender.mainFrame && frame !== sender.mainFrame) return false`,
// which WAVES THROUGH a `senderFrame` that reads as null/undefined — the exact
// pre-Phase-10 form that `main/channel-dir-ipc.js › isAppWindowSender` and
// `main/ui-bridge.js › isAppWindowSender` were both closed to. It is now
// byte-consistent with them. ⚠ A predicate with three copies is a predicate
// that WILL drift; if a fourth is ever needed, extract it instead.
function isGateSender(event) {
  if (!win || win.isDestroyed()) return false;
  const sender = event && event.sender;
  if (!sender || sender !== win.webContents) return false;
  let frame;
  try {
    frame = event.senderFrame;
  } catch (_) {
    return false;
  }
  // ⚠ FAIL CLOSED: an unreadable frame, or a webContents whose mainFrame is gone, is refused.
  if (!frame || !sender.mainFrame || frame !== sender.mainFrame) return false;
  return true;
}

// Registered once per process, not per window: ipcMain handlers are global and
// re-registering would throw on the second block.
function registerIpc() {
  if (registered) return;
  registered = true;

  const gateOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isGateSender(event)) {
      diag('update-gate ipc: refused', name, '— sender is not the gate window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  // What to draw right now. Also the initial paint: the page asks once on load
  // rather than waiting for the first push, so a window created after the
  // verdict settled is never blank.
  ipcMain.handle(STATE_CHANNEL, gateOnly('state', null, () => versionGate.screen()));

  // The screen's one button, routed to the updater that owns it.
  ipcMain.handle('update-gate:act', gateOnly('act', false, (_event, id) =>
    versionGate.act(String(id || ''))));

  // The way out. `isQuitting` is what turns this into a real terminate rather
  // than a hide, the same flag the tray's Quit sets.
  ipcMain.handle('update-gate:quit', gateOnly('quit', false, () => {
    diag('update-gate: quit from the blocking screen');
    app.isQuitting = true;
    app.quit();
    return true;
  }));
}

function createUpdateRequiredWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }
  registerIpc();

  // Held in a local as well as the module slot: `closed` arrives a tick after
  // destroy(), by which time a release-then-reblock may already have put a NEW
  // window in the slot. A handler that nulled it blindly would orphan the live
  // window — every IPC call from it would then fail isGateSender and the screen
  // would go blank and buttonless. See the guard on `closed` below.
  const created = new BrowserWindow({
    width: 520,
    height: 460,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Dopl',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win = created;
  created.loadFile(PAGE);
  created.once('ready-to-show', () => { created.show(); created.focus(); });

  // Live narration: the download's progress and the moment it is installable
  // arrive here, so the screen never looks like a dead end while ~200MB comes
  // down. That is the same failure update-policy.js exists for.
  unsubscribe = versionGate.subscribe((state) => {
    if (created.isDestroyed()) return;
    try { created.webContents.send(STATE_CHANNEL, state); } catch (_) { /* window going away */ }
  });

  // This window is never a browser.
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const police = (event) => event.preventDefault();
  created.webContents.on('will-navigate', police);
  created.webContents.on('will-redirect', police);

  created.on('closed', () => {
    if (win !== created) return; // a newer window already owns the slot
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    win = null;
  });

  return created;
}

// Called when the gate releases. The window goes away entirely rather than
// hiding: the next "open the app" must build the real shell, and a live blocked
// window listening for pushes would keep answering for a state that is over.
function closeUpdateRequiredWindow() {
  if (!win || win.isDestroyed()) { win = null; return; }
  const dying = win;
  win = null;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  try { dying.destroy(); } catch (err) { diag('update-gate: close failed', err && err.message); }
}

module.exports = { createUpdateRequiredWindow, closeUpdateRequiredWindow, PAGE };
