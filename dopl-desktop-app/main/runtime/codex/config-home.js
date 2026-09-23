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

// 🔒 ⚠ CODEX WRITES ITS OWN `config.toml` HERE (MEASURED 2026-09-22, codex-cli 0.155.1). A
// `thread/start` with `sandbox: 'workspace-write'` and no trust decision for its cwd AUTO-TRUSTS
// that cwd and persists `[projects."<cwd>"] trust_level = "trusted"` into THIS home — after which
// `isolatedEnv` refused every later launch — and the auto-trust also LOADED `<cwd>/.codex/config.toml`
// (a hostile `mcp_servers` entry there STARTED). `projectTrustFence` below stops both at the
// source; this reader retires a file that is ONLY such entries, so a home polluted before the
// fence shipped launches again. Anything else in it is still refused, unchanged.
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

/**
 * The `thread/start.config.projects` fence: the cwd AND every ancestor marked `untrusted`, so Codex
 * neither persists a trust entry nor loads a project `.codex/config.toml` (ancestors too, because a
 * project root found by marker can sit above the cwd). Thread-scoped; nothing is written.
 */
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
  retireCodexTrustFile(target);
  if (hasAmbientConfig(target)) {
    throw new Error('Dopl private Codex home contains config.toml; refusing an unisolated launch');
  }
  const auth = path.join(sourceHome(input, target), 'auth.json');
  linkAuth(auth, path.join(target, 'auth.json'));
  input.CODEX_HOME = target;
  input.CODEX_SQLITE_HOME = target;
  return input;
}

module.exports = { isolatedEnv, hasAmbientConfig, onlyTrustEntries, projectTrustFence, PRIVATE_HOME };
