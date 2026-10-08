// WHICH CODEX BUILD NEW LAUNCHES RUN — `{ path, version }` for core's build key (`../roster-key.js`).
// Synchronous by contract (the catalog asks on every look), so the version comes from what is already
// known: the last `--version` answer for that exact file (`client.js › probe` records it), else the
// version the bundle's or the updater's own package record states. A file nobody has asked yet answers
// no version — NO key, so nothing is reused for it until the probe has run — never a guessed one.

const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');

const versions = new Map(); // realpath → `X.Y.Z`

/** `codex-cli 0.155.1` / `0.155.1-darwin-arm64` → `0.155.1`, or null. */
function normalize(text) {
  const v = protocol.parseVersion(text);
  return v ? v.join('.') : null;
}

/** Record what a file answered to `--version` (`client.js › probeAt`). */
function noteVersion(file, versionText) {
  const v = normalize(versionText);
  if (file && v) versions.set(file, v);
}

function packagedVersion(found) {
  const src = require('./update-source');
  if (found.source === 'bundled') return normalize(src.bundledVersion());
  if (found.source === 'downloaded') return normalize((require('../updates').activeFor(src) || {}).version);
  return null;
}

/** `{ path, version }` of the build new launches run, or null when no build resolves. Never throws. */
function buildIdentity() {
  let found;
  try { found = resolveBin.resolveCodexBin(); } catch (_) { return null; }
  if (!found || !found.ok || !found.path) return null;
  let version = versions.get(found.path) || null;
  if (!version) {
    try { version = packagedVersion(found); } catch (_) { version = null; }
  }
  return { path: found.path, version };
}

/** Tests only. */
function forget() { versions.clear(); }

module.exports = { buildIdentity, noteVersion, normalize, forget };
