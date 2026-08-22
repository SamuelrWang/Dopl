// Auto-update via electron-updater against GitHub Releases (SamuelrWang/Dopl),
// mirroring the study-notes app's proven setup: zip + dmg + latest-mac.yml feed.
//
// Behavior: check at startup, on an interval (30m by default since 2026-08-22,
// overridable via DOPL_UPDATE_CHECK_MS and clamped to [60s, 24h] — see
// update-policy.js), and WHENEVER THE OPERATOR LOOKS AT THE APP (see the focus
// check below);
// download silently with progress on the tray; when the download completes,
// offer a one-click restart. Never force-restarts on its own: install happens on
// normal quit (autoInstallOnAppQuit) or an explicit click. A background listener
// app must not yank itself out from under an active spawned session.
//
// Q10: THE STAGED INSTALL IS THE FAILURE MODE. "Installs on quit" plus "never
// quits" equals a Mac running a build nobody believes it is running — on
// 2026-07-31 a peer sat on 1.7.14 all evening and the 1.7.15 fix read as broken.
// So the download event has to reach a HUMAN surface, not just the log.
//
// WHAT "CLOSE AND REOPEN DOES NOT GET THE NEW BUILD" ACTUALLY IS (2026-08-01).
// The operator's report was "it takes several tries over a few minutes". Nothing
// is flaky: the cycle is START (download ~200MB in the background) → QUIT
// (install) → START (new build), so ONE close-and-reopen can never suffice, and
// quitting mid-download discards the partial copy, which is why it takes tries.
// Three things were missing and are now here:
//   1. the moment the download lands, an actionable RESTART prompt (one click),
//   2. `download-progress` on a visible surface, so a long download stops looking
//      like nothing happening (the reason people quit halfway),
//   3. a manual "Check for updates now", because 4h after a publish is forever.
//
// UPDATE DISCOVERY LATENCY (2026-08-22, Samuel's ruling). Item 3 was a button;
// the operator's actual habit was to QUIT AND REOPEN the app to force the boot
// check, which is the feature failing at its one job. Two changes: the interval
// dropped 4h → 30m, and a FOCUS CHECK now runs whenever the app is activated.
// The focus path is the one that matters — a release becomes visible the moment
// somebody goes to look, with no restart and no menu click.
// The one thing deliberately NOT added is an automatic restart. The operator may
// be mid-exchange with a live agent; the prompt names any live session and
// defaults to "Later".

const { app, Notification, dialog } = require('electron');
const { diag } = require('./diag');
const { UPDATER } = require('./config');
const policy = require('./update-policy');
const appVersion = require('./app-version');

let autoUpdater = null;
let readyVersion = null; // set once an update is downloaded
let onReadyCb = null;
let onNoteCb = null; // tray.setUpdateNote — the "what is the updater doing" line
let onStateCb = null; // min-version gate — see updateState() below
let getLiveSessions = null; // injected: sessionEngine.listLiveSessions
let notified = false;
let downloading = false;
let manualPending = false; // a manual check is in flight -> failures ARE surfaced
let promptOpen = false; // single-flight: never two restart dialogs
let promptedThisRun = false; // the auto prompt fires at most once per run

// ── The state, as a fact other modules can act on (min-version gate) ─────────
// The note above is PROSE for a human; the minimum-version gate needs the same
// story as booleans, because one of them decides whether the app is allowed to
// open at all. `checked` in particular is load-bearing: a floor above the newest
// published build would block everyone with nothing to install, and the only
// honest evidence that "there is nothing newer" is a check that COMPLETED.
// An errored check therefore does NOT set it — it learned nothing.
let supported = false; // packaged, and electron-updater actually loaded
let checked = false; // a check has completed this run (available or not)
let available = false; // something newer was found and is coming down
let checking = false; // a check is in flight right now
let failed = false; // the LAST attempt errored and nothing has succeeded since
let lastPercent = null; // newest download-progress percent, or null (unknown)
// ⚠ WHEN A REQUEST WAS LAST ISSUED — NOT WHEN ONE LAST SUCCEEDED (2026-08-22).
// It is the rate limiter behind the focus check, and it is stamped at the point
// the request goes out, for one reason: an errored check still COST a request. A
// stamp that only moved on success would turn an offline machine into one request
// per window focus, which is the exact hammering the gap exists to prevent. It is
// shared with the interval, so a focus a second after a scheduled check asks
// nothing and a scheduled check does not reset the operator's gap.
let lastCheckAt = 0;

