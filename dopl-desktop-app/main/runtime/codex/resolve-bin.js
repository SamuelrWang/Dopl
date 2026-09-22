// WHERE `codex` IS ON THIS MACHINE — the ONE answer the probe, the credential check, the model
// roster and the session spawn all ask for.
//
// 🔒 ⚠ **A FINDER-LAUNCHED APP HAS NEARLY NO `PATH`, AND THAT IS THE WHOLE REASON THIS FILE
// EXISTS** (U2, `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`). macOS gives a GUI
// app `launchd`'s environment — roughly `/usr/bin:/bin:/usr/sbin:/sbin` — and NOT the `PATH` the
// operator's shell builds from `.zshrc`. Every install location Codex actually lands in
// (`/opt/homebrew/bin`, a Volta/bun/npm prefix under `$HOME`) is therefore invisible to
// `spawn('codex')` unless Dopl looks for it, so a machine with a working `codex` in Terminal
// reports "not on this Mac's PATH" the moment Dopl is opened from the Dock. `delivery: 'path'`
// (`packaging.js`) made the operator's install the supply chain; it did not make the operator's
// SHELL the way to find it.
//
// ⚠ **IT RESOLVES, IT DOES NOT EXEC.** Nothing here spawns `codex` — `client.js` is still the only
// module that touches a child process. This answers "which file", and every caller asks it.
//
// 🔒 ⚠ **A FILE NAMED `codex` IS NOT A REASON TO RUN IT.** A candidate is accepted only when it is
// a regular file the current user may execute AND neither it nor any directory that resolves its
// candidate or canonical path is group/world-writable. A safe-looking symlink into a writable tree
// is still a code-execution hole, because anything that can replace the target chooses what Dopl
// runs. Rejections are reported with the reason, never silently skipped, so an operator whose
// install sits in a writable prefix is told why it was refused instead of being told Codex is
// missing.
//
// ⚠ **SOURCE IS PART OF THE ANSWER.** Diagnostics have to be able to say WHICH file was resolved
// and HOW it was found (`override` / `path` / `well-known`), because "two operators, two Codex
// versions" is the cost `packaging.js` accepted and a version report that cannot name its binary
// cannot settle a support question. ⚠ The path is a filesystem path, never an auth material —
// `credential.js` still owns sign-in state and nothing here reads a token.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BIN = 'codex';

// ⚠ THE OPERATOR'S OWN ANSWER, AND IT OUTRANKS EVERY SEARCH. A machine with two installs, or one
// in a prefix this file does not know, needs a way to say which — and a support conversation needs
// a lever that does not require a new release. It is still validated like any other candidate.
const OVERRIDE_ENV = 'DOPL_CODEX_BIN';

// ⚠ SEARCHED IN ORDER, AND THE ORDER IS "MOST DELIBERATE FIRST". `$HOME`-relative entries are
// expanded per call rather than at require time, because the tests drive a fake home.
// ⚠ NOT A PROMISE THAT ANY OF THESE EXIST — it is where the four macOS installers put a CLI:
// Homebrew (arm64 then Intel), a user-level prefix, then the three JS toolchain prefixes.
const WELL_KNOWN = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '~/.local/bin',
  '~/.bun/bin',
  '~/.volta/bin',
  '~/.npm-global/bin',
];

// ─── BEGIN CODEX-RESOLVE-PURE (no electron, no spawn; unit-tested directly) ───

/** `~/x` → `<home>/x`. Anything else is returned untouched. */
function expandHome(entry, home) {
  if (entry === '~') return home;
  if (entry.startsWith('~/')) return path.join(home, entry.slice(2));
  return entry;
}

/**
 * Is this path a file Dopl may execute, and is the place it sits in trustworthy?
 *
 * Returns `{ ok: true, path }` or `{ ok: false, reason }` — the reason is for an operator.
 *
 * ⚠ **BOTH PATHS AND EVERY ANCESTOR ARE CHECKED.** `stat` follows symlinks. Checking only the
 * candidate's immediate directory therefore accepts `/safe/bin/codex -> /shared/codex`, where an
 * attacker can replace the target from `/shared`. Return the canonical path too, so the later
 * `spawn` executes the file whose full chain was inspected rather than resolving the symlink again.
 */
