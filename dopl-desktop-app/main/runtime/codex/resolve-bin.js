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
// candidate or canonical path is writable BY OTHER USERS. A safe-looking symlink into a writable
// tree is still a code-execution hole, because anything that can replace the target chooses what
// Dopl runs. Rejections are reported with the reason, never silently skipped, so an operator whose
// install sits in a writable prefix is told why it was refused instead of being told Codex is
// missing.
// ⚠ **"BY OTHER USERS" IS NOT `& 0o022` — see `writableByOthers`.** Homebrew's own directories are
// group-writable by design, so the flat reading refused `brew install codex` AND
// `npm i -g @openai/codex` on this very machine (measured 2026-09-22) and reported them as NOT
// INSTALLED. World-writable is always refused; group-writable is refused only when the owner is
// neither this user nor root.
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
// ⚠ NOT A PROMISE THAT ANY OF THESE EXIST — it is where the macOS installers put a CLI: Homebrew
// (arm64 then Intel), a user-level prefix, then the JS toolchain prefixes.
// ⚠ **AND IT IS NOT SUFFICIENT ON ITS OWN**: `npm i -g` lands beside the RUNNING NODE, which is a
// version-carrying path no constant can name — `nodeNeighbours` below supplies it.
const WELL_KNOWN = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '~/.local/bin',
  '~/.bun/bin',
  '~/.volta/bin',
  '~/.npm-global/bin',
];

/**
 * ⚠ **`npm i -g` DOES NOT INSTALL INTO ANY OF THE ABOVE, AND THAT IS HOW THE FIRST REAL INSTALL
 * WENT MISSING** (measured 2026-09-22). With Homebrew's node, `npm prefix -g` is the KEG —
 * `/opt/homebrew/Cellar/node/<version>/bin` — a path that carries the node version in it and so
 * cannot be a constant. `/opt/homebrew/bin` holds symlinks for FORMULA binaries, and an
 * `npm i -g` package is not one, so nothing there points at it either.
 *
 * ⚠ **DERIVED FROM THE RUNNING NODE, NEVER SHELLED OUT FOR.** `process.execPath` is this process's
 * own interpreter; its `bin` directory is the same one `npm -g` writes to for that install, and
 * reading it costs nothing. Running `npm prefix -g` here would mean spawning a process inside the
 * module whose whole contract is that it resolves without executing anything.
 */
function nodeNeighbours(execPath) {
  const out = [];
  const bin = execPath ? path.dirname(execPath) : '';
  if (!bin) return out;
  out.push(bin);
  // Homebrew keg layout: `<keg>/bin/node` beside `<keg>/lib/node_modules/.bin`.
  out.push(path.join(path.dirname(bin), 'lib', 'node_modules', '.bin'));
  return out;
}

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
/**
 * 🔒 **WHO CAN REWRITE THIS, OTHER THAN ME?** — the question the mode bits are asked, and the one
 * a bare `& 0o022` gets wrong on macOS.
 *
 * ⚠ **MEASURED 2026-09-22, AND IT REFUSED THE TWO COMMONEST INSTALLS.** Homebrew ships
 * `/opt/homebrew` as `drwxrwxr-x samuelwang:admin` — GROUP-WRITABLE BY DESIGN, so that an admin
 * can `brew install` without `sudo`. A flat group-write refusal therefore rejected
 * `/opt/homebrew/bin/codex` AND the npm-global prefix under `/opt/homebrew/Cellar`, i.e. `brew
 * install codex` and `npm i -g @openai/codex` both, telling the operator Codex was not installed
 * while it sat on their PATH. A security check that no real install can pass is not a security
 * check; it is an outage.
 *
 * THE RULE, and the threat model behind it:
 *   - **WORLD-WRITABLE IS ALWAYS REFUSED.** Any local account could swap the binary. No exceptions,
 *     sticky bit included — `/tmp` is exactly the case this exists for.
 *   - **GROUP-WRITABLE IS REFUSED ONLY WHEN THE OWNER IS SOMEONE ELSE.** If the thing is owned by
 *     ME, group-write grants nobody a power I do not already have: I can rewrite my own files, and
 *     an attacker running as me has already won. If it is owned by ROOT, group-write is the
 *     platform's own arrangement (`admin`), which is the posture the operator's package manager
 *     chose. If it is owned by a THIRD party, group-write is a real hole and is refused.
 *
 * ⚠ **THIS IS A DELIBERATE NARROWING OF THE 2026-09-22 HARDENING, NOT A REVERT OF IT.** The
 * symlink-and-ancestor walk it added stays exactly as it was — that caught a real hole (a safe
 * name pointing into a writable tree). What changed is the PREDICATE at each step.
 *
 * `uid` absent (a platform with no `getuid`) falls back to the strict `& 0o022`: unknown identity
 * is not a reason to widen.
 */
function writableByOthers(stat, uid) {
  if (!stat) return true;
  if ((stat.mode & 0o002) !== 0) return true; // world-writable, always
  if ((stat.mode & 0o020) === 0) return false; // not group-writable, nothing more to ask
  if (typeof uid !== 'number') return true; // unknown identity → the strict reading
  return !(stat.uid === uid || stat.uid === 0); // group-writable is fine only if mine or root's
}

function inspectCandidate(file, io, uid) {
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
function resolveWith({ env, home, io, uid, execPath }) {
  const rejected = [];
  const consider = (file, source) => {
    const verdict = inspectCandidate(file, io, uid);
    if (verdict.ok) return { ok: true, path: verdict.path, source, reason: '', rejected };
    if (verdict.reason !== 'not found') rejected.push({ path: file, reason: verdict.reason });
    return null;
  };

  const override = String((env && env[OVERRIDE_ENV]) || '').trim();
  if (override) {
    // ⚠ AN OVERRIDE THAT DOES NOT RESOLVE IS AN ERROR, NOT A FALLBACK. The operator named a file;
    // quietly running a different one is how a support session measures the wrong binary.
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

  const entries = String((env && env.PATH) || '').split(':').filter(Boolean);
  for (const dir of entries) {
    const hit = consider(path.join(expandHome(dir, home), BIN), 'path');
    if (hit) return hit;
  }

  for (const dir of WELL_KNOWN.concat(nodeNeighbours(execPath))) {
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
    uid: typeof process.getuid === 'function' ? process.getuid() : undefined,
    execPath: process.execPath,
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
  writableByOthers,
  nodeNeighbours,
  forget,
  BIN_NAME,
  OVERRIDE_ENV,
  WELL_KNOWN,
};
