// The MINIMUM-VERSION GATE's policy and copy, as pure functions (no electron, no timers, no
// I/O). It exists because the UI now ships INSIDE the build: a Mac on an old build is on an old
// product forever, and no deploy reaches it.
//
// ⚠ NOT AUTHORIZATION, and it cannot be: the floor is PULLED by a client that chooses to obey
// it (`GET /api/version`), so a patched client is unaffected and old builds have no such code.
// It protects the FUTURE population.
//
// ⚠ THE THREE RULES EVERYTHING BELOW SERVES:
//   1. FAIL OPEN. Offline, timeout, 5xx, captive-portal HTML, a malformed floor, an unparseable
//      version — all "no floor", app opens. Only a well-formed floor strictly above a
//      well-formed running version ever blocks.
//   2. NEVER BRICK. A floor above the newest published build blocks everyone with nothing to
//      upgrade to. Two independent guards: the server refuses to serve such a floor
//      (src/shared/version/desktop-floor.ts), and a client whose updater has genuinely looked
//      and found nothing DEGRADES to a warning.
//   3. QUIT ALWAYS WORKS. The block is a screen, not a hostage situation.
//
// Copy rule: no em dashes in user-facing strings.

const updatePolicy = require('./update-policy');

// ── Versions ─────────────────────────────────────────────────────────────────
// ⚠ RE-STATED rather than imported from version-skew.js on purpose: that module's block is
// deliberately require-free and it pulls in electron, a name cache and the listener. A test
// pins that the two implementations agree, so a drift is a decision.
const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-[0-9A-Za-z.]{1,16})?$/;

// [major, minor, patch] or null. ⚠ Only the release triple is compared — a pre-release tag is
// parsed off, so 1.9.0-rc.1 and 1.9.0 are the same build to a floor. Anything else is null,
// which reads as "unknown" everywhere below and NEVER blocks.
function parseVersion(v) {
  const m = VERSION_RE.exec(String(v == null ? '' : v));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// -1 / 0 / 1, or null when either side is unparseable. ⚠ Null is NOT an ordering: every caller
// treats it as "no floor", the open direction.
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

// ── The server's answer ──────────────────────────────────────────────────────
// `GET /api/version` -> `{ minSupported, latest }`, both nullable. ⚠ Read as UNTRUSTED input —
// a captive portal serves an HTML login page, a proxy serves an error object. Anything not a
// recognizable version becomes null, and null is the open answer. Never throws.
function readFloorResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { floor: null, latest: null };
  }
  const narrow = (v) => (typeof v === 'string' && VERSION_RE.test(v) ? v : null);
  return { floor: narrow(body.minSupported), latest: narrow(body.latest) };
}

// ── The dev knob ─────────────────────────────────────────────────────────────
//   (unset) / anything else  'auto'  ⚠ an UNRECOGNIZED value lands here on purpose: a typo
//                                      must not silently disable the gate.
//   off                      'off'   local-dev escape hatch: no fetch, no verdict, no screen.
//   force                    'force' dogfooding — synthesizes a floor above this build and
//                                      suppresses the anti-brick degrade, so the BLOCKING
//                                      screen renders with no floor deployed.
function resolveGateMode(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (text === 'off' || text === '0') return 'off';
  if (text === 'force') return 'force';
  return 'auto';
}

// The synthetic floor `force` blocks against: the next minor above this build, so the screen
// shows a plausible number. A build that cannot name itself gets a floor nothing satisfies.
function forcedFloor(current) {
  const v = parseVersion(current);
  return v ? `${v[0]}.${v[1] + 1}.0` : '9999.0.0';
}

// ── The updater, as the gate sees it ─────────────────────────────────────────
// `force` rewrites exactly two fields — `supported` defeats GUARD 1, `checked` defeats GUARD 2
// — the only two reasons a dev machine would not block. Everything else passes through so a
// packaged dogfood build still narrates its REAL download.
// ⚠ BOTH the verdict AND the screen must read this: rewriting only the verdict blocks a
// developer and then shows them "this build cannot update itself", a screen no blocked user
// would ever see.
function effectiveUpdater(mode, updater) {
  const u = updater || {};
  return mode === 'force' ? { ...u, supported: true, checked: false } : u;
}

