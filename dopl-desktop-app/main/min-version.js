// The MINIMUM-VERSION GATE's policy and copy, as pure functions (no electron,
// no timers, no I/O). The update-policy.js split, for the same reason: every
// decision below is a truth table rather than something you have to drive
// Electron to observe.
//
// WHY A GATE AT ALL (docs/DESKTOP-MIGRATION-PLAN.md, Phase 4 risk register).
// Until now a stale desktop build was a cosmetic problem: the UI came from
// usedopl.com, so a Vercel deploy fixed everyone at once and the wrapper's age
// barely mattered. The bundled SPA inverts that. The UI now ships INSIDE the
// build, so a Mac on an old build is on an old product forever, and there is no
// deploy that reaches it. Before the website can be retired there has to be a
// server-authoritative floor that a client will block itself on.
//
// WHAT THIS IS NOT. It is not authorization and it cannot be. The floor is
// PULLED by a client that chooses to obey it (`GET /api/version`), so a patched
// or lying client is unaffected, and builds <= 1.8.0 do not have this code at
// all and never will. That is fine and is the reason it ships now rather than at
// cutover: the gate exists to protect the FUTURE population, and every day it is
// in the field is another day of installs that can be forced forward later.
//
// THE THREE RULES EVERYTHING BELOW SERVES:
//
//   1. FAIL OPEN. Offline, a timeout, a 5xx, HTML from a captive portal, a
//      malformed floor, a version this build cannot parse — every one of them is
//      "no floor" and the app opens. Only a well-formed floor strictly above a
//      well-formed running version ever blocks.
//   2. NEVER BRICK. A floor above the newest published build would block every
//      user with nothing to upgrade to. The server refuses to serve such a floor
//      (src/shared/version/desktop-floor.ts) and, independently, a client whose
//      updater has genuinely looked and found nothing DEGRADES from a hard block
//      to a warning. Two guards, grounded in two different sources of truth.
//   3. QUIT ALWAYS WORKS. The block is a screen, not a hostage situation.
//
// Copy rule for this repo: no em dashes in user-facing strings.

const updatePolicy = require('./update-policy');

// ── Versions ─────────────────────────────────────────────────────────────────
// The same vocabulary the app-version header uses (src/shared/auth/
// app-version-header.ts) and the same ordering rule version-skew.js uses. It is
// re-stated here rather than imported from version-skew.js on purpose: that
// module's block is deliberately require-free (its truth table slices it into a
// bare scope) and it pulls in electron, a name cache and the listener. A test
// pins that the two implementations agree, so a drift is a decision.
const VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-[0-9A-Za-z.]{1,16})?$/;

// [major, minor, patch] or null. Only the release triple is compared; a
// pre-release tag is parsed off and ignored, so 1.9.0-rc.1 and 1.9.0 are the
// same build as far as a floor is concerned. Anything that is not a plain triple
// is null, which reads as "unknown" everywhere below and never blocks.
function parseVersion(v) {
  const m = VERSION_RE.exec(String(v == null ? '' : v));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// -1 / 0 / 1, or null when either side is unparseable. Null is NOT an ordering:
// every caller treats it as "no floor", which is the open direction.
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
// `GET /api/version` returns `{ minSupported, latest }`, both nullable. This
// reads it as untrusted input, because in practice it IS: a captive portal
// serves an HTML login page, a proxy serves an error object, a future server
// could add fields. Anything that is not a recognizable version becomes null,
// and null is the open answer. Never throws.
function readFloorResponse(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { floor: null, latest: null };
  }
  const narrow = (v) => (typeof v === 'string' && VERSION_RE.test(v) ? v : null);
  return { floor: narrow(body.minSupported), latest: narrow(body.latest) };
}

// ── The dev knob ─────────────────────────────────────────────────────────────
// One DOPL_-prefixed variable with three values, the DOPL_UI shape:
//
//   (unset) / anything else  'auto'  — the shipping behavior. An UNRECOGNIZED
//                                      value lands here on purpose: a typo must
//                                      not silently disable the gate.
//   off                      'off'   — the local-dev escape hatch. No fetch, no
//                                      verdict, no screen.
//   force                    'force' — dogfooding. Synthesizes a floor above
//                                      this build and suppresses the anti-brick
//                                      degrade, so the BLOCKING screen renders
//                                      on a machine with no floor deployed. It
//                                      is the only way to see the real screen
//                                      without publishing a floor, and it takes
//                                      a deliberate env var, which no user sets.
function resolveGateMode(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (text === 'off' || text === '0') return 'off';
  if (text === 'force') return 'force';
  return 'auto';
}

// The synthetic floor `force` blocks against: the next minor above this build,
// so the screen shows a plausible number rather than a magic one. A build that
// cannot name itself gets a floor nothing can satisfy, which is the point.
function forcedFloor(current) {
  const v = parseVersion(current);
  return v ? `${v[0]}.${v[1] + 1}.0` : '9999.0.0';
}

