// Ambient-config isolation: `CODEX_HOME` and `CODEX_SQLITE_HOME` both point at an app-owned home with no
// config, so nothing of `~/.codex` reaches the child. Its only credential is the `auth.json` Dopl's own
// sign-in installed (`login.js`); the operator's own login is never read.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PRIVATE_HOME = 'codex-runtime-home-v1';
// The in-app sign-in's throwaway home; its `auth.json` is moved into PRIVATE_HOME on success.
const LOGIN_HOME = 'codex-login-home-v1';
// Every Dopl-run Codex reads and writes its login as a 0600 file in its own home, never the Keychain.
const AUTH_STORE_ARGS = Object.freeze(['-c', 'cli_auth_credentials_store="file"']);

function appUserData() {
  try {
    const electron = require('electron');
    const value = electron && electron.app && electron.app.getPath('userData');
    if (value) return value;
  } catch (_) { /* plain-Node tests use the bounded temp fallback */ }
  return path.join(os.tmpdir(), `dopl-user-data-${typeof process.getuid === 'function' ? process.getuid() : 'local'}`);
}

function hasAmbientConfig(home) {
  try {
    return fs.readdirSync(home).some((name) => name === 'config.toml' || name.endsWith('.config.toml'));
  } catch (_) {
    return false;
  }
}

// A `workspace-write` thread auto-trusts its cwd — writing a `[projects]` trust entry into this home and
// loading `<cwd>/.codex/config.toml` — unless `projectTrustFence` marks it untrusted. A home file holding
// only trust entries is retired; anything else still refuses the launch.
const TRUST_TABLE_RE = /^\[projects\."(?:[^"\\]|\\.)*"\]$/;
const TRUST_VALUE_RE = /^trust_level\s*=\s*"(?:trusted|untrusted)"$/;
function onlyTrustEntries(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return true;
  if (lines.length % 2) return false;
  for (let i = 0; i < lines.length; i += 2) {
    if (!TRUST_TABLE_RE.test(lines[i]) || !TRUST_VALUE_RE.test(lines[i + 1])) return false;
  }
  return true;
}
function retireCodexTrustFile(home) {
  const file = path.join(home, 'config.toml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  if (onlyTrustEntries(text)) fs.unlinkSync(file);
}

// `thread/start.config.projects`: cwd AND every ancestor `untrusted` (a marker-found project root can sit
// above cwd). Thread-scoped; nothing is written.
function projectTrustFence(cwd) {
  const out = {};
  if (typeof cwd !== 'string' || !cwd) return out;
  let dir = path.resolve(cwd);
  for (;;) {
    out[dir] = { trust_level: 'untrusted' };
    const up = path.dirname(dir);
    if (up === dir) return out;
    dir = up;
  }
}

const lstatOrNull = (file) => {
  try { return fs.lstatSync(file); } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
};

/** The app-owned CODEX_HOME a launch runs against (created by `isolatedEnv`). */
function privateHome(userDataRoot) {
  return path.join(userDataRoot || appUserData(), PRIVATE_HOME);
}

function ownerOnlyDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) { /* best effort on non-POSIX filesystems */ }
}

/** A fresh, empty login home and the env a login app-server runs with. */
function loginEnv(env, userDataRoot) {
  const home = path.join(userDataRoot || appUserData(), LOGIN_HOME);
  fs.rmSync(home, { recursive: true, force: true });
  ownerOnlyDir(home);
  return { home, env: Object.assign({}, env || {}, { CODEX_HOME: home, CODEX_SQLITE_HOME: home }) };
}

const authFile = (userDataRoot) => path.join(privateHome(userDataRoot), 'auth.json');

/** Is the Dopl-owned `auth.json` present? A link an older build made to the operator's own is removed. */
function hasAuth(userDataRoot) {
  const file = authFile(userDataRoot);
  const st = lstatOrNull(file);
  if (st && st.isSymbolicLink()) {
    fs.unlinkSync(file);
    return false;
  }
  return !!st && st.isFile();
}

/** Remove the Dopl-owned `auth.json` (a Dopl sign-out). */
function removeAuth(userDataRoot) {
  fs.rmSync(authFile(userDataRoot), { force: true });
}

/** Remove the login home (idempotent). */
function clearLoginHome(userDataRoot) {
  fs.rmSync(path.join(userDataRoot || appUserData(), LOGIN_HOME), { recursive: true, force: true, maxRetries: 3 });
}

/** Move a login's `auth.json` into the private home as the Dopl-owned credential. */
function installAuth(file, userDataRoot) {
  const st = lstatOrNull(file);
  if (!st || !st.isFile()) throw new Error('the Codex sign-in left no credential file');
  ownerOnlyDir(privateHome(userDataRoot));
  fs.chmodSync(file, 0o600);
  fs.renameSync(file, authFile(userDataRoot));
}

function isolatedEnv(env, userDataRoot) {
  const input = Object.assign({}, env || {});
  const target = privateHome(userDataRoot);
  ownerOnlyDir(target);
  retireCodexTrustFile(target);
  if (hasAmbientConfig(target)) {
    throw new Error(`Dopl private Codex home contains config.toml; refusing an unisolated launch (${target})`);
  }
  hasAuth(userDataRoot); // drops an older build's link before any child can follow it
  input.CODEX_HOME = target;
  input.CODEX_SQLITE_HOME = target;
  return input;
}

module.exports = {
  isolatedEnv, privateHome, hasAmbientConfig, onlyTrustEntries, projectTrustFence,
  hasAuth, removeAuth, loginEnv, clearLoginHome, installAuth,
  PRIVATE_HOME, LOGIN_HOME, AUTH_STORE_ARGS,
};