// ── The verdict ──────────────────────────────────────────────────────────────
// `updater` is the live state of main/updater.js:
//   supported  false in dev, unpackaged, or when electron-updater failed to load
//   checked    a check has COMPLETED at least once this run (any outcome)
//   available  an update was found and is downloading
//   ready      an update is downloaded and one restart away
// ⚠ `checking` / `failed` / `version` / `percent` are SCREEN narration and deliberately NOT
// verdict inputs: what the download is doing, FAILING included, must never change whether the
// app is blocked (a failed download is the loudest evidence an update exists).
// ⚠ BRANCH ORDER IS THE DESIGN:
//   1-2  escape hatches, before anything can block
//   3-5  fail-open: unknown build, unknown floor, build at or above it
//   6-7  anti-brick degrades — the ONLY paths from "below the floor" to something else
//   8    block
function gateVerdict(input) {
  const i = input || {};
  const mode = i.mode || 'auto';
  const current = i.current || '';
  const u = i.updater || {};

  if (mode === 'off') return verdict('allow', 'gate-off', current, '');

  // ⚠ `force` takes the SAME branch a real block takes (8), never a short-circuit: what a
  // developer sees is what a user would see.
  const forced = mode === 'force';
  const floor = forced ? (aboveFloor(current, i.floor) ? i.floor : forcedFloor(current)) : (i.floor || '');
  const updater = effectiveUpdater(mode, u);

  // A build that cannot name itself is never blocked — that compares a floor against nothing.
  if (!parseVersion(current)) return verdict('allow', 'unknown-build', current, floor);
  // No floor, an unreadable floor, an unreachable server, a captive portal.
  if (!parseVersion(floor)) return verdict('allow', 'no-floor', current, floor);
  if (compareVersions(current, floor) >= 0) return verdict('allow', 'at-or-above-floor', current, floor);

  // GUARD 1: no updater, no way forward (dev, unpackaged, or electron-updater failed to load).
  // Blocking would be a dead end with no button that can end it.
  if (!updater.supported) return verdict('warn', 'no-updater', current, floor);
  // GUARD 2 (fleet-outage): the updater genuinely looked at the release feed and there is
  // nothing newer, so the floor is above the newest build that exists and nobody can satisfy
  // it. ⚠ `checked` only turns true after a COMPLETED check, so the seconds before the first
  // one still block — the common case is a real floor with a real update behind it.
  if (updater.checked && !updater.available && !updater.ready) {
    return verdict('warn', 'no-update-published', current, floor);
  }
  return verdict('block', 'below-floor', current, floor);
}

// True when `floor` is a real version strictly above `current`.
function aboveFloor(current, floor) {
  return compareVersions(current, floor) === -1;
}

function verdict(state, reason, current, floor) {
  return { state, reason, current: String(current || ''), floor: String(floor || '') };
}