// ── The updater, as the gate sees it ─────────────────────────────────────────
// `force` is the only thing that rewrites the updater's state, and it rewrites
// exactly two fields: `supported` defeats GUARD 1 and `checked` defeats GUARD 2,
// which between them are the only reasons a dev machine would not block. Every
// other field is passed through untouched so a packaged dogfood build still
// narrates its REAL download.
//
// BOTH the verdict and the screen read this. They have to: `force` blocks
// through the real branch, so if only the verdict were rewritten, a developer on
// an unpackaged build would block and then be shown "this build cannot update
// itself" — a screen no blocked user would ever see, which defeats the point of
// having a dogfooding mode at all.
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
// gateScreen additionally reads `checking`, `failed`, `version` and `percent`.
// Those are narration for the screen and are deliberately NOT verdict inputs:
// what the download is doing right now, including FAILING, must never change
// whether the app is blocked. (A failed download is the loudest possible
// evidence that an update exists.)
//
// The order of the branches is the whole design, so it is spelled out:
//   1-2  the escape hatches, before anything can block
//   3-5  fail-open: an unknown build, an unknown floor, a build at or above it
//   6-7  the anti-brick degrades, which are the ONLY paths from "below the
//        floor" to something other than a block
//   8    block
function gateVerdict(input) {
  const i = input || {};
  const mode = i.mode || 'auto';
  const current = i.current || '';
  const u = i.updater || {};

  if (mode === 'off') return verdict('allow', 'gate-off', current, '');

  // `force` takes the SAME branch a real block takes (8), rather than
  // short-circuiting: what a developer sees is what a user would see.
  const forced = mode === 'force';
  const floor = forced ? (aboveFloor(current, i.floor) ? i.floor : forcedFloor(current)) : (i.floor || '');
  const updater = effectiveUpdater(mode, u);

  // A build that cannot name itself is never blocked: we would be comparing a
  // floor against nothing. (app-version.js only fails this way outside Electron.)
  if (!parseVersion(current)) return verdict('allow', 'unknown-build', current, floor);
  // No floor, an unreadable floor, an unreachable server, a captive portal.
  if (!parseVersion(floor)) return verdict('allow', 'no-floor', current, floor);
  if (compareVersions(current, floor) >= 0) return verdict('allow', 'at-or-above-floor', current, floor);

  // GUARD 1: no updater, no way forward. Dev, an unpackaged run, or a build
  // whose electron-updater failed to load. Blocking would be a dead end with no
  // button that can end it, so it is a warning instead.
  if (!updater.supported) return verdict('warn', 'no-updater', current, floor);
  // GUARD 2 (the fleet-outage guard): the updater has genuinely looked at the
  // release feed and there is nothing newer. The floor is above the newest build
  // that exists, so nobody can satisfy it. Degrade rather than hold the app
  // hostage to a config mistake. `checked` only turns true after a completed
  // check, so the seconds before the first one still block: the common case is a
  // real floor with a real update behind it, and this releases within seconds
  // when it is not.
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
// Only the `block` state is ever rendered: `warn` is a notification plus a tray
// line, and `allow` is the app. The status line and the primary button are a
// function of the updater's live state, so the screen narrates the download it
// is waiting on instead of sitting there looking hung, which is the exact
// failure update-policy.js was written for.
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

  // Ordered by how close the operator is to being done. The restart is the ONE
  // click that ends this screen, so it wins over everything else that could be
  // said about the updater.
  if (u.ready) {
    const v = u.version ? `Dopl v${u.version}` : 'The update';
    return screen(`${v} is downloaded and ready to install.`, false,
      { id: 'restart', label: 'Restart and install' });
  }
  // THE DEAD END THIS BRANCH EXISTS TO PREVENT. `available` stays true when a
  // download errors (updater.js explains why the verdict needs that), so without
  // this the screen would sit on a progress spinner, with the button hidden by
  // `busy`, for a download that stopped running. Nothing on screen could end it
  // and the next automatic attempt is up to 4h away. A failed attempt therefore
  // beats the spinner: it says what happened and puts the retry back.
  if (u.failed && u.supported) {
    return screen(
      u.available
        ? 'The download did not finish. Check your connection and try again.'
        : 'Dopl could not reach the update server. Check your connection and try again.',
      false,
      { id: 'check', label: 'Try again' }
    );
  }
  // A ~200MB download over a slow link is what makes this screen look hung, and
  // a hung screen is what makes someone force-quit and lose the partial copy.
  if (u.available) {
    return screen(updatePolicy.progressLabel(u.percent == null ? null : u.percent), true, null);
  }
  // No updater means no button can end this screen, so it says the only thing
  // that can. (In practice the verdict has already degraded to `warn` here and
  // this screen is not on screen at all; the branch exists so a future caller
  // that renders it anyway still renders something true.)
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
// The version-skew.js idiom: one silent banner and one standing, disabled tray
// line. Quiet on purpose. This state means the operator has hit a config
// mistake on OUR side, so it explains the situation and gets out of the way
// rather than demanding an action they cannot take.
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
// The steady-state check rides the updater's own interval (config.UPDATER
// .CHECK_INTERVAL_MS, 4h by default) rather than adding a second timer and a
// second thing to tune: the two questions are asked of the same server on the
// same trip through the network, and a floor that changed matters at exactly the
// moment a build that satisfies it exists.
//
// The retry is the exception. An app that boots offline learns nothing, and 4h
// is far too long to sit not knowing; a short retry converges within minutes of
// the network coming back. It applies ONLY when the fetch got no answer at all
// (a throw, a timeout, a 5xx, unparseable JSON). A server that answered "no
// floor" HAS answered, and goes back on the 4h cadence.
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
