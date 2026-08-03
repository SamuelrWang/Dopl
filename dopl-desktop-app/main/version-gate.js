// The minimum-version gate's imperative shell: fetch the floor, hold the
// verdict, and tell the app when it is allowed to open. Every DECISION lives in
// main/min-version.js (pure); everything with a socket, a timer or a
// notification in it lives here, the update-policy.js / updater.js split.
//
// THE JOB. Phase 4 retires usedopl.com, after which the bundled SPA is the only
// client and a Mac on an old build is on an old product forever — no deploy
// reaches it (docs/DESKTOP-MIGRATION-PLAN.md, risk register). So a build asks
// the server for the floor it must meet and, when it is below, refuses to open
// itself and drives the updater that already exists instead of duplicating it.
//
// IT COMPOSES WITH THE UPDATER, IT DOES NOT REPLACE IT. updater.js keeps owning
// the feed, the download, the 4h timer and the restart prompt. This module adds
// one question ("is this build still allowed?") on the same cadence, reads the
// updater's state to decide whether a block is even survivable, and hands the
// screen's buttons straight back to updater.checkNow / requestRestart.
//
// NOTHING HERE IS A SECURITY BOUNDARY, and it must not be built as if it were.
// The floor is PULLED by a client that chooses to obey it, so a patched build
// ignores it and builds <= 1.8.0 never had this code. It is a forced-upgrade
// nudge for the future population; a server-side 426 was considered and
// rejected (src/shared/auth/app-version-header.ts records why).
//
// NO FLOOR IS EVER CACHED TO DISK. A persisted floor would let a machine boot
// straight into a block with no network to re-check against, which is exactly
// the "offline use bricks the app" failure this feature must not have. Every
// cold boot starts open and blocks only after the server says so, which costs a
// sub-second flash of the boot screen and buys an app that cannot strand
// anybody on a plane.

const { Notification } = require('electron');
const { API_BASE, VERSION_GATE } = require('./config');
const appVersion = require('./app-version');
const minVersion = require('./min-version');
const { diag } = require('./diag');

const UNKNOWN_UPDATER = { supported: false, checked: false, available: false, ready: false };

let handlers = {}; // { onBlock, onRelease, onWarn } — injected by index.js
let floor = ''; // the newest well-formed floor the server has given us
let verdict = null; // the last decision (min-version.gateVerdict shape)
let blocked = false;
let timer = null;
let fetching = false; // single-flight: wake + interval + a click can coincide
let warnedFloor = null; // one silent banner per floor, per process
const listeners = new Set(); // the update-required window, when one is up

// updater.js is required LAZILY (the tray.js idiom) so this module carries no
// load-order dependency on it and still works in a harness where it is absent.
// A state we cannot read reports `supported: false`, which the policy core reads
// as "no way forward" and degrades to a warning — never to a block.
function updaterModule() {
  try {
    return require('./updater');
  } catch (_) {
    return null;
  }
}

function updaterState() {
  const mod = updaterModule();
  if (!mod || typeof mod.updateState !== 'function') return UNKNOWN_UPDATER;
  try {
    return mod.updateState() || UNKNOWN_UPDATER;
  } catch (err) {
    diag('version gate: updater state read failed', err && err.message);
    return UNKNOWN_UPDATER;
  }
}

// ── The fetch ────────────────────────────────────────────────────────────────
// Deliberately NOT api.js's apiFetch. That one attaches the cookie jar and, on a
// 401, forces a token rotation and can emit a signed-out transition — none of
// which belongs on an unauthenticated liveness question that must work while
// signed out. This is a bare fetch with a timeout, and every failure mode
// (throw, abort, non-2xx, HTML from a captive portal, a body with the wrong
// shape) returns null, which the caller reads as "no answer".
async function fetchFloor() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VERSION_GATE.FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${VERSION_GATE.PATH}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        // Diagnostic only, exactly as everywhere else: it labels the asker in
        // the server's logs and has no effect on the answer.
        ...appVersion.versionHeaders(),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      diag('version gate: floor fetch', res.status);
      return null;
    }
    return minVersion.readFloorResponse(await res.json());
  } catch (err) {
    diag('version gate: floor fetch failed', (err && err.message) || String(err));
    return null;
  } finally {
    clearTimeout(t);
  }
}

// One round trip, then re-decide and re-arm. An answer (even "no floor") goes
// back on the updater's 4h cadence; NO answer retries in minutes, so a machine
// that booted offline learns about a floor shortly after the network returns
// instead of four hours later.
async function refresh() {
  if (fetching) return;
  fetching = true;
  let gotAnswer = false;
  try {
    const answer = await fetchFloor();
    if (answer) {
      gotAnswer = true;
      // A server that stops sending a floor CLEARS it: withdrawing a floor has
      // to be as effective as setting one, or a mistaken block is unrecoverable.
      floor = answer.floor || '';
    }
  } finally {
    fetching = false;
    decide();
    arm(gotAnswer ? VERSION_GATE.CHECK_INTERVAL_MS : VERSION_GATE.RETRY_MS);
  }
}

