// Auto-update POLICY and COPY, as pure functions (no electron, no timers, no I/O).
//
// WHY THIS FILE EXISTS. The update path's real failure is a human one: a build is
// published, the operator closes and reopens the app, and gets the OLD build
// anyway. That is not a bug in electron-updater, it is the shape of the cycle:
// START downloads (~200MB, in the background), QUIT installs, START runs the new
// build. One close-and-reopen can never be enough, and quitting mid-download
// throws the partial copy away, which is exactly the "it takes a few tries over a
// few minutes" symptom. Nothing on screen said either half was happening.
//
// So every decision and every string in that story lives here, where it can be
// tested as a truth table instead of by driving Electron:
//   • how often we look (and the floor that keeps a fast loop from hammering),
//   • what the tray says while a download is in flight,
//   • what a manual "check now" reports for each outcome,
//   • the restart prompt, including the live-session warning that keeps a
//     restart from silently killing an agent mid turn.
//
// Copy rule for this repo: no em dashes in user-facing strings.

// ── The check interval ───────────────────────────────────────────────────────
// Production looks every 4h. That is fine for a machine that is already current
// and useless the moment you publish a build and want it NOW: an app that was
// already running will not look again for up to four hours. DOPL_UPDATE_CHECK_MS
// overrides it for that loop.
//
// THE CLAMP IS LOAD-BEARING: the override is read from the environment, so a typo
// (`DOPL_UPDATE_CHECK_MS=5`, meaning "5 minutes") would otherwise become a 5ms
// hot loop against GitHub Releases. Anything below the floor becomes the floor,
// anything above the ceiling becomes the ceiling, and anything unparseable (or
// absent, or <= 0) falls back to the 4h default rather than to zero.
const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const MIN_CHECK_INTERVAL_MS = 60 * 1000; // 60s floor
const MAX_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h ceiling

function resolveCheckIntervalMs(raw, fallback) {
  const base = Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_CHECK_INTERVAL_MS;
  if (raw === undefined || raw === null) return base;
  const text = String(raw).trim();
  if (!text) return base;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return base;
  return Math.min(MAX_CHECK_INTERVAL_MS, Math.max(MIN_CHECK_INTERVAL_MS, Math.round(n)));
}

// ── Download progress ────────────────────────────────────────────────────────
// electron-updater's `download-progress` payload carries `percent` (a float) and
// the raw byte counts. Both are treated as untrusted: a missing/NaN percent
// degrades to the byte ratio, and an absent ratio degrades to null ("downloading,
// amount unknown") rather than to a fake 0%.
function progressPercent(info) {
  if (!info || typeof info !== 'object') return null;
  const pct = Number(info.percent);
  if (Number.isFinite(pct)) return Math.min(100, Math.max(0, Math.floor(pct)));
  const total = Number(info.total);
  const transferred = Number(info.transferred);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(transferred) && transferred >= 0) {
    return Math.min(100, Math.max(0, Math.floor((transferred / total) * 100)));
  }
  return null;
}

// The one line that turns "nothing is happening" into "it is working". A ~200MB
// download over a slow link is otherwise indistinguishable from a dead updater,
// and that is what makes an operator quit halfway and lose the staged copy.
function progressLabel(percent) {
  // `Number(null)` is 0, so the null check has to come FIRST: an unknown amount
  // must not be reported as a confident "0%" that never moves.
  if (percent === null || percent === undefined || percent === '') return 'Downloading update…';
  const p = Number(percent);
  if (!Number.isFinite(p)) return 'Downloading update…';
  return `Downloading update… ${Math.min(100, Math.max(0, Math.floor(p)))}%`;
}

