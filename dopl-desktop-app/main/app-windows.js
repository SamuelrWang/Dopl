// THE REGISTRY OF APP-OWNED WINDOWS — the subject every renderer-reachable
// `ipcMain.handle` is bound to (wiring plan Phase 10, 2026-08-18).
//
// WHY IT EXISTS. Until this module, "may this sender call a privileged handler?"
// was answered with "is it THE MAIN WINDOW's webContents, and its top frame?"
// (`main/ui-bridge.js` and `main/channel-dir-ipc.js`, both fail-closed, both
// refusing in the shape of an invalid payload so a hostile page learns nothing).
// That binding is what made the opt-in POP-OUT THREAD WINDOW impossible: a second
// SPA window would have had every `apiRequest` refused and would have rendered
// nothing while reporting nothing — the silent-feature-deletion failure mode
// INVARIANTS §11 describes.
//
// ⚠ SAMUEL'S RULING, 2026-08-18, ON THE RECORD: option (a) — WIDEN the binding to
// a registry of app-owned windows, deliberately. Option (b) (reuse the session
// window's renderer for the thread view) was REJECTED because it builds the
// thread view twice, which is the duplication the channels port exists to remove.
//
// ⚠ WHAT THE WIDENING DOES **NOT** RELAX. The iframe check is untouched and is
// still the reason a bare identity check is not enough: a cross-origin iframe
// SHARES its host's `webContents`, so `event.sender` alone would admit embedded
// third-party content. The guards still demand the sender's own TOP FRAME. What
// changed is only WHICH windows may be that sender.
//
// ⚠ THE REGISTRY IS WRITE-ONLY FROM MAIN, AND THAT IS THE WHOLE SECURITY ARGUMENT.
// `register(win)` is a main-process function called at WINDOW CREATION by
// main-process code (`main/shell-mode.js › createShellWindow` for the shell,
// `main/popout-window.js` for a pop-out) and by nothing else. It is not exposed on
// any preload, it is behind no `ipcMain.handle`, and it takes a live BrowserWindow
// — an object a renderer cannot name, let alone hand across IPC. A renderer
// therefore cannot enlarge the set it is judged against; the most it can do is ask
// main to open a window main itself then registers.
// `test/app-windows.test.mjs` asserts that by construction (no handler, no preload
// mention, every call site in `main/`).
//
// ⚠ A DESTROYED WINDOW LEAVES THE SET. `webContents.id` is a per-process counter
// and is not reused, so a stale id is not directly forgeable — but a set that only
// grows is the shape this tree has been bitten by, and "the bound senders" must
// mean the LIVE ones. Removal is belt AND braces: both lifecycle events are bound
// at registration, and every read sweeps first, so a window that died without
// emitting either still falls out.

const { diag } = require('./diag');

// The registered windows themselves, not their ids: the ids are DERIVED on every
// read (below) so a webContents replaced under a live window can never leave a
// stale number bound.
const registered = new Set();

// ─── BEGIN APP-WINDOWS-PURE (liveness; unit-testable via source extraction) ──
// No electron/require refs below.

// A window is only a legitimate sender while BOTH halves are alive: Electron
// tears the webContents down independently, and reading `win.webContents` on a
// destroyed window THROWS, so every access here is defensive.
function isLiveWindow(win) {
  if (!win || typeof win.isDestroyed !== 'function') return false;
  try {
    if (win.isDestroyed()) return false;
    const wc = win.webContents;
    if (!wc) return false;
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return false;
    return true;
  } catch (_err) {
    // A window mid-teardown answers by throwing. That is a "no".
    return false;
  }
}

// The webContents id of a live window, or null. Kept separate from isLiveWindow
// so the sweep and the id derivation cannot disagree about what "live" means.
function liveSenderId(win) {
  if (!isLiveWindow(win)) return null;
  try {
    const id = win.webContents.id;
    return typeof id === 'number' ? id : null;
  } catch (_err) {
    return null;
  }
}
// ─── END APP-WINDOWS-PURE ────────────────────────────────────────────────────

function forget(win) {
  if (registered.delete(win)) diag('app-windows: released a window —', 'live=' + registered.size);
}

/** Drop everything that is no longer live, then answer the set. */
function sweep() {
  for (const win of Array.from(registered)) {
    if (!isLiveWindow(win)) registered.delete(win);
  }
  return registered;
}

/**
 * BIND a window main just created. ⚠ MAIN-PROCESS ONLY — see the header: nothing
 * renderer-reachable may reach this function, and no IPC handler calls it.
 * Idempotent, and a dead window is refused rather than bound.
 */
function register(win) {
  if (!isLiveWindow(win)) return null;
  if (registered.has(win)) return win;
  registered.add(win);
  // BELT AND BRACES. 'closed' fires for the window, 'destroyed' for its
  // webContents, and either can come first (or, on a crash path, alone).
  try { win.on('closed', () => forget(win)); } catch (_err) { /* not an emitter */ }
  try { win.webContents.on('destroyed', () => forget(win)); } catch (_err) { /* gone already */ }
  diag('app-windows: bound a window —', 'live=' + registered.size);
  return win;
}

/** The LIVE app windows, swept. Callers fan a push out over this. */
function liveWindows() {
  return Array.from(sweep());
}

/**
 * The set of `webContents.id`s a privileged handler may answer — THE bound
 * senders, derived fresh on every call. An empty set is a DEAD privileged
 * surface, which is the correct state before the first window exists.
 */
function senderIds() {
  const ids = new Set();
  for (const win of sweep()) {
    const id = liveSenderId(win);
    if (id !== null) ids.add(id);
  }
  return ids;
}

/** Live count — for diagnostics and for the window budget a pop-out respects. */
function count() {
  return sweep().size;
}

module.exports = {
  register,
  liveWindows,
  senderIds,
  count,
  // The pure half, for callers that need the rule rather than the registry.
  isLiveWindow,
};
