// Auto-update via electron-updater against GitHub Releases (SamuelrWang/Dopl),
// mirroring the study-notes app's proven setup: zip + dmg + latest-mac.yml feed.
//
// Behavior: check at startup and every 4h; download silently; when an update is
// downloaded, show one notification and add an "Update ready — restart to
// install" tray item. Never force-restarts on its own — install happens on
// normal quit (autoInstallOnAppQuit) or the explicit tray click. A background
// listener app must not yank itself out from under an active spawned session.
//
// Q10: THE STAGED INSTALL IS THE FAILURE MODE. "Installs on quit" plus "never
// quits" equals a Mac running a build nobody believes it is running — on
// 2026-07-31 a peer sat on 1.7.14 all evening and the 1.7.15 fix read as broken.
// So the download event has to reach a HUMAN surface, not just the log: the
// notification names the action (restart), the tray item is the click that does
// it, and the tray tooltip carries it without the menu being opened. The
// operator still decides when — a restart mid-turn kills a live session.

const { app, Notification } = require('electron');
const { diag } = require('./diag');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h

let autoUpdater = null;
let readyVersion = null; // set once an update is downloaded
let onReadyCb = null;
let notified = false;

function init(opts) {
  onReadyCb = (opts && opts.onReady) || null;

  // Dev runs aren't signed against the feed and would just error.
  if (!app.isPackaged) {
    diag('updater: skip (not packaged)');
    return;
  }

  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    diag('updater: module load failed', err && err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // electron-updater's default logger is console (invisible for us) — route
  // the interesting transitions through diag instead.
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    diag('updater: update available', info && info.version);
  });
  autoUpdater.on('update-not-available', () => {
    diag('updater: up to date');
  });
  autoUpdater.on('error', (err) => {
    // Common benign case: no release published yet / offline. Log, never surface.
    diag('updater: error', err && err.message);
  });
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = (info && info.version) || 'new version';
    diag('updater: downloaded', readyVersion);
    if (onReadyCb) {
      try { onReadyCb(readyVersion); } catch (_) { /* tray may be gone */ }
    }
    if (!notified) {
      notified = true;
      try {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Dopl update ready',
            body: `Version ${readyVersion} is downloaded. It installs when you restart Dopl `
              + `(menu bar icon, "Update ready"). Until then this Mac keeps running the old build.`,
            silent: true,
          }).show();
        }
      } catch (_) { /* best-effort */ }
    }
  });

  const check = () => {
    try {
      autoUpdater.checkForUpdates().catch((err) => {
        diag('updater: check failed', err && err.message);
      });
    } catch (err) {
      diag('updater: check threw', err && err.message);
    }
  };
  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  diag('updater: armed (4h interval)');
}

// Tray "Restart to install" action. quitAndInstall runs the normal quit path
// (before-quit fires → listener teardown), then relaunches updated.
function quitAndInstall() {
  if (!autoUpdater || !readyVersion) return;
  diag('updater: quitAndInstall', readyVersion);
  try {
    app.isQuitting = true;
    autoUpdater.quitAndInstall();
  } catch (err) {
    diag('updater: quitAndInstall failed', err && err.message);
  }
}

// Q10 — THE STATE, ASKABLE WITHOUT THE EVENT. `onReady` fires exactly once, so
// anything built after the download would otherwise never learn about it. These
// two were added for that and sat with ZERO callers until 2026-07-31; tray.js
// (refreshUpdateReady) now reads them on every menu rebuild, which is what makes
// the restart item independent of index.js's create()-then-init() ordering.
function updateReadyVersion() {
  return readyVersion;
}

function isUpdateReady() {
  return !!readyVersion;
}

module.exports = { init, quitAndInstall, updateReadyVersion, isUpdateReady };