// ── What the tray says ───────────────────────────────────────────────────────
// One note line, always answering "what did my click just do?". `busy` disables
// the manual check item (a second check mid-download would be a no-op at best)
// and is the flag the tooltip uses to decide whether hovering should carry it.
//
// 'error' is the ONE outcome the updater is allowed to surface. Its global error
// handler deliberately swallows the common benign cases (no release published
// yet, offline), because a background app must not nag about them. A MANUAL check
// is different: the operator asked, so silence would read as a broken button.
function checkNote(outcome, ctx) {
  const c = ctx || {};
  const version = c.version ? String(c.version) : '';
  switch (outcome) {
    case 'checking':
      return { text: 'Checking for updates…', busy: true };
    case 'downloading':
      return {
        text: c.percent == null && version
          ? `Downloading v${version}…`
          : progressLabel(c.percent),
        busy: true,
      };
    case 'ready':
      return { text: version ? `Update ready: v${version}` : 'Update ready', busy: false };
    case 'up-to-date':
      return { text: version ? `Up to date (v${version})` : 'Up to date', busy: false };
    case 'error':
      return {
        text: c.message
          ? `Update check failed: ${String(c.message)}`
          : 'Update check failed. Check your connection and try again.',
        busy: false,
      };
    case 'unsupported':
      return { text: 'Updates are off in this build', busy: false };
    default:
      return { text: '', busy: false };
  }
}

// ── Live sessions ────────────────────────────────────────────────────────────
// A restart kills every spawned agent session mid turn. The operator is allowed
// to do that, but never by accident, so the count and the channels behind it get
// stated in the prompt. Names are capped so a long list cannot push the buttons
// off the dialog.
function liveSessionSummary(sessions) {
  const list = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
  if (!list.length) return '';
  const names = [];
  for (const s of list) {
    const name = (s && (s.channelName || s.taskTitle)) || '';
    if (name && !names.includes(String(name))) names.push(String(name));
    if (names.length === 3) break;
  }
  const n = list.length;
  const head = n === 1 ? '1 session is running right now' : `${n} sessions are running right now`;
  const where = names.length ? ` (${names.join(', ')}${names.length < n ? ', and more' : ''})` : '';
  const tail = n === 1 ? 'Restarting ends it mid turn.' : 'Restarting ends them mid turn.';
  return `${head}${where}. ${tail}`;
}

// ── The restart prompt ───────────────────────────────────────────────────────
// The whole point of the feature: one click, the moment the download lands,
// instead of a staged build nobody knows about. "Later" is button 0 AND the
// default AND the cancel action, so every accidental dismissal (escape, close,
// return) means "do not restart". Only an explicit click on button 1 restarts.
const RESTART_BUTTON_INDEX = 1;

function restartPrompt(opts) {
  const o = opts || {};
  const version = o.version ? String(o.version) : '';
  const warning = liveSessionSummary(o.sessions);
  const detail = [
    warning,
    'Restarting takes a few seconds and reopens Dopl on the new build. '
      + 'Until you restart, this Mac keeps running the current build.',
  ].filter(Boolean).join('\n\n');
  return {
    type: warning ? 'warning' : 'info',
    buttons: ['Later', 'Restart now'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Dopl',
    message: version ? `Dopl ${version} is ready to install` : 'A Dopl update is ready to install',
    detail,
  };
}

// A dialog response is an index; anything that is not the explicit restart button
// (including an undefined response from a dismissed dialog) means "later".
function isRestartChoice(response) {
  return response === RESTART_BUTTON_INDEX;
}

// ── The notification ─────────────────────────────────────────────────────────
// Kept alongside the dialog because it is the surface that survives: a dialog
// behind another Space is missed, a notification waits in Notification Center.
// When a session is live the dialog is deliberately NOT auto-shown (a modal on
// top of a running agent turn is the interruption we are avoiding), so this
// banner is the whole announcement and has to carry the state.
function downloadedNotification(opts) {
  const o = opts || {};
  const version = o.version ? String(o.version) : 'A new version';
  const warning = liveSessionSummary(o.sessions);
  const body = warning
    ? `Version ${version} is downloaded. ${warning} Click here to restart when you are ready, `
      + `or use the menu bar icon. Until then this Mac keeps running the old build.`
    : `Version ${version} is downloaded. Restart Dopl to install it. `
      + `Until then this Mac keeps running the old build.`;
  return { title: 'Dopl update ready', body };
}

module.exports = {
  DEFAULT_CHECK_INTERVAL_MS,
  MIN_CHECK_INTERVAL_MS,
  MAX_CHECK_INTERVAL_MS,
  RESTART_BUTTON_INDEX,
  resolveCheckIntervalMs,
  progressPercent,
  progressLabel,
  checkNote,
  liveSessionSummary,
  restartPrompt,
  isRestartChoice,
  downloadedNotification,
};
