// Per-channel working directory (Round C) — LOCAL ONLY.
//
// Lets the operator point a channel's responding agent at a REAL project folder
// instead of the isolated per-channel scratch dir, so the agent works with real
// context — and that project's own CLAUDE.md plus the global ~/.claude both still
// load, because we only change the spawn cwd and add NO --bare / context-
// suppressing flag (auto-discovery walks up from cwd; global config is always on).
//
// PRINCIPLE — cwd is CONTEXT, not a fence. The directory is only WHERE the agent
// starts and its default working directory. It does NOT sandbox the agent to that
// folder: the real bound is the tool profile (tool-profiles.js) plus the two
// consent gates (inbound approve + outbound review). A read_only spawn pointed at
// ~/Downloads still cannot write or exfiltrate; a full spawn could already reach
// the whole filesystem regardless of its cwd. So this picks a LOCATION only, never
// what the spawn is allowed to do.
//
// PRIVACY — the chosen path is personal to this machine. It lives ONLY in the
// local electron-store, is NEVER POSTed to Dopl, never put in a channel message,
// and never logged (not even in diag — we log the channel id only). The web
// consent card can show the tool profile but not this path, by design.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { dialog, BrowserWindow } = require('electron');
const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();
const CHANNEL_DIRS_KEY = 'channelDirs'; // { [channelId]: absolutePath }

// ─── BEGIN CHANNEL-DIR-RESOLVE (pure; unit-tested via source extraction) ─────
// No electron/fs/store/require refs below, so test/channel-dirs.test.mjs can slice
// this block and evaluate it verbatim (same pattern as seedModeFor / WATCHER-PURE).

// Decide the spawn cwd. A stored per-channel dir that STILL EXISTS (probed via the
// injected dirExists) wins; anything else — unset, blank, or deleted since it was
// chosen — falls back to the sandbox dir. This is the whole "stored+exists → that
// dir; missing/deleted → sandbox fallback" rule, kept pure so it is unit-tested
// without electron. It chooses a LOCATION only; containment is the tool profile.
function resolveSpawnDir(storedDir, sandboxDir, dirExists) {
  const s = typeof storedDir === 'string' ? storedDir.trim() : '';
  if (s && dirExists(s)) return { dir: s, usingCustom: true };
  return { dir: sandboxDir, usingCustom: false };
}

// Abbreviate $HOME to ~ for DISPLAY ONLY (never used to build a real path). macOS
// paths, so '/' is the separator. The trailing-slash prefix check keeps a sibling
// like /Users/menace from matching /Users/me.
function abbreviateHome(p, home) {
  const s = String(p == null ? '' : p);
  if (!home) return s;
  if (s === home) return '~';
  const prefix = home.endsWith('/') ? home : home + '/';
  return s.startsWith(prefix) ? '~/' + s.slice(prefix.length) : s;
}
// ─── END CHANNEL-DIR-RESOLVE ─────

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

// ── Storage (electron-store; never leaves the machine) ───────────────────────
function getAllChannelDirs() {
  return store.get(CHANNEL_DIRS_KEY) || {};
}

function getChannelDir(channelId) {
  const map = getAllChannelDirs();
  return map[channelId] || null;
}

// Validate before storing: an absolute path that exists as a directory RIGHT NOW.
// Returns { ok, dir } — the path is not logged (privacy), only the channel id.
function setChannelDir(channelId, absPath) {
  if (!channelId || typeof absPath !== 'string' || !path.isAbsolute(absPath) || !isDir(absPath)) {
    return { ok: false };
  }
  const map = getAllChannelDirs();
  map[channelId] = absPath;
  store.set(CHANNEL_DIRS_KEY, map);
  diag('channel-dir set', String(channelId).slice(0, 8)); // path itself NOT logged
  return { ok: true, dir: absPath };
}

function clearChannelDir(channelId) {
  const map = getAllChannelDirs();
  if (channelId in map) {
    delete map[channelId];
    store.set(CHANNEL_DIRS_KEY, map);
    diag('channel-dir cleared', String(channelId).slice(0, 8));
  }
}

