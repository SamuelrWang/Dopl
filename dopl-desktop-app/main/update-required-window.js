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
  if (frame && sender.mainFrame && frame !== sender.mainFrame) return false;
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

  win = new BrowserWindow({
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

  win.loadFile(PAGE);
  win.once('ready-to-show', () => { win.show(); win.focus(); });

  // Live narration: the download's progress and the moment it is installable
  // arrive here, so the screen never looks like a dead end while ~200MB comes
  // down. That is the same failure update-policy.js exists for.
  unsubscribe = versionGate.subscribe((state) => {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send(STATE_CHANNEL, state); } catch (_) { /* window going away */ }
  });

  // This window is never a browser.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const police = (event) => event.preventDefault();
  win.webContents.on('will-navigate', police);
  win.webContents.on('will-redirect', police);

  win.on('closed', () => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    win = null;
  });

  return win;
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
