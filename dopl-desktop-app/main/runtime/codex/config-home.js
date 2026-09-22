// AMBIENT CONFIG ISOLATION.
//
// CODEX_HOME is the documented root for app-server config, auth and state. Dopl launches against
// an app-owned home containing no config files and exposes only the operator's existing auth cache
// through a symlink. This keeps `~/.codex/config.toml`, profiles, MCP servers and permission
// defaults out of the child without copying a bearer or putting one on argv.

const fs = require('fs');
const os = require('os');
const path = require('path');

const PRIVATE_HOME = 'codex-runtime-home-v1';

function appUserData() {
  try {
    const electron = require('electron');
    const value = electron && electron.app && electron.app.getPath('userData');
    if (value) return value;
  } catch (_) { /* plain-Node tests use the bounded temp fallback */ }
  return path.join(os.tmpdir(), `dopl-user-data-${typeof process.getuid === 'function' ? process.getuid() : 'local'}`);
}

function sourceHome(env, target) {
  const asked = env && typeof env.CODEX_HOME === 'string' ? env.CODEX_HOME.trim() : '';
  const fallback = path.join(os.homedir(), '.codex');
  const chosen = asked || fallback;
  return path.resolve(chosen) === path.resolve(target) ? fallback : chosen;
}

function hasAmbientConfig(home) {
  try {
    return fs.readdirSync(home).some((name) => name === 'config.toml' || name.endsWith('.config.toml'));
  } catch (_) {
    return false;
  }
}

function linkAuth(source, target) {
  if (!fs.existsSync(source)) return;
  try {
    const current = fs.lstatSync(target);
    if (!current.isSymbolicLink()) {
      throw new Error('Dopl private Codex home contains an unexpected auth.json');
    }
    if (path.resolve(fs.realpathSync(target)) === path.resolve(fs.realpathSync(source))) return;
    // Only the app-owned link is replaced; the credential file it points at is never removed.
    fs.unlinkSync(target);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
  fs.symlinkSync(source, target, 'file');
}

function isolatedEnv(env, userDataRoot) {
  const input = Object.assign({}, env || {});
  const root = userDataRoot || appUserData();
  const target = path.join(root, PRIVATE_HOME);
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(target, 0o700); } catch (_) { /* best effort on non-POSIX filesystems */ }
  if (hasAmbientConfig(target)) {
    throw new Error('Dopl private Codex home contains config.toml; refusing an unisolated launch');
  }
  const auth = path.join(sourceHome(input, target), 'auth.json');
  linkAuth(auth, path.join(target, 'auth.json'));
  input.CODEX_HOME = target;
  input.CODEX_SQLITE_HOME = target;
  return input;
}

module.exports = { isolatedEnv, hasAmbientConfig, PRIVATE_HOME };
