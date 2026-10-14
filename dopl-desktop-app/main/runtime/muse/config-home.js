// Ambient-config isolation for `muse serve`: HOME and every XDG_* root point at an app-owned home, so
// nothing of the operator's `~/.config/muse`, `~/.claude`, `~/.codex` or `~/.agents` reaches the child
// (MEASURED, muse 1.4.7: `context.foreign_personal_skills=false` does NOT hide `~/.claude/skills` from
// `skill/list` — the private HOME is the fence, F-772). Its only credential is the `auth.json` Dopl's own
// sign-in installed (`login.js`, the file backend). The owner-only home, the `0600` install and the
// symlink removal are the kit's (`../kit/private-home.js`); this file keeps Muse's names, its
// ambient-config set and the refusal.

const path = require('path');
const home = require('../kit/private-home');
const cliSpawn = require('../cli-spawn');

const PRIVATE_HOME = 'muse-runtime-home-v1';
// The in-app sign-in's throwaway home; its `auth.json` is moved into PRIVATE_HOME on success.
const LOGIN_HOME = 'muse-login-home-v1';

// Muse's own process knobs, set on every Dopl spawn (MSP-REFERENCE §1.2, verified on 1.4.7): no launcher
// self-update, no telemetry, credentials as a file in the private home (never the operator's Keychain).
const PROCESS_ENV = Object.freeze({
  MUSE_NO_AUTO_UPDATE: '1',
  TBH_DISABLE_TELEMETRY: '1',
  TBH_DISABLE_FEATURE_CONFIG: '1',
  TBH_CREDENTIAL_BACKEND: 'file',
});

// Every inherited vendor credential is dropped by `cliSpawn.scrubbedEnv` (META_API_KEY "always takes
// priority over the account login" — `muse login --help` — so an operator's key would silently replace the
// sign-in Dopl holds), and EVERY `MUSE_*` / `TBH_*` / `META_*` knob is stripped: Dopl sets its own
// (`PROCESS_ENV`) and none of the operator's may move a session.
const VENDOR_ENV_RE = /^(MUSE_|TBH_|META_|MODEL_API_KEY$)/;

/** The operator's env minus credentials and every Muse knob, plus `extra`. */
function buildScrubbedEnv(extra) {
  return Object.assign(cliSpawn.scrubbedEnv(process.env, VENDOR_ENV_RE, /./), extra || {});
}

/** The XDG roots under one home (Muse reads `$XDG_CONFIG_HOME/muse`, writes `$XDG_DATA_HOME/muse`). */
function rootsOf(dir) {
  return {
    HOME: dir,
    XDG_CONFIG_HOME: path.join(dir, 'config'),
    XDG_DATA_HOME: path.join(dir, 'data'),
    XDG_CACHE_HOME: path.join(dir, 'cache'),
    XDG_STATE_HOME: path.join(dir, 'state'),
  };
}

const configDir = (dir) => path.join(dir, 'config', 'muse');

// What would load into a session if it were here: settings (permission defaults, hooks, MCP servers),
// trust decisions (project skills/hooks/.mcp.json), personal skills, and the foreign skill roots.
const AMBIENT_IN_CONFIG = Object.freeze(['settings.json', 'trust.json', 'hooks.json', '.mcp.json', 'skills']);
const AMBIENT_IN_HOME = Object.freeze(['.claude', '.codex', '.agents']);

/** The ambient entries present in a home, by name (empty = isolated). */
function ambientConfig(dir) {
  const found = [];
  for (const n of AMBIENT_IN_CONFIG) if (home.hasEntry(configDir(dir), (x) => x === n)) found.push(`config/muse/${n}`);
  for (const n of AMBIENT_IN_HOME) if (home.hasEntry(dir, (x) => x === n)) found.push(n);
  return found;
}

/** The app-owned home a launch runs against (created by `isolatedEnv`). */
function privateHome(userDataRoot) {
  return home.privateHome(PRIVATE_HOME, userDataRoot);
}

const authFile = (userDataRoot) => path.join(configDir(privateHome(userDataRoot)), 'auth.json');

/** Is the Dopl-owned `auth.json` present? A symlink there is removed, never followed. */
function hasAuth(userDataRoot) {
  return home.ownedFile(authFile(userDataRoot));
}

/** Remove the Dopl-owned `auth.json` (a Dopl sign-out). */
function removeAuth(userDataRoot) {
  home.removeFile(authFile(userDataRoot));
}

/** A fresh, empty login home and the env a login `muse serve` runs with. */
function loginEnv(env, userDataRoot) {
  const dir = home.privateHome(LOGIN_HOME, userDataRoot);
  home.freshDir(dir);
  return { home: dir, authFile: path.join(configDir(dir), 'auth.json'), env: Object.assign({}, env || {}, rootsOf(dir), PROCESS_ENV) };
}

/** Remove the login home (idempotent). */
function clearLoginHome(userDataRoot) {
  home.removeDir(home.privateHome(LOGIN_HOME, userDataRoot));
}

/** Move a login's `auth.json` into the private home as the Dopl-owned credential. */
function installAuth(file, userDataRoot) {
  home.installFile(file, authFile(userDataRoot), 'the Muse sign-in left no credential file');
}

/** `env` with HOME/XDG_* moved into Dopl's private home and Muse's process knobs set. Refuses a home that
 *  holds ambient configuration (something other than Dopl wrote it). */
function isolatedEnv(env, userDataRoot) {
  const target = privateHome(userDataRoot);
  home.ownerOnlyDir(target);
  const found = ambientConfig(target);
  if (found.length) {
    throw new Error(`Dopl's private Muse home holds ${found.join(', ')}; refusing an unisolated launch (${target})`);
  }
  hasAuth(userDataRoot); // drops a link before any child can follow it
  return Object.assign({}, env || {}, rootsOf(target), PROCESS_ENV);
}

module.exports = {
  isolatedEnv, buildScrubbedEnv, privateHome, ambientConfig, rootsOf, configDir,
  hasAuth, removeAuth, loginEnv, clearLoginHome, installAuth, authFile,
  PRIVATE_HOME, LOGIN_HOME, PROCESS_ENV, AMBIENT_IN_CONFIG, AMBIENT_IN_HOME,
};
