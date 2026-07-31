// IPC bridge for the in-app "Change folder" control (renderer/preload.js exposes
// the matching `window.dopl.channels.*` surface). Kept OUT of index.js so the
// main entrypoint stays under the ENGINEERING §2 500-line cap.
//
// SECURITY MODEL — the main window hosts REMOTE content (usedopl.com), so the
// handlers in this file are the entire privileged surface the web page can reach
// for per-channel settings, and each is deliberately minimal. The three folder
// ops first:
//
//   • channelId is validated as a UUID and rejected otherwise, so a hostile page
//     can't probe arbitrary store keys or smuggle a path fragment through the id.
//   • getFolderLabel / chooseFolder return the ABBREVIATED label only
//     (channel-dirs.liveChannelDirLabel → "~/Downloads/repo" | null). The raw
//     absolute path NEVER crosses back to the renderer, so the local path can't
//     leak to the web page or the Dopl server.
//   • chooseFolder can only OPEN the native OS folder dialog — the USER picks the
//     directory. The page cannot set a path of its own choosing; it can merely
//     trigger a picker the user then drives (or cancels).
//   • No filesystem handle, no absolute path, no listing — nothing beyond these
//     three label-scoped operations is exposed.
//
// Two further ops read/write the per-channel PERMISSION PRESET (the two axes the
// operator picks on the consent card before Allow). They are UUID-gated the same
// way, and every value is re-validated in main against the frozen tool/message
// enums — the renderer can never store a mode that is not one of the eight known
// strings, and a bad pair writes nothing. See main/channel-prefs.js.
//
// The one additional handler here, `sessions:reopen`, is the main-window bridge
// for the web session-card's "Open session" button. It asks the session engine to
// SHOW an existing LIVE session window for a (channel, task) the operator owns; when
// none survives, the engine's P2 fallback (recreateParkedShell) recreates a DORMANT,
// parked window from the durable record + retained sdkSessionId (subject to the shared
// window cap). Either way it starts NO query and runs NO gated tool — a window show()
// or a query-less parked shell (F-072: no read-triggered server/realtime writes) — and
// returns `{ ok }` (ok:false only for a truly-closed thread). channelId is UUID-validated
// like the folder ops; reopenByTask may return a Promise (the fallback is async), which
// ipcMain.handle awaits before replying.
//
// v3.0 VOCABULARY: "Open session" opens the operator's OWN window on a shared THREAD.
// It never starts the agent — only a steer or an accepted inbound resumes a parked
// shell. Wire name `task` == domain name `thread` (the ids stay `taskId`).
// Pinned by test/open-session-no-query.test.mjs.
//
// H3 (2026-07-31) — SENDER BINDING. Every handler below used to answer ANY
// renderer that could reach the channel name: the payload was validated, but the
// CALLER never was. session-ipc.js has always re-derived its target from
// `event.sender` (the frozen §B.3 contract) precisely so a window that does not
// own the thing being changed cannot change it; this file was the one privileged
// surface that skipped that step, while being exposed on the window that loads
// REMOTE usedopl.com content. `mainOnly` below is that missing half, applied to
// all six ops — not just the permission preset that made it a HIGH:
//
//   setPermissionPreset  arms EXECUTION permission for a channel (the H3 report)
//   getPermissionPreset  discloses the posture a channel is armed with
//   chooseFolder         pops a native OS dialog on demand (UI-jacking / nagging)
//   clearFolder          silently resets where a channel's agent runs
//   getFolderLabel       discloses a fragment of the operator's LOCAL path
//   sessions:reopen      opens/recreates session windows for arbitrary threads
//
// Two checks, because one is not enough: the sender must be the main window's
// webContents, AND it must be that window's TOP frame. A cross-origin iframe
// SHARES its host's webContents, so identity alone would still let embedded
// third-party content drive every op above.

const { ipcMain } = require('electron');
const channelDirs = require('./channel-dirs');
const channelPrefs = require('./channel-prefs');
const { diag } = require('./diag');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// ─── BEGIN CHANNEL-IPC-SENDER (pure; unit-tested via source extraction) ──────
// No electron/require refs below, so test/channel-ipc-sender.test.mjs slices this
// and drives it with fakes (the CHANNEL-DIR-RESOLVE idiom).

// TRUE only for the main window's own TOP frame. `win` is resolved at CALL time
// (the window is built after register() runs, and is replaced on reopen), so a
// destroyed or not-yet-built window fails closed rather than throwing.
//
// `senderFrame` is a getter that THROWS once the frame is detached, so it is read
// defensively: a frame we cannot read is refused, never waved through.
function isMainWindowSender(event, win) {
  if (!win || typeof win.isDestroyed !== 'function' || win.isDestroyed()) return false;
  const sender = event && event.sender;
  if (!sender || sender !== win.webContents) return false;
  let frame;
  try {
    frame = event.senderFrame;
  } catch (_) {
    return false; // frame already detached — nothing legitimate calls from there
  }
  // An iframe shares the host's webContents; only the top frame may drive these.
  if (frame && sender.mainFrame && frame !== sender.mainFrame) return false;
  return true;
}
// ─── END CHANNEL-IPC-SENDER ─────

