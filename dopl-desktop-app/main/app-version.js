// This build's version, and the header that carries it (Q10).
//
// THE INCIDENT (2026-07-31). electron-updater downloads in the background and
// installs ON QUIT (`autoInstallOnAppQuit`), and a background listener app is
// quit approximately never. A peer Mac therefore ran 1.7.14 for a whole evening
// after 1.7.15 shipped, and the released fix looked broken from the other side —
// it was simply not running. Neither machine could see the skew, so it cost a
// full debugging round.
//
// The fix has two halves. This module is the first: every request the desktop
// makes carries `X-Dopl-App-Version`, and the server stamps it onto outbound
// messages as the RESERVED `metadata.appVersion` key (see
// src/shared/auth/app-version-header.ts and resolvePostMetadata). The second is
// version-skew.js, which reads that stamp off a PEER's message and says so.
//
// HEADER-SET, NOT BODY-SET, for the same reason `X-Dopl-Runtime` is: the server
// strips any caller-supplied `metadata.appVersion` and re-stamps only from the
// header, so no message body can claim a version. It remains a DIAGNOSTIC hint,
// never an authorization signal — nothing gates on it, and the worst a lie can
// do is print a misleading line in a log.
//
// The header rides on the two shared fetch seams (api.js apiFetch, listener-io.js
// apiFetch) rather than at each post site, so a NEW post site cannot forget it.

const HEADER = 'X-Dopl-App-Version';

// The exact shape the server accepts: major.minor.patch, optional short
// pre-release tag. A value that fails this is not sent at all, because a
// rejected header and an absent one mean the same thing server-side and an
// unsendable one would just be noise on the wire.
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,16})?$/;

let cached; // undefined = not resolved yet; '' = resolved to nothing

// This app's version. `app.getVersion()` reads the packaged Info.plist / the
// package.json version, and is the same string electron-updater compares against
// the release feed — so what we advertise is exactly what we would be updated
// from. Falls back to package.json for a non-Electron context (the unit tests
// require this module directly), then to '' — never throws.
function appVersion() {
  if (cached !== undefined) return cached;
  cached = '';
  try {
    const v = String(require('electron').app.getVersion() || '');
    if (VERSION_RE.test(v)) cached = v;
  } catch (_) { /* not running under Electron */ }
  if (!cached) {
    try {
      const v = String(require('../package.json').version || '');
      if (VERSION_RE.test(v)) cached = v;
    } catch (_) { /* packaged without a readable package.json */ }
  }
  return cached;
}

// `{ 'X-Dopl-App-Version': '1.7.15' }`, or `{}` when the version is unknown. An
// empty object is the deliberate shape: Object.assign-ing it is a no-op, so a
// caller never has to branch, and an unknown version sends NO header rather than
// a blank one the server would reject anyway.
function versionHeaders() {
  const v = appVersion();
  return v ? { [HEADER]: v } : {};
}

module.exports = { HEADER, VERSION_RE, appVersion, versionHeaders };
