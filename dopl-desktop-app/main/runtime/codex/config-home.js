// Ambient-config isolation: `CODEX_HOME` and `CODEX_SQLITE_HOME` both point at an app-owned home with no
// config, so nothing of `~/.codex` reaches the child. Its only credential is the `auth.json` Dopl's own
// sign-in installed (`login.js`); the operator's own login is never read. The owner-only home, the
// `0600` install and the symlink removal are the kit's (`../kit/private-home.js`, runtime scaffold K8);
// this file keeps Codex's names, its ambient-config set, its trust-table rules and the refusal.

const fs = require('fs');
const path = require('path');
const home = require('../kit/private-home');

const PRIVATE_HOME = 'codex-runtime-home-v1';
// The in-app sign-in's throwaway home; its `auth.json` is moved into PRIVATE_HOME on success.
const LOGIN_HOME = 'codex-login-home-v1';
// Every Dopl-run Codex reads and writes its login as a 0600 file in its own home, never the Keychain.
const AUTH_STORE_ARGS = Object.freeze(['-c', 'cli_auth_credentials_store="file"']);

function hasAmbientConfig(dir) {
  return home.hasEntry(dir, (name) => name === 'config.toml' || name.endsWith('.config.toml'));
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

/** `dir` and every ancestor up to `/`, nearest first; `[]` for no path. */
function ancestors(dir) {
  const out = [];
  if (typeof dir !== 'string' || !dir) return out;
  let d = path.resolve(dir);
  for (;;) {
    out.push(d);
    const up = path.dirname(d);
    if (up === d) return out;
    d = up;
  }
}

// `thread/start.config.projects`: cwd AND every ancestor `untrusted` (a marker-found project root can sit
// above cwd). Thread-scoped; nothing is written.
function projectTrustFence(cwd) {
  return Object.fromEntries(ancestors(cwd).map((dir) => [dir, { trust_level: 'untrusted' }]));
}

/** The app-owned CODEX_HOME a launch runs against (created by `isolatedEnv`). */
function privateHome(userDataRoot) {
  return home.privateHome(PRIVATE_HOME, userDataRoot);
}

/** A fresh, empty login home and the env a login app-server runs with. */
function loginEnv(env, userDataRoot) {
  const dir = home.privateHome(LOGIN_HOME, userDataRoot);
  home.freshDir(dir);
  return { home: dir, env: Object.assign({}, env || {}, { CODEX_HOME: dir, CODEX_SQLITE_HOME: dir }) };
}

const authFile = (userDataRoot) => path.join(privateHome(userDataRoot), 'auth.json');

/** Is the Dopl-owned `auth.json` present? A link an older build made to the operator's own is removed. */
function hasAuth(userDataRoot) {
  return home.ownedFile(authFile(userDataRoot));
}

/** Remove the Dopl-owned `auth.json` (a Dopl sign-out). */
function removeAuth(userDataRoot) {
  home.removeFile(authFile(userDataRoot));
}

/** Remove the login home (idempotent). */
function clearLoginHome(userDataRoot) {
  home.removeDir(home.privateHome(LOGIN_HOME, userDataRoot));
}

/** Move a login's `auth.json` into the private home as the Dopl-owned credential. */
function installAuth(file, userDataRoot) {
  home.installFile(file, authFile(userDataRoot), 'the Codex sign-in left no credential file');
}

function isolatedEnv(env, userDataRoot) {
  const input = Object.assign({}, env || {});
  const target = privateHome(userDataRoot);
  home.ownerOnlyDir(target);
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
  isolatedEnv, privateHome, hasAmbientConfig, onlyTrustEntries, projectTrustFence, ancestors,
  hasAuth, removeAuth, loginEnv, clearLoginHome, installAuth, authFile,
  PRIVATE_HOME, AUTH_STORE_ARGS,
};