// WHY `failed` IS ITS OWN FIELD and does not just clear `available`. An error
// can arrive mid-DOWNLOAD, and the two readers want opposite things from it:
//   • the VERDICT wants `available` left alone — an update genuinely exists, we
//     just failed to fetch it, and clearing it would hand the anti-brick guard
//     a false "nothing is published" and relax a real block;
//   • the SCREEN wants to stop rendering a progress spinner for a download that
//     is no longer running, because a spinner with no button under it is the
//     dead end this whole surface exists to avoid.
// So the failure is reported as a fact of its own and each side reads it.
function updateState() {
  return {
    supported,
    checked,
    available,
    ready: !!readyVersion,
    checking,
    failed,
    version: readyVersion || null,
    percent: lastPercent,
  };
}

function emitState() {
  if (!onStateCb) return;
  try { onStateCb(updateState()); } catch (_) { /* listener may be gone */ }
}

// The tray note. Also mirrored into diag, so the field log tells the same story
// the menu bar does. Every transition passes through here, which makes it the
// one place the state fan-out has to hang off.
function note(outcome, ctx) {
  const n = policy.checkNote(outcome, ctx);
  diag('updater:', outcome, n.text ? `(${n.text})` : '');
  emitState();
  if (!onNoteCb) return;
  try { onNoteCb(n.text, { busy: n.busy }); } catch (_) { /* tray may be gone */ }
}

function liveSessions() {
  if (!getLiveSessions) return [];
  try {
    const list = getLiveSessions();
    return Array.isArray(list) ? list : [];
  } catch (err) {
    // Never let an accounting read block a restart prompt; an unknown answer is
    // treated as "none", and the prompt still says a restart ends what is running.
    diag('updater: live-session read failed', err && err.message);
    return [];
  }
}

