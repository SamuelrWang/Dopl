// WHICH MUSE BUILD NEW LAUNCHES RUN — `{ path, version, account }` for core's build key (`../roster-key.js`).
// Synchronous by contract: the version is the last `--version` answer for that exact file (`client.js ›
// probe` records it), else the version the updater's own record states. A file nobody has asked yet
// answers no version — no key, nothing reused — never a guessed one.

const fs = require('fs');
const crypto = require('crypto');
const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');

// `<path>|<mtimeMs>` → release: an in-place upgrade keeps the path but rewrites the file.
const versions = new Map();

const stampOf = (file) => {
  try { return `${file}|${fs.statSync(file).mtimeMs}`; } catch (_) { return ''; }
};

/** `Muse Code 1.4.7 (1.4.7-R6101.1)` → `1.4.7-R6101.1`, or null. */
const normalize = (text) => protocol.releaseOf(text);

/** Record what a file answered to `--version` (`../kit/probe-bin.js`, via `client.js › probe`). */
function noteVersion(file, versionText) {
  const v = normalize(versionText);
  const stamp = stampOf(file);
  if (stamp && v) versions.set(stamp, v);
}

// The roster is per account. Dopl's own `auth.json` is hashed WHOLE (its field names are not measured for
// an account login, so no field is assumed): a new sign-in is a new key; no file = no account in the key.
let accountMemo = { stamp: null, value: null };
function accountFingerprint() {
  let file;
  try { file = require('./config-home').authFile(); } catch (_) { return null; }
  const stamp = stampOf(file);
  if (!stamp) return null;
  if (accountMemo.stamp === stamp) return accountMemo.value;
  let value = null;
  try { value = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16); } catch (_) { value = null; }
  accountMemo = { stamp, value };
  return value;
}

/** `{ path, version, account }` of the build new launches run, or null when no build resolves. Never throws. */
function buildIdentity() {
  let found;
  try { found = resolveBin.resolveMuseBin(); } catch (_) { return null; }
  if (!found || !found.ok || !found.path) return null;
  let version = versions.get(stampOf(found.path)) || null;
  if (!version && found.source === 'downloaded') {
    try { version = (require('../updates').activeFor(require('./update-source')) || {}).version || null; } catch (_) { version = null; }
  }
  let account = null;
  try { account = accountFingerprint(); } catch (_) { account = null; }
  return { path: found.path, version, account };
}

/** Tests only. */
function forget() { versions.clear(); accountMemo = { stamp: null, value: null }; }

module.exports = { buildIdentity, noteVersion, normalize, forget };
