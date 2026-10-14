// WHICH GROK BUILD NEW LAUNCHES RUN — `{ path, version, account }` for core's build key (`../roster-key.js`).
// Synchronous by contract: the version is the last `--version` answer for that exact file (`client.js ›
// probe` records it; `grok 1.0.52 (0920c8169e27)` → `1.0.52`), else the version the updater's own record
// states. A file nobody has asked yet answers no version — no key, nothing reused — never a guessed one.

const fs = require('fs');
const crypto = require('crypto');
const resolveBin = require('./resolve-bin');
const protocol = require('./protocol');

// `<path>|<mtimeMs>` → release: an in-place upgrade keeps the path but rewrites the file.
const versions = new Map();

const stampOf = (file) => {
  try { return `${file}|${fs.statSync(file).mtimeMs}`; } catch (_) { return ''; }
};

/** `grok 1.0.52 (0920c8169e27)` → `1.0.52`, or null. */
const normalize = (text) => protocol.releaseOf(text);

/** Record what a file answered to `--version` (`../kit/probe-bin.js`, via `client.js › probe`). */
function noteVersion(file, versionText) {
  const v = normalize(versionText);
  const stamp = stampOf(file);
  if (stamp && v) versions.set(stamp, v);
}

// The roster is per account. Dopl never opens Grok's `auth.json` (it holds a live OIDC token Grok refreshes
// in place), so the account half of the key is the FILE's identity — inode + birth time — not its bytes: a new
// sign-in installs a new file (a rename, `config-home.js › installAuth`), so it is a new key; no file = no
// account in the key. (A refresh that replaces the file only costs one roster re-read.)
function accountFingerprint() {
  let file;
  try { file = require('./config-home').authFile(); } catch (_) { return null; }
  let st;
  try { st = fs.lstatSync(file); } catch (_) { return null; }
  if (!st.isFile()) return null;
  return crypto.createHash('sha256').update(`${st.ino}|${st.birthtimeMs}`).digest('hex').slice(0, 16);
}

/** `{ path, version, account }` of the build new launches run, or null when no build resolves. Never throws. */
function buildIdentity() {
  let found;
  try { found = resolveBin.resolveGrokBin(); } catch (_) { return null; }
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
function forget() { versions.clear(); }

module.exports = { buildIdentity, noteVersion, normalize, forget };