function init(opts) {
  onReadyCb = (opts && opts.onReady) || null;
  onNoteCb = (opts && opts.onNote) || null;
  onStateCb = (opts && opts.onState) || null;
  getLiveSessions = (opts && opts.getLiveSessions) || null;

  // Dev runs aren't signed against the feed and would just error. The note is set
  // anyway so the tray's "Check for updates now" says WHY it does nothing here
  // instead of reading as a dead button.
  //
  // `supported` stays FALSE on both of these paths, and that is what stops the
  // min-version gate from hard-blocking a machine whose updater could never
  // clear the block (min-version.js GUARD 1).
  if (!app.isPackaged) {
    note('unsupported');
    diag('updater: skip (not packaged)');
    return;
  }

  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    note('unsupported');
    diag('updater: module load failed', err && err.message);
    return;
  }
  supported = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // electron-updater's default logger is console (invisible for us) — route
  // the interesting transitions through diag instead.
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    checking = true;
    failed = false; // a new attempt is running: the last failure is history
    note('checking');
  });
  autoUpdater.on('update-available', (info) => {
    downloading = true;
    checking = false;
    checked = true;
    available = true;
    failed = false;
    manualPending = false; // the outcome is now the download, not a check result
    note('downloading', { version: info && info.version });
  });
  autoUpdater.on('update-not-available', () => {
    downloading = false;
    checking = false;
    checked = true; // THE evidence the min-version gate's anti-brick guard needs
    available = false;
    failed = false;
    manualPending = false;
    note('up-to-date', { version: appVersion.appVersion() });
  });
  // A ~200MB download over a slow link used to be invisible. This is what makes
  // "it is working, wait" a thing the operator can see (item 2).
  autoUpdater.on('download-progress', (info) => {
    downloading = true;
    lastPercent = policy.progressPercent(info);
    // The gate's blocking screen narrates this download, so the fan-out happens
    // before the early return that only guards the TRAY note.
    emitState();
    if (!onNoteCb) return;
    const n = policy.checkNote('downloading', { percent: lastPercent });
    try { onNoteCb(n.text, { busy: n.busy }); } catch (_) { /* tray may be gone */ }
  });
  autoUpdater.on('error', (err) => {
    // Common benign case: no release published yet / offline. Log, never surface.
    // The ONE exception is a check the operator asked for by hand: silence there
    // would read as a broken button, so that failure is reported once and the
    // global swallow is left exactly as strict as it was.
    downloading = false;
    checking = false;
    // `checked` is deliberately NOT set: a failed check is not evidence that
    // there is nothing to install, and the gate would relax a real block on it.
    // `available` is deliberately NOT cleared either — a download that died
    // mid-flight does not mean the release stopped existing. `failed` is what
    // carries the news, and it is set BEFORE note() because note() is what fans
    // the state out to the gate's blocking screen.
    failed = true;
    diag('updater: error', err && err.message);
    if (manualPending) {
      manualPending = false;
      note('error', { message: err && err.message });
    } else {
      note('idle'); // clear any stale "Checking…" so the menu never wedges busy
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = (info && info.version) || 'new version';
    downloading = false;
    checking = false;
    checked = true;
    available = false; // no longer coming down: it is HERE, one restart away
    failed = false;
    lastPercent = null;
    manualPending = false;
    diag('updater: downloaded', readyVersion);
    note('ready', { version: readyVersion });
    if (onReadyCb) {
      try { onReadyCb(readyVersion); } catch (_) { /* tray may be gone */ }
    }
    const sessions = liveSessions();
    if (!notified) {
      notified = true;
      showDownloadedNotification(readyVersion, sessions);
    }
    // ITEM 1: the restart is one click away the moment the bits are on disk.
    // With a live session we do NOT throw a modal over a running agent turn:
    // the notification and the tray item carry it, and both routes come back
    // through promptRestart(), which names the session before it kills it.
    if (!promptedThisRun && !sessions.length) {
      promptedThisRun = true;
      promptRestart();
    }
  });

  check();
  const timer = setInterval(check, UPDATER.CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  armFocusChecks();
  diag('updater: armed (interval', UPDATER.CHECK_INTERVAL_MS + 'ms, focus gap',
    UPDATER.FOCUS_CHECK_MIN_GAP_MS + 'ms)');
}

// ── THE FOCUS CHECK (2026-08-22, Samuel's ruling) ────────────────────────────
//
// THE SIGNAL SET, AND WHY THIS PAIR. Both are APP-LEVEL events, so there is no
// per-window bookkeeping to forget when a new window kind is added:
//
//   `browser-window-focus`  fires when ANY of this app's windows gains focus, so
//     it covers the SPA shell, the pop-out thread window, the agent window and
//     the update-required screen at once — and it is the signal that fires on the
//     TRAY path, which for a tray-resident app is how the operator usually
//     arrives. Per-window `win.on('focus')` would have been the same event with a
//     registration to keep in sync with `app-windows.js`, and the F-228 sweep is
//     the record of what happens when one of those is missed.
//   `activate`  is the macOS "the app was brought forward" event — a dock click,
//     or a cmd-tab back when no window is focused yet (a hidden-at-login run has
//     no window to focus at all). `index.js` already listens for its own reason;
//     a second listener is additive and neither knows about the other.
//
// ⚠ WHAT IS DELIBERATELY NOT IN THE SET: `powerMonitor` resume and unlock, which
// `wake.js` already owns for the listener. A machine waking is not the operator
// looking, the interval covers it within 30 minutes, and putting a second
// consumer on that seam is how two modules come to disagree about one event.
//
// ⚠ A FOCUS CHECK IS NOT A MANUAL ONE. It passes no `{manual:true}`, so every
// no-op path in `check()` stays silent: a staged update notes `ready` (which it
// would anyway), a download in flight says nothing, and a failure is swallowed by
// the global error handler exactly as a scheduled check's is. The operator did
// not ask a question, so nothing answers one.
function armFocusChecks() {
  for (const signal of ['browser-window-focus', 'activate']) {
    try { app.on(signal, checkOnFocus); }
    catch (err) { diag('updater: could not arm', signal, err && err.message); }
  }
}

// Returns whether a check was actually issued — for the diag line and the tests;
// no caller acts on it.
function checkOnFocus() {
  if (!autoUpdater) return false;
  // The state machine's own no-ops, asked here so the gap is not spent on a
  // check that would have returned immediately. `check()` re-asks the first two.
  if (readyVersion || downloading || checking) return false;
  if (!policy.shouldCheckOnFocus(lastCheckAt, Date.now(), UPDATER.FOCUS_CHECK_MIN_GAP_MS)) {
    return false;
  }
  diag('updater: focus check');
  check();
  return true;
}

// The notification carries the announcement when the dialog is suppressed, and
// survives being missed (a dialog behind another Space does not).
//
// `actions` is accepted on darwin in Electron 43, but macOS only RENDERS the
// button when the notification is delivered as an alert (a per-user System
// Settings choice; in banner style it appears on hover at best). So it is a
// bonus path, never the load-bearing one: the dialog and the tray item are.
// Clicking the banner body works everywhere and opens the same prompt.
function showDownloadedNotification(version, sessions) {
  try {
    if (!Notification.isSupported()) return;
    const copy = policy.downloadedNotification({ version, sessions });
    const n = new Notification({
      title: copy.title,
      body: copy.body,
      silent: true,
      actions: [{ type: 'button', text: 'Restart now' }],
    });
    n.on('action', () => requestRestart());
    n.on('click', () => promptRestart());
    n.show();
  } catch (_) { /* best-effort */ }
}

// ITEM 3: the manual check. Called from the tray, and never a no-op click: every
// path here ends in a note the operator can read (checking / up to date /
// downloading / ready / failed / off in this build).
function check(opts) {
  const manual = !!(opts && opts.manual);
  if (manual) diag('updater: manual check requested');
  if (!autoUpdater) {
    if (manual) note('unsupported');
    return;
  }
  // Already staged: the answer is "ready", and a manual ask is an explicit ask,
  // so it goes straight to the prompt instead of re-checking a settled question.
  if (readyVersion) {
    note('ready', { version: readyVersion });
    if (manual) promptRestart();
    return;
  }
  // Mid-download: re-checking would either be ignored or start a second fetch.
  // Report the state instead.
  if (downloading) {
    if (manual) note('downloading');
    return;
  }
  if (manual) manualPending = true;
  // ⚠ STAMPED HERE, WHERE THE REQUEST ACTUALLY GOES OUT — not at the top of the
  // function, because the two early returns above never touch the network and
  // must not spend the focus gap.
  lastCheckAt = Date.now();
  try {
    autoUpdater.checkForUpdates().catch((err) => {
      diag('updater: check failed', err && err.message);
      if (manualPending) {
        manualPending = false;
        note('error', { message: err && err.message });
      }
    });
  } catch (err) {
    diag('updater: check threw', err && err.message);
    if (manualPending) {
      manualPending = false;
      note('error', { message: err && err.message });
    }
  }
}

function checkNow() {
  check({ manual: true });
}

// The restart prompt. NOTHING here restarts on its own: the dialog defaults to
// "Later" (button 0, also the cancel action), and only an explicit click on
// "Restart now" reaches quitAndInstall. Single-flight, because the tray item, the
// notification body and its action button all lead here.
//
// Windowless on purpose: the app is usually a hidden background listener, and a
// modal parented to a hidden window would be invisible. claude-auth.js already
// shows a windowless message box on the same reasoning.
function promptRestart() {
  if (!readyVersion || promptOpen) return Promise.resolve(false);
  promptOpen = true;
  const sessions = liveSessions();
  const opts = policy.restartPrompt({ version: readyVersion, sessions });
  diag('updater: restart prompt (live sessions:', sessions.length + ')');
  return dialog
    .showMessageBox(opts)
    .then(({ response }) => {
      if (!policy.isRestartChoice(response)) {
        diag('updater: restart deferred by operator');
        return false;
      }
      quitAndInstall();
      return true;
    })
    .catch((err) => {
      diag('updater: restart prompt failed', err && err.message);
      return false;
    })
    .finally(() => { promptOpen = false; });
}

// The tray "Update ready" click. With nothing live it does what the label says
// and restarts; with a live session it goes through the prompt first, so an
// agent mid turn is never killed without the operator being told.
function requestRestart() {
  if (!readyVersion) {
    checkNow();
    return;
  }
  if (liveSessions().length) {
    promptRestart();
    return;
  }
  quitAndInstall();
}

// The install itself. quitAndInstall runs the normal quit path (before-quit fires
// → listener teardown), then relaunches updated.
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

module.exports = {
  init,
  checkNow,
  checkOnFocus, // 2026-08-22: the gapped "the operator is looking" check
  promptRestart,
  requestRestart,
  quitAndInstall,
  updateReadyVersion,
  isUpdateReady,
  updateState,
};