function arm(ms) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void refresh(); }, ms);
  if (timer.unref) timer.unref();
}

// ── The verdict, and the transitions ─────────────────────────────────────────
function decide() {
  apply(minVersion.gateVerdict({
    current: appVersion.appVersion(),
    floor,
    mode: VERSION_GATE.MODE,
    updater: updaterState(),
  }));
}

function apply(next) {
  const prev = verdict;
  verdict = next;
  const changed = !prev || prev.state !== next.state || prev.floor !== next.floor;
  if (changed) {
    diag('version gate:', next.state, `(${next.reason})`,
      'build', next.current || '?', 'floor', next.floor || 'none');
  }
  if (next.state === 'block') {
    if (!blocked) { blocked = true; call('onBlock', next); }
  } else if (blocked) {
    // The unblock: a lowered/withdrawn floor, or an anti-brick degrade. The app
    // has to become usable again without a relaunch, or a bad floor is still an
    // outage even after it is corrected.
    blocked = false;
    call('onRelease', next);
  }
  if (next.state === 'warn') surfaceWarning(next);
  else if (changed) call('onWarn', null);
  push();
}

function call(name, arg) {
  const fn = handlers[name];
  if (typeof fn !== 'function') return;
  try { fn(arg); } catch (err) { diag(`version gate: ${name} handler failed`, err && err.message); }
}

// Quiet and non-modal, the version-skew.js idiom: one silent banner per floor
// for the life of the process, plus a standing tray line. This state means the
// operator has run into a misconfiguration on OUR side, so it explains itself
// and gets out of the way rather than demanding an action they cannot take.
function surfaceWarning(v) {
  const notice = minVersion.floorNotice(v);
  call('onWarn', notice);
  if (warnedFloor === v.floor) return;
  warnedFloor = v.floor;
  try {
    if (Notification.isSupported()) {
      new Notification({ title: notice.title, body: notice.body, silent: true }).show();
    }
  } catch (_) { /* best-effort */ }
}

// ── The surface the blocking window talks to ─────────────────────────────────
// The SAME updater view the verdict was reached through, or `force` would block
// through the real branch and then render the screen of a build that cannot
// update itself — which is not what a blocked user sees, and dogfooding a screen
// nobody gets is worthless.
function screen() {
  const v = verdict || {};
  return minVersion.gateScreen({
    current: v.current,
    floor: v.floor,
    updater: minVersion.effectiveUpdater(VERSION_GATE.MODE, updaterState()),
  });
}

function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function push() {
  if (!listeners.size) return;
  const s = screen();
  for (const fn of listeners) {
    try { fn(s); } catch (err) { diag('version gate: listener failed', err && err.message); }
  }
}

// The blocking screen's two buttons, routed to the updater that owns them. A
// check also re-asks for the floor, so the one button the operator has covers
// both halves of "am I still stuck?".
function act(id) {
  const mod = updaterModule();
  if (id === 'restart') {
    if (mod) mod.requestRestart();
    return true;
  }
  if (id === 'check') {
    if (mod) mod.checkNow();
    void refresh();
    return true;
  }
  return false;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
// `onUpdaterState` is wired into updater.init({ onState }): every transition the
// updater makes (checking, found, downloading, nothing there, downloaded) can
// change the verdict, and the "nothing there" one is the whole anti-brick guard.
function onUpdaterState() {
  if (VERSION_GATE.MODE === 'off') return;
  decide();
}

// Wake: the machine has been asleep, the floor may have moved and the network
// stack has just been rebuilt. Ask again now rather than at the next 4h alarm.
function onWake() {
  if (VERSION_GATE.MODE === 'off') return;
  void refresh();
}

function init(opts) {
  handlers = opts || {};
  if (VERSION_GATE.MODE === 'off') {
    diag('version gate: OFF (DOPL_VERSION_GATE=off)');
    return;
  }
  if (VERSION_GATE.MODE === 'force') diag('version gate: FORCED (DOPL_VERSION_GATE=force)');
  // START FROM NOTHING. index.js arms updater.init() BEFORE this call, and that
  // init fires a state event synchronously (`checking` on a packaged build,
  // `unsupported` in dev) — which reaches onUpdaterState and decides a verdict
  // while `handlers` is still empty. Left alone, that pre-wiring verdict would
  // have consumed the block/release transition the handlers were installed to
  // receive, and the window swap would silently never happen. Clearing both
  // makes the first decision AFTER wiring the one that fires.
  verdict = null;
  blocked = false;
  // Decide once before the first answer lands so `force` blocks immediately and
  // so isBlocked() is never undefined for a window created in the same tick.
  decide();
  void refresh();
}

function isBlocked() {
  return blocked;
}

module.exports = {
  init,
  isBlocked,
  screen,
  subscribe,
  act,
  onUpdaterState,
  onWake,
  // Read by the tests and useful in the field log; never a control surface.
  currentVerdict: () => verdict,
};
