// Which vendor binary every caller runs; resolves only, never spawns (docs/specs/runtime-scaffold.md §3
// K9). Order is policy: the operator's override env > a verified download newer than the bundle (the
// updater's active build) > bundled > PATH > well-known prefixes (a Finder-launched app gets launchd's bare
// PATH). Every candidate, the bundle included, must pass `inspectCandidate`.
//
// 🔒 THE MOST SECURITY-SENSITIVE CODE IN THE RUNTIME TREE (INVARIANTS §11.0d: a file with the right NAME
// is not a reason to run it). Moved VERBATIM from the first adapter's resolve-bin.js (2026-10-13); the
// only change is that the vendor's facts — binary name, override env, display label, how its bundle and
// its npm launcher map to the real binary, its package resolver and its updater's active build — are
// passed in by the adapter's own `resolve-bin.js`. Nothing here decides anything a vendor could change.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Where macOS installers put a CLI, searched in order; `~` expands per call (tests drive a fake home).
const WELL_KNOWN = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '~/.local/bin',
  '~/.bun/bin',
  '~/.volta/bin',
  '~/.npm-global/bin',
];

// `npm i -g` under Homebrew node lands in the versioned keg, which no constant can name. Only helps under
// plain node (scripts/tests): in Electron main `execPath` is the Dopl binary, not an interpreter.
function nodeNeighbours(execPath) {
  const out = [];
  const bin = execPath ? path.dirname(execPath) : '';
  if (!bin) return out;
  out.push(bin);
  // Homebrew keg layout: `<keg>/bin/node` beside `<keg>/lib/node_modules/.bin`.
  out.push(path.join(path.dirname(bin), 'lib', 'node_modules', '.bin'));
  return out;
}

// ─── BEGIN RESOLVE-PURE (no electron, no spawn; unit-tested directly) ───

function expandHome(entry, home) {
  if (entry === '~') return home;
  if (entry.startsWith('~/')) return path.join(home, entry.slice(2));
  return entry;
}

// Not `& 0o022` (Homebrew dirs are group-writable by design): world-writable is always refused;
// group-writable only when the owner is neither `uid` nor root. No `uid` → strict.
function writableByOthers(stat, uid) {
  if (!stat) return true;
  if ((stat.mode & 0o002) !== 0) return true;
  if ((stat.mode & 0o020) === 0) return false;
  if (typeof uid !== 'number') return true;
  return !(stat.uid === uid || stat.uid === 0);
}