function inspectCandidate(file, io) {
  let resolved;
  try {
    resolved = io.realpathSync(file);
  } catch (_) {
    return { ok: false, reason: 'not found' };
  }
  let st;
  try {
    st = io.statSync(resolved);
  } catch (_) {
    return { ok: false, reason: 'not found' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not a regular file' };
  try {
    io.accessSync(resolved, fs.constants.X_OK);
  } catch (_) {
    return { ok: false, reason: 'not executable by this user' };
  }
  // ⚠ `0o022` — group-write OR other-write, on the file or any directory that selects it.
  if ((st.mode & 0o022) !== 0) {
    return { ok: false, reason: 'refused: the file is group- or world-writable' };
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
      if ((dirStat.mode & 0o022) !== 0) {
        return `refused: its ${label} ${immediate ? 'directory' : 'ancestor'} \`${dir}\` is group- or world-writable`;
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

/**
 * THE SEARCH, as a pure function of an environment and a filesystem.
 *
 * `io` — `{ realpathSync, statSync, accessSync }`, so a test drives a fake tree without touching
 * this machine's.
 *
 * Returns `{ ok, path, source, reason, rejected }`:
 *   `source`   `override` | `path` | `well-known` — how it was found, for diagnostics.
 *   `rejected` every candidate that EXISTED and was refused, with its reason. ⚠ It is the
 *              difference between "you have no Codex" and "you have one Dopl will not run", and an
 *              operator who cannot tell those apart reinstalls the wrong thing.
 */
function resolveWith({ env, home, io }) {
  const rejected = [];
  const consider = (file, source) => {
    const verdict = inspectCandidate(file, io);
    if (verdict.ok) return { ok: true, path: verdict.path, source, reason: '', rejected };
    if (verdict.reason !== 'not found') rejected.push({ path: file, reason: verdict.reason });
    return null;
  };

  const override = String((env && env[OVERRIDE_ENV]) || '').trim();
  if (override) {
    // ⚠ AN OVERRIDE THAT DOES NOT RESOLVE IS AN ERROR, NOT A FALLBACK. The operator named a file;
    // quietly running a different one is how a support session measures the wrong binary.
    const verdict = inspectCandidate(override, io);
    if (verdict.ok) return { ok: true, path: verdict.path, source: 'override', reason: '', rejected };
    return {
      ok: false,
      path: null,
      source: 'override',
      reason: `\`${OVERRIDE_ENV}\` is set to \`${override}\`, which is ${verdict.reason}.`,
      rejected,
    };
  }

  const entries = String((env && env.PATH) || '').split(':').filter(Boolean);
  for (const dir of entries) {
    const hit = consider(path.join(expandHome(dir, home), BIN), 'path');
    if (hit) return hit;
  }

  for (const dir of WELL_KNOWN) {
    const expanded = expandHome(dir, home);
    // ⚠ Skip what `PATH` already covered — the same file refused twice reads as two problems.
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
      : `\`${BIN}\` is not installed where Dopl can find it. Install the Codex CLI and re-open Dopl — this release does not bundle it.`,
    rejected,
  };
}

// ─── END CODEX-RESOLVE-PURE ───

// ⚠ CACHED FOR THE PROCESS, AND `forget()` IS THE ONLY WAY BACK. Four callers ask this on every
// probe, roster read and spawn; re-walking the filesystem each time buys nothing, and a Codex
// installed WHILE Dopl runs is what "re-open Dopl" in the refusal already tells the operator to do.
// ⚠ A FAILURE IS CACHED TOO: the miss is the expensive one (it walks the whole list), and a machine
// with no Codex must not pay for it on every render of the runtime picker.
let cached = null;

/** The resolved binary for this process. See `resolveWith` for the shape. */
function resolveCodexBin() {
  if (cached) return cached;
  cached = resolveWith({
    env: process.env,
    home: os.homedir(),
    io: { realpathSync: fs.realpathSync, statSync: fs.statSync, accessSync: fs.accessSync },
  });
  return cached;
}

/** Drop the cache. ⚠ For tests and for an explicit operator-driven re-probe, nothing else. */
function forget() {
  cached = null;
}

/**
 * The bare name, for the one case that still wants it: an error message. ⚠ NEVER pass this to
 * `spawn` — that is the bug this module exists to fix.
 */
const BIN_NAME = BIN;

module.exports = {
  resolveCodexBin,
  resolveWith,
  forget,
  BIN_NAME,
  OVERRIDE_ENV,
  WELL_KNOWN,
};
