// IPC bridge for the in-app "Change folder" control (renderer/preload.js exposes
// the matching `window.dopl.channels.*` surface). Kept OUT of index.js so the
// main entrypoint stays under the ENGINEERING §2 500-line cap.
//
// SECURITY MODEL — the main window hosts REMOTE content (usedopl.com), so these
// three handlers are the entire privileged surface the web page can reach for
// channel folders, and each is deliberately minimal:
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
// The one additional handler here, `sessions:reopen`, is the main-window bridge
// for the web session-card's "Reopen window" button: it asks the session engine
// to SHOW an existing LIVE session window for a (channel, task) the operator
// owns. It starts no query and creates no server/realtime state (F-072) — a
// window `show()` only — and returns `{ ok }` (ok:false when no live session
// exists for the pair). channelId is UUID-validated like the folder ops.

const { ipcMain } = require('electron');
const channelDirs = require('./channel-dirs');
const { diag } = require('./diag');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

// `opts.onChanged()` (optional) lets index.js refresh the tray so the menu-bar
// "Channel folders" submenu and the in-app control never drift after a set/clear.
function register(opts = {}) {
  const onChanged = typeof opts.onChanged === 'function' ? opts.onChanged : () => {};

  // Read the current abbreviated label. Label only — never the absolute path.
  ipcMain.handle('channels:getFolderLabel', (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    return channelDirs.liveChannelDirLabel(channelId);
  });

  // Open the native picker (user-driven), store the pick, return the fresh label.
  // On cancel the stored dir is unchanged, so the prior label is returned.
  ipcMain.handle('channels:chooseFolder', async (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    try {
      await channelDirs.promptAndSetChannelDir(channelId);
    } catch (err) {
      diag('channel-dir ipc choose error', err && err.message);
    }
    onChanged();
    return channelDirs.liveChannelDirLabel(channelId); // label only
  });

  // Reset to the sandbox default; there is no custom label afterwards.
  ipcMain.handle('channels:clearFolder', (_event, channelId) => {
    if (!isUuid(channelId)) return null;
    channelDirs.clearChannelDir(channelId);
    onChanged();
    return null;
  });

  // Reveal a LIVE session window for a (channel, task) from the MAIN window.
  // channelId is UUID-validated (the same anti-probe guard as the folder ops);
  // taskId is an opaque string (a legacy `task-{channel}-{seq}` id or a
  // first-class UUID), coerced and handed to the engine, which resolves the
  // session by `store.sessionKey(channelId, taskId)`. `reopenByTask` is a
  // T2-added export; if it is not wired yet (mid-wave), fail closed with
  // { ok: false } rather than throwing. Lazy-require to avoid any load-time
  // cycle — the engine is only touched when a reopen is actually requested.
  ipcMain.handle('sessions:reopen', (_event, payload) => {
    const p = payload || {};
    if (!isUuid(p.channelId)) return { ok: false };
    const engine = require('./session-engine');
    if (typeof engine.reopenByTask !== 'function') return { ok: false };
    return engine.reopenByTask({
      channelId: p.channelId,
      taskId: String(p.taskId || ''),
    });
  });
}

module.exports = { register };