// Walks every ancestor of the candidate AND its symlink target (a safe name into a writable tree is a hole);
// returns the canonical path so spawn runs the inspected file. `missing` (not found) is never reported.
function inspectCandidate(file, io, uid) {
  let resolved;
  try {
    resolved = io.realpathSync(file);
  } catch (_) {
    return { ok: false, missing: true, reason: 'not found' };
  }
  let st;
  try {
    st = io.statSync(resolved);
  } catch (_) {
    return { ok: false, missing: true, reason: 'not found' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
  try {
    io.accessSync(resolved, fs.constants.X_OK);
  } catch (_) {
    return { ok: false, reason: 'not executable by this user' };
  }
  if (writableByOthers(st, uid)) {
    return { ok: false, reason: 'refused: the file is writable by other users' };
  }

  const inspectDirectories = (candidate, label) => {
    let dir = path.dirname(path.resolve(candidate));
    let immediate = true;
    while (true) {
      let dirStat;
      try {
        dirStat = io.statSync(dir);
      } catch (_) {
        return `refused: its ${label} ${immediate ? 'directory' : 'ancestor'} could not be read`;
      }
      if (writableByOthers(dirStat, uid)) {
        return `refused: its ${label} ${immediate ? 'directory' : 'ancestor'} \`${dir}\` is writable by other users`;
      }
      const parent = path.dirname(dir);
      if (parent === dir) return '';
      dir = parent;
      immediate = false;
    }
  };

  const candidatePath = path.resolve(file);
  const candidateRefusal = inspectDirectories(candidatePath, 'candidate');
  if (candidateRefusal) return { ok: false, reason: candidateRefusal };
  if (resolved !== candidatePath) {
    const targetRefusal = inspectDirectories(resolved, 'resolved target');
    if (targetRefusal) return { ok: false, reason: targetRefusal };
  }
  return { ok: true, path: resolved, reason: '' };
}

// ─── END RESOLVE-PURE ───

/**
 * One resolver for one vendor binary. `cfg`:
 *   `binName`          the file name searched for on PATH / well-known dirs, and named in messages;
 *   `overrideEnv`      the operator's override env var (outranks the bundle; still validated);
 *   `label`            the runtime's display name, in the not-installed sentence;
 *   `bundledCandidate({ platform, arch, resolvePackage })` → the bundled binary's path, or null;
 *   `launcherVendor(resolved, { platform, arch, resolvePackage })` → the real binary a launcher script
 *                      would spawn, or null (optional);
 *   `resolvePackage`   the ADAPTER module's own `require.resolve` (it shares the vendored package tree);
 *   `downloaded()`     → the updater's active binary path, or null — called per resolve, LAZILY (the
 *                      adapter's update source requires its resolve-bin).
 * Returns `{ resolveWith, resolve, forget }`.
 */
function makeResolver(cfg) {
  const BIN = cfg.binName;
  const OVERRIDE_ENV = cfg.overrideEnv;
  const label = cfg.label;
  const bundledCandidate = cfg.bundledCandidate;
  const launcherVendor = typeof cfg.launcherVendor === 'function' ? cfg.launcherVendor : () => null;

  /**
   * The search, pure over `env` and `io` (`{ realpathSync, statSync, accessSync }`) for tests.
   * `downloaded` is the updater's active binary path, or null.
   * @returns {{ ok, path, source, reason, rejected }} `source` override|downloaded|bundled|path|well-known;
   *   `rejected` = candidates that exist but were refused, so "not installed" and "installed but Dopl won't
   *   run it" read differently.
   */
  function resolveWith({ env, home, io, uid, execPath, platform, arch, resolvePackage, downloaded }) {
    const rejected = [];
    const consider = (file, source) => {
      const verdict = inspectCandidate(file, io, uid);
      if (verdict.ok) {
        const vendor = launcherVendor(verdict.path, { platform, arch, resolvePackage });
        const direct = vendor ? inspectCandidate(vendor, io, uid) : null;
        const found = direct && direct.ok ? direct.path : verdict.path;
        return { ok: true, path: found, source, reason: '', rejected };
      }
      if (!verdict.missing) rejected.push({ path: file, reason: verdict.reason });
      return null;
    };

    const override = String((env && env[OVERRIDE_ENV]) || '').trim();
    if (override) {
      // A failing override is an error, never a fallback: the operator named this file.
      const verdict = inspectCandidate(override, io, uid);
      if (verdict.ok) return { ok: true, path: verdict.path, source: 'override', reason: '', rejected };
      return {
        ok: false,
        path: null,
        source: 'override',
        reason: `\`${OVERRIDE_ENV}\` is set to \`${override}\`, which is ${verdict.reason}.`,
        rejected,
      };
    }

    // A refused download or bundle lands in `rejected` and the search continues.
    if (downloaded) {
      const hit = consider(downloaded, 'downloaded');
      if (hit) return hit;
    }
    const bundled = bundledCandidate({ platform, arch, resolvePackage });
    if (bundled) {
      const hit = consider(bundled, 'bundled');
      if (hit) return hit;
    }

    const entries = String((env && env.PATH) || '').split(':').filter(Boolean);
    for (const dir of entries) {
      const hit = consider(path.join(expandHome(dir, home), BIN), 'path');
      if (hit) return hit;
    }

    for (const dir of WELL_KNOWN.concat(nodeNeighbours(execPath))) {
      const expanded = expandHome(dir, home);
      // Skip what PATH already covered: the same file refused twice reads as two problems.
      if (entries.includes(expanded) || entries.includes(dir)) continue;
      const hit = consider(path.join(expanded, BIN), 'well-known');
      if (hit) return hit;
    }

    return {
      ok: false,
      path: null,
      source: null,
      reason: rejected.length
        ? `A \`${BIN}\` was found but Dopl will not run it — ${rejected[0].reason}. Move it to a directory only you can write to, or set \`${OVERRIDE_ENV}\`.`
        // No bundle on a `bundled` build means a broken build (platform package or unpacked half missing).
        : `\`${BIN}\` is not installed where Dopl can find it, and this build carries no bundled copy. Install the ${label} CLI and re-open Dopl, or reinstall Dopl.`,
      rejected,
    };
  }

  // Only a HIT is cached; a miss re-walks, so a binary installed while Dopl runs is found next probe.
  let cached = null;

  /** The resolved binary for this process (`resolveWith` shape). */
  function resolve() {
    if (cached) return cached;
    const found = resolveWith({
      env: process.env,
      home: os.homedir(),
      io: { realpathSync: fs.realpathSync, statSync: fs.statSync, accessSync: fs.accessSync },
      uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      resolvePackage: cfg.resolvePackage,
      downloaded: cfg.downloaded(),
    });
    if (found.ok) cached = found;
    return found;
  }

  /** Drop the cache (tests, explicit re-probe). */
  function forget() {
    cached = null;
  }

  return { resolveWith, resolve, forget };
}

module.exports = {
  makeResolver, inspectCandidate, writableByOthers, expandHome, nodeNeighbours, WELL_KNOWN,
};