// ── Read-only views (tray + notification) ────────────────────────────────────
// The stored dir IF it still exists, as a RAW path. No self-heal here (read path).
function rawLiveChannelDir(channelId) {
  const stored = getChannelDir(channelId);
  return stored && isDir(stored) ? stored : null;
}

// Display label for the tray / consent notification: "~/Downloads", or null when
// no live custom dir is set (the caller renders the sandbox default itself).
function liveChannelDirLabel(channelId) {
  const raw = rawLiveChannelDir(channelId);
  return raw ? abbreviateHome(raw, os.homedir()) : null;
}

// ── Spawn cwd (session-spawner) ──────────────────────────────────────────────
// The cwd for a channel's spawn: the operator's chosen dir when it still exists,
// else the sandbox fallback. SELF-HEAL: a stored dir that was deleted since it was
// chosen is cleared here so the tray stops offering a dead path and the next set
// starts clean. Only the LOCATION is decided; the tool profile still bounds the
// spawn (cwd is context, not a fence).
function spawnDirFor(channelId, sandboxDir) {
  const stored = getChannelDir(channelId);
  const { dir, usingCustom } = resolveSpawnDir(stored, sandboxDir, isDir);
  if (stored && !usingCustom) clearChannelDir(channelId); // deleted → drop it
  return dir;
}

// ── Session-window cwd (item 6/7) — hardcoded ~/Downloads default, no setting/tray ──
// Item 6: the default session dir is ~/Downloads when it exists, else the homedir
// (never a non-existent path). Computed OUTSIDE the pure block (uses fs/os) and passed
// INTO resolveSpawnDir as the fallback (§H-7), so the pure block stays electron-free.
function defaultSessionDir() {
  const downloads = path.join(os.homedir(), 'Downloads');
  return isDir(downloads) ? downloads : os.homedir();
}

// Item 7: the SDK cwd for a channel's session window — the stored per-channel dir when
// it still exists, else ~/Downloads. This is what session-engine.buildSdkOptions reads
// at launch so per-channel persistence is finally honored. No self-heal here (a pure
// read path used by resolvedDirLabel too); spawnDirFor still owns the deleted-dir sweep.
function sessionSpawnDir(channelId) {
  return resolveSpawnDir(getChannelDir(channelId), defaultSessionDir(), isDir).dir;
}

// Item 5: the abbreviated LABEL for the folder pill — ALWAYS a real dir short-form
// ("~/Downloads" unset, "~/Downloads/repo" when a per-channel dir is set), never null.
// Label-only crosses the bridge; the abs path never does (§H-9).
function resolvedDirLabel(channelId) {
  return abbreviateHome(sessionSpawnDir(channelId), os.homedir());
}

// ── Native directory picker ──────────────────────────────────────────────────
// Resolves the chosen absolute dir (validated to exist) or null (cancelled /
// invalid). `createDirectory` lets the operator make a new folder in the panel.
async function pickDirectory() {
  const win = BrowserWindow.getFocusedWindow() || null;
  const opts = {
    title: 'Choose a folder for this channel',
    message: 'The responding agent will run here. This stays on your Mac.',
    properties: ['openDirectory', 'createDirectory'],
  };
  let result;
  try {
    result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  } catch (err) {
    diag('channel-dir picker error', err && err.message);
    return null;
  }
  if (!result || result.canceled) return null;
  const dir = (result.filePaths && result.filePaths[0]) || '';
  if (!dir || !path.isAbsolute(dir) || !isDir(dir)) return null;
  return dir;
}

// Picker + store in one step. Resolves { set, dir } | { cancelled } | { failed }.
async function promptAndSetChannelDir(channelId) {
  const dir = await pickDirectory();
  if (!dir) return { cancelled: true };
  const res = setChannelDir(channelId, dir);
  return res.ok ? { set: true, dir } : { failed: true };
}

module.exports = {
  resolveSpawnDir,
  abbreviateHome,
  getAllChannelDirs,
  getChannelDir,
  setChannelDir,
  clearChannelDir,
  liveChannelDirLabel,
  spawnDirFor,
  defaultSessionDir,
  sessionSpawnDir,
  resolvedDirLabel,
  pickDirectory,
  promptAndSetChannelDir,
};