// `opts.onChanged()` (optional) lets index.js refresh the tray so the menu-bar
// "Channel folders" submenu and the in-app control never drift after a set/clear.
// `opts.getMainWindow()` returns the live main BrowserWindow (or null) — the ONE
// sender every handler here is bound to. Absent (a mid-wave caller, a harness),
// every handler fails CLOSED: an unbound privileged surface is not a usable one.
function register(opts = {}) {
  const onChanged = typeof opts.onChanged === 'function' ? opts.onChanged : () => {};
  const getMainWindow = typeof opts.getMainWindow === 'function' ? opts.getMainWindow : () => null;

  // Wrap a handler so it only ever runs for the bound sender. `refusal` is what a
  // rejected call sees — deliberately the SAME shape a bad channel id already
  // returns, so a hostile page learns nothing from the difference.
  const mainOnly = (name, refusal, fn) => (event, ...args) => {
    if (!isMainWindowSender(event, getMainWindow())) {
      diag('channel-dir ipc: refused', name, '— sender is not the main window top frame');
      return refusal;
    }
    return fn(event, ...args);
  };

  // Read the current abbreviated label. Label only — never the absolute path.
  ipcMain.handle('channels:getFolderLabel', mainOnly('getFolderLabel', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return channelDirs.liveChannelDirLabel(channelId);
  }));

  // Open the native picker (user-driven), store the pick, return the fresh label.
  // On cancel the stored dir is unchanged, so the prior label is returned.
  ipcMain.handle('channels:chooseFolder', mainOnly('chooseFolder', null, async (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    try {
      await channelDirs.promptAndSetChannelDir(channelId);
    } catch (err) {
      diag('channel-dir ipc choose error', err && err.message);
    }
    onChanged();
    return channelDirs.liveChannelDirLabel(channelId); // label only
  }));

  // Reset to the sandbox default; there is no custom label afterwards.
  ipcMain.handle('channels:clearFolder', mainOnly('clearFolder', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    channelDirs.clearChannelDir(channelId);
    onChanged();
    return null;
  }));

  // ── Per-channel PERMISSION ARM (main/channel-prefs.js owns the store) ─────
  // The two axes the operator picks on the inbound consent card BEFORE Allow, so
  // the spawned session starts on the posture they approved instead of one they
  // can only correct after the agent is already running.
  //
  // H2 (2026-07-31): what this WRITES is a single-use, expiring ARM, not a durable
  // channel setting. Only the consent-approved launch may consume it, and doing so
  // deletes it. That is what keeps a compromised page's write from mattering: the
  // worst it can do is pre-arm a posture a HUMAN must still explicitly Allow, on a
  // card that shows that posture, before it applies to anything — and if they do
  // not, it expires. See the header of channel-prefs.js for the full contract.
  //
  // Same guards as the folder ops, plus two more: the sender is bound (mainOnly)
  // and the renderer is NEVER trusted with the values. channelId is UUID-gated
  // here; both modes are re-validated in channel-prefs against the frozen enums
  // and an unknown value on either axis writes nothing ({ ok: false }).

  // → { tools, messages } for the channel, or null when nothing is armed (the
  //   card then shows the defaults without claiming they were chosen). Reading
  //   NEVER extends the arm's life.
  ipcMain.handle('channels:getPermissionPreset', mainOnly('getPermissionPreset', null, (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return channelPrefs.getPermissionPreset(channelId);
  }));

  // → { ok: true } when BOTH axes validated and the pair was armed; { ok: false }
  //   for a bad channel id or an unknown mode. Fail-closed: nothing is written on
  //   a partial or unknown pair.
  ipcMain.handle('channels:setPermissionPreset', mainOnly('setPermissionPreset', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    return channelPrefs.armPermissionPreset(p.channelId, p.preset);
  }));

  // Reveal a LIVE session window for a (channel, task) from the MAIN window.
  // channelId is UUID-validated (the same anti-probe guard as the folder ops);
  // taskId is an opaque string (a legacy `task-{channel}-{seq}` id or a
  // first-class UUID), coerced and handed to the engine, which resolves the
  // session by `store.sessionKey(channelId, taskId)`. `reopenByTask` is a
  // T2-added export; if it is not wired yet (mid-wave), fail closed with
  // { ok: false } rather than throwing. Lazy-require to avoid any load-time
  // cycle — the engine is only touched when a reopen is actually requested.
  ipcMain.handle('sessions:reopen', mainOnly('sessions:reopen', { ok: false }, (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.reopenByTask !== 'function') return { ok: false };
    return engine.reopenByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
    });
  }));
}

module.exports = { register };
