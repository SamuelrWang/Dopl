// Claude CLI resolution + spawn environment (H1).
//
// SPLIT NOTE (§2 refactor): extracted from session-spawner.js to bring it under
// the 500-line cap. session-spawner.js re-exports claudeAvailable /
// getClaudeBinPath / cliEnv, so its public API (used by mcp-config.js and
// claude-auth.js) is unchanged.
//
// GUI / login-item launches inherit launchd's minimal PATH (/usr/bin:/bin:…),
// which never contains claude (it lives in ~/.local/bin, /opt/homebrew/bin, an
// npm global bin, etc.). We resolve the absolute binary once at startup by
// probing common install dirs + the user's login-shell PATH, cache it, and pass
// an augmented PATH to execFile. Spawning is gated on resolution success.

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

const store = new Store();
const CLAUDE_BIN_KEY = 'claudeBinPath'; // electron-store override for the CLI path

let resolvedClaude = null; // string path | false (resolved+missing) | null (unresolved)
let resolving = null; // in-flight resolution promise (coalesces concurrent probes)
let loginShellPath = ''; // captured login-shell PATH, for env augmentation

function isExecutableFile(p) {
  try {
    return fs.statSync(p).isFile() && (fs.accessSync(p, fs.constants.X_OK), true);
  } catch (_) {
    return false;
  }
}

function candidateDirs() {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.npm-global', 'bin'),
    path.join(home, 'node_modules', '.bin'),
  ];
}

// Fast synchronous probe: explicit override, then common install dirs.
function probeStaticPath() {
  const override = store.get(CLAUDE_BIN_KEY);
  if (typeof override === 'string' && isExecutableFile(override)) return override;
  for (const dir of candidateDirs()) {
    const p = path.join(dir, 'claude');
    if (isExecutableFile(p)) return p;
  }
  return null;
}

// Ask the user's login shell where claude is (and capture its PATH). On macOS a
// login+interactive zsh sources the profile that actually has the real PATH.
function probeLoginShell() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      resolve(null);
      return;
    }
    const shell = process.env.SHELL || '/bin/zsh';
    execFile(
      shell,
      ['-ilc', 'command -v claude; printf "\\nPATHIS=%s" "$PATH"'],
      { timeout: 6000 },
      (_err, stdout) => {
        const out = String(stdout || '');
        const pathMatch = out.match(/PATHIS=(.*)$/m);
        if (pathMatch && pathMatch[1]) loginShellPath = pathMatch[1].trim();
        const firstLine = (out.split('\n')[0] || '').trim();
        if (firstLine && path.isAbsolute(firstLine) && isExecutableFile(firstLine)) {
          resolve(firstLine);
          return;
        }
        resolve(null);
      }
    );
  });
}

// Resolve (and cache) the absolute claude path. Returns the path or null.
function resolveClaude() {
  if (resolvedClaude !== null) return Promise.resolve(resolvedClaude || null);
  if (resolving) return resolving;
  resolving = (async () => {
    const staticBin = probeStaticPath();
    // Always run the login-shell probe so loginShellPath is captured for env
    // augmentation, but prefer the static hit when we have one.
    const shellBin = await probeLoginShell();
    const bin = staticBin || shellBin;
    resolvedClaude = bin || false;
    return resolvedClaude || null;
  })();
  const p = resolving;
  p.finally(() => {
    resolving = null;
  });
  return p;
}

// PATH for the spawned CLI: the binary's dir + common install dirs + the login
// shell's PATH + the inherited PATH (deduped, first-wins).
function augmentedEnv(binPath) {
  const parts = [];
  if (binPath) parts.push(path.dirname(binPath));
  parts.push(...candidateDirs());
  if (loginShellPath) parts.push(...loginShellPath.split(':'));
  parts.push(...String(process.env.PATH || '').split(':'));
  const seen = new Set();
  const merged = parts.filter((p) => p && !seen.has(p) && seen.add(p)).join(':');
  return { ...process.env, PATH: merged };
}

// Best-effort probe so the listener can warn if the CLI is missing AND gate
// spawning. Resolves true only when an absolute claude binary was found.
function claudeAvailable() {
  return resolveClaude().then((bin) => !!bin);
}

// The resolved absolute claude path (or null). Shared with mcp-config (for
// `claude mcp …`) and claude-auth (for `claude setup-token`) so they never
// re-probe the CLI location.
function getClaudeBinPath() {
  return resolveClaude();
}

// PATH-augmented env for a non-spawn CLI call (`claude mcp …`, setup-token). No
// OAuth token injected — those operations don't need it.
function cliEnv(bin) {
  return augmentedEnv(bin);
}

// ⚠ THE LIVE SURFACE ONLY (pruned 2026-08-20). `resolveClaude` and `augmentedEnv` are internal
// — `claudeAvailable` / `getClaudeBinPath` / `cliEnv` are the three names other modules import
// (through `session-spawner.js`'s facade), and exporting the internals invited a fourth caller
// to reach past them.
module.exports = {
  claudeAvailable,
  getClaudeBinPath,
  cliEnv,
};
