// Peer version skew — the second half of Q10.
//
// THE INCIDENT (2026-07-31). A peer Mac silently ran 1.7.14 for a whole evening
// after 1.7.15 shipped: electron-updater had downloaded the new build, but it
// installs ON QUIT and a background listener app is never quit. From this side
// the released fix simply looked broken, and it cost a full debugging round to
// discover the peer was not running it. Nothing in either app said so.
//
// app-version.js puts this build on every request as `X-Dopl-App-Version`, and
// the server stamps it onto the message as the reserved `metadata.appVersion`.
// This module reads that stamp off a PEER's message and, when their build is old
// enough to explain a behavior gap, says one quiet line about it.
//
// DELIBERATELY UNDERPOWERED. The stamp is a DIAGNOSTIC hint, not an authorization
// signal (src/shared/auth/app-version-header.ts): any device-token holder can set
// that header, so it cannot attest what code actually ran. Nothing here gates,
// blocks, or refuses anything — the worst a lie can do is print a wrong log line.
// And it fails SILENT in both directions: an unstamped peer (the web composer, an
// external agent, a build that predates the stamp) produces nothing at all, which
// is exactly today's behavior.
//
// ONE LINE, NOT A NAG. At most one diag + one silent banner per (peer, version)
// for the life of the process, so a peer who stays stale for a week is mentioned
// once, not on every message they send.

const { Notification } = require('electron');
const appVersion = require('./app-version');
const io = require('./listener-io');
const targeting = require('./targeting');
const { metaStr } = targeting;
const { diag } = require('./diag');

// ─── BEGIN VERSION-SKEW-PURE (sliced verbatim by test/version-skew.test.mjs) ──
// Free of requires on purpose: the truth table below evaluates this block as-is,
// the same idiom classify / taskReplyNotice use.

// The oldest peer build that still speaks the CURRENT cross-machine contract.
// Below this, a peer behaves differently in ways visible from this machine
// (1.7.15 is where replies became thread-tagged, reopen became task-scoped, and
// the listener stopped dying mid-exchange), so a peer under it is a live
// explanation for "the fix is not working". Raise it when a release changes what
// the two sides say to each other, never for a local-only change.
const BEHAVIOR_FLOOR = '1.7.15';

// [major, minor, patch] or null. Only the release triple is compared; a
// pre-release tag is parsed off and ignored, since 1.8.0-beta.2 and 1.8.0 are the
// same contract. Anything that is not a plain triple is null, which reads as
// "unknown" everywhere below and produces silence.
function parseVersion(v) {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:-[0-9A-Za-z.]{1,16})?$/.exec(String(v == null ? '' : v));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// -1 / 0 / 1, or null when either side is unparseable. Null is NOT an ordering:
// every caller treats it as "say nothing".
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

// The skew worth reporting, or null. Null for: an unknown version on either
// side, a peer on the SAME build, and a peer on a NEWER build. A newer peer is
// deliberately silent here: it is this machine that would need the update, and
// the updater already owns that affordance (tray "Restart to install").
// `explains` is the second gate — an older peer that still clears the behavior
// floor is a log line only, because their age does not predict any difference
// in what the two sides do.
function skewNotice(peerVersion, myVersion, floor) {
  const cmp = compareVersions(peerVersion, myVersion);
  if (cmp === null || cmp >= 0) return null;
  const belowFloor = compareVersions(peerVersion, floor);
  return {
    peer: String(peerVersion),
    mine: String(myVersion),
    floor: String(floor),
    explains: belowFloor !== null && belowFloor < 0,
  };
}

// The one line a human reads. Names both builds (the operator otherwise has no
// way to check their own) and the ONE action that fixes it, because the update
// is already downloaded on their machine and only a restart applies it.
function skewLine(notice, who) {
  const name = who ? String(who) : 'The other side';
  return name + ' is running Dopl ' + notice.peer + ' and you are on ' + notice.mine +
    '. Their update installs on restart, so ask them to quit and reopen Dopl.';
}
// ─── END VERSION-SKEW-PURE ───────────────────────────────────────────────────

// ─── BEGIN VERSION-SKEW-OBSERVE (injectable; unit-tested via source extraction) ──
// Free vars: metaStr / appVersion / io / Notification / diag (required above, faked
// in test/version-skew.test.mjs), plus the PURE block's helpers.

// One report per (peer, version) for the life of the process. Bounded so a long
// run across many peers cannot grow it without limit (F-072: nothing unbounded);
// a clear costs at most one repeated line.
const SEEN_CAP = 200;
const seen = new Set();

let onSkew = null; // tray surface, injected from index.js

function setHandlers(h) {
  onSkew = (h && typeof h.onSkew === 'function') ? h.onSkew : null;
}

// Read a peer message's stamped build and report the skew ONCE. Returns the
// notice (or null) for the caller's own logging; every side effect is contained
// here. Never throws: a diagnostic must not be able to break message dispatch.
function observe(entry, m, myId) {
  try {
    if (!m || !myId) return null;
    const author = String((m && m.authorUserId) || '');
    if (!author || author === myId) return null; // my own build is not skew
    const peerVersion = metaStr(m, 'appVersion');
    if (!peerVersion) return null; // unstamped: the web, an external agent, a pre-Q10 build
    const notice = skewNotice(peerVersion, appVersion.appVersion(), BEHAVIOR_FLOOR);
    if (!notice) return null;
    const key = author + '|' + notice.peer;
    if (seen.has(key)) return null;
    if (seen.size >= SEEN_CAP) seen.clear();
    seen.add(key);
    const where = entry && entry.channel && entry.channel.id ? entry.channel.id.slice(0, 8) : '?';
    diag('version skew', where, 'peer', author.slice(0, 8), 'on', notice.peer,
      'vs this build', notice.mine,
      notice.explains ? 'BELOW the ' + notice.floor + ' behavior floor' : '(older, still compatible)');
    if (notice.explains) surface(notice, author);
    return notice;
  } catch (err) {
    diag('version skew: observe failed', err && err.message);
    return null;
  }
}

// Quiet and non-modal: one silent OS banner plus a standing tray line. No dialog,
// no click-to-act, nothing the operator has to dismiss — this explains a symptom,
// it does not ask for a decision.
function surface(notice, authorUserId) {
  const who = io.displayNameFor(authorUserId) || '';
  const text = skewLine(notice, who);
  try {
    if (Notification.isSupported()) {
      new Notification({ title: 'Dopl version mismatch', body: text, silent: true }).show();
    }
  } catch (_) { /* best-effort */ }
  if (onSkew) {
    try { onSkew({ peer: notice.peer, mine: notice.mine, who: who, text: text }); }
    catch (err) { diag('version skew: tray handler failed', err && err.message); }
  }
}
// ─── END VERSION-SKEW-OBSERVE ────────────────────────────────────────────────

module.exports = {
  BEHAVIOR_FLOOR,
  parseVersion,
  compareVersions,
  skewNotice,
  skewLine,
  setHandlers,
  observe,
};