// ── The blocking screen's copy ───────────────────────────────────────────────
// Only the `block` state is rendered (`warn` is a notification + tray line, `allow` is the
// app). ⚠ Status line and primary button are a function of the updater's LIVE state, so the
// screen narrates the download instead of looking hung.
function gateScreen(input) {
  const i = input || {};
  const u = i.updater || {};
  const current = i.current ? `v${i.current}` : 'an older build';
  const floor = i.floor ? `v${i.floor}` : 'a newer build';
  const head = {
    title: 'Update required',
    message: `Dopl ${floor} or newer is required to continue. This Mac is on ${current}.`,
  };
  const screen = (status, busy, action) => ({ ...head, status, busy, action });

  // ⚠ Ordered by how close the operator is to done. The restart is the ONE click that ends
  // this screen, so it wins over everything else.
  if (u.ready) {
    const v = u.version ? `Dopl v${u.version}` : 'The update';
    return screen(`${v} is downloaded and ready to install.`, false,
      { id: 'restart', label: 'Restart and install' });
  }
  // ⚠ `available` STAYS TRUE when a download errors (updater.js explains why the verdict
  // needs that), so without this branch the screen sits on a spinner with the button hidden by
  // `busy` for a download that stopped, and the next automatic attempt is up to 30 MINUTES away
  // (2026-08-22: it was 4h until the cadence change, which is why this branch was urgent).
  if (u.failed && u.supported) {
    return screen(
      u.available
        ? 'The download did not finish. Check your connection and try again.'
        : 'Dopl could not reach the update server. Check your connection and try again.',
      false,
      { id: 'check', label: 'Try again' }
    );
  }
  // A ~200MB download over a slow link is what makes this screen look hung, and a hung screen
  // is what makes someone force-quit and lose the partial copy.
  if (u.available) {
    return screen(updatePolicy.progressLabel(u.percent == null ? null : u.percent), true, null);
  }
  // No updater means no button can end this screen. Unreachable in practice (the verdict has
  // already degraded to `warn`); kept so a future caller that renders it says something true.
  if (!u.supported) {
    return screen('This build cannot update itself. Download the latest Dopl to continue.', false, null);
  }
  if (u.checking) return screen('Looking for an update…', true, { id: 'check', label: 'Check for updates' });
  return screen(
    u.checked ? 'No newer build was found yet.' : 'Looking for an update…',
    false,
    { id: 'check', label: 'Check for updates' }
  );
}

// ── The warning surface's copy ───────────────────────────────────────────────
// One silent banner + one standing disabled tray line (the version-skew.js idiom). ⚠ Quiet on
// purpose: this state means a config mistake on OUR side, so it explains and gets out of the
// way rather than demanding an action the operator cannot take.
function floorNotice(v) {
  const n = v || {};
  const floor = n.floor ? `v${n.floor}` : 'a newer build';
  const current = n.current ? `v${n.current}` : 'this build';
  const body = n.reason === 'no-updater'
    ? `Dopl ${floor} is required and this build cannot update itself. `
      + `Download the latest Dopl when you can. Nothing is blocked in the meantime.`
    : `Dopl ${floor} is required but no newer build is published yet. `
      + `Keep working. Dopl installs the update by itself as soon as one lands.`;
  return {
    title: 'Dopl update required soon',
    body,
    tray: `Update required: ${floor} (you are on ${current})`,
  };
}

// ── Cadence ──────────────────────────────────────────────────────────────────
// ⚠ The steady-state check RIDES the updater's own interval (config.UPDATER.CHECK_INTERVAL_MS,
// 30 MINUTES since 2026-08-22 — it was 4h) rather than adding a second timer: both questions go
// to the same server on the same trip, and a changed floor matters exactly when a build that
// satisfies it exists.
// ⚠ THE 2026-08-22 CADENCE CHANGE CHANGED NOTHING HERE EXCEPT THE FRESHNESS, verified rather
// than assumed. Riding the interval is the only coupling; the floor gate has no opinion about
// its value, and a SHORTER one strictly improves it — a raised floor is noticed in half an hour
// rather than half a day. ⚠ The updater's new FOCUS check does NOT drag the floor read with it:
// `updater.js › checkOnFocus` calls the updater's own `check()`, and the gate keeps its own
// timer (`version-gate.js`). That is deliberate and is the same argument as above inverted —
// the floor read is cheap but it is a SECOND server, so tying it to window focus would put a
// request on `/api/version` every time the operator cmd-tabbed. If the two are ever coupled,
// couple them at the interval, where the gap already bounds them.
// ⚠ The short retry applies ONLY when the fetch got NO answer at all (throw, timeout, 5xx,
// unparseable JSON). A server that answered "no floor" HAS answered and stays on the steady
// cadence.
const FLOOR_FETCH_TIMEOUT_MS = 8000;
const FLOOR_RETRY_MS = 10 * 60 * 1000;

module.exports = {
  VERSION_RE,
  FLOOR_FETCH_TIMEOUT_MS,
  FLOOR_RETRY_MS,
  parseVersion,
  compareVersions,
  readFloorResponse,
  resolveGateMode,
  forcedFloor,
  effectiveUpdater,
  gateVerdict,
  gateScreen,
  floorNotice,
};
