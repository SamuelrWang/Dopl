// WHICH CODEX BUILD NEW LAUNCHES RUN — `{ path, version }` for core's build key (`../roster-key.js`).
// Synchronous by contract (the catalog asks on every look), so the version comes from what is already
// known: the last `--version` answer for that exact file (`client.js › probe` records it), else the
// version the bundle's or the updater's own package record states. A file nobody has asked yet answers
// no version — NO key, so nothing is reused for it until the probe has run — never a guessed one.

const fs = require('fs');
const crypto = require('crypto');
const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');

// `<realpath>|<mtimeMs>` → `X.Y.Z` (cross-review M1): an IN-PLACE upgrade (brew, npm) keeps the path but
// rewrites the file, so a version learned for the old file is never reused for the new one.
const versions = new Map();

const stampOf = (file) => {
  try { return `${file}|${fs.statSync(file).mtimeMs}`; } catch (_) { return ''; }
};

/** `codex-cli 0.155.1` / `0.155.1-darwin-arm64` → `0.155.1`, or null. */
function normalize(text) {
  const v = protocol.parseVersion(text);
  return v ? v.join('.') : null;
}

/** Record what a file answered to `--version` (`client.js › probeAt`). */
function noteVersion(file, versionText) {
  const v = normalize(versionText);
  const stamp = stampOf(file);
  if (stamp && v) versions.set(stamp, v);
}

// THE ACCOUNT, FINGERPRINTED (cross-review M2): the roster is per account, so the build key carries a hash
// of the signed-in account's id from Dopl's own `auth.json` (never the token). No readable id = no account
// in the key, and the shared catalog then shows a persisted roster as labels only (`model-catalog.js`).
let accountMemo = { stamp: null, value: null };
function accountFingerprint() {
  let file;
  try { file = require('./config-home').authFile(); } catch (_) { return null; }
  const stamp = stampOf(file);
  if (!stamp) return null;
  if (accountMemo.stamp === stamp) return accountMemo.value;
  let value = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const id = raw && raw.tokens && typeof raw.tokens.account_id === 'string' ? raw.tokens.account_id : '';
    value = id ? crypto.createHash('sha256').update(id).digest('hex').slice(0, 16) : null;
  } catch (_) { value = null; }
  accountMemo = { stamp, value };
  return value;
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
  let version = versions.get(stampOf(found.path)) || null;
  if (!version) {
    try { version = packagedVersion(found); } catch (_) { version = null; }
  }
  let account = null;
  try { account = accountFingerprint(); } catch (_) { account = null; }
  return { path: found.path, version, account };
}

/** Tests only. */
function forget() { versions.clear(); accountMemo = { stamp: null, value: null }; }

module.exports = { buildIdentity, noteVersion, normalize, forget };
