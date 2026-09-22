// WHERE `codex` IS ON THIS MACHINE — the ONE answer the probe, the credential check, the model
// roster and the session spawn all ask for.
//
// ⚠ **THIS RELEASE BUNDLES ONE** (Samuel's ruling, 2026-09-22 — `packaging.js` holds the decision
// and what it cost). The header below was written while `delivery` was `path` and said a bundled
// binary "simply becomes the first thing `available()` finds". That is now TRUE, with one
// deliberate exception, and the order is stated here because it is a POLICY and not an
// implementation detail:
//
//   1. `DOPL_CODEX_BIN`  — THE OPERATOR'S OWN ANSWER, AND IT STILL OUTRANKS THE BUNDLE.
//      Bundling does not make the override less necessary; it makes it MORE. It is the only lever
//      that points a shipped build at a different CLI — a support session reproducing a skew, a
//      developer testing an unreleased Codex, an operator on a build whose platform package did
//      not install. An operator who names a file must get THAT file or an error, never a quiet
//      substitution, and that rule predates the ruling and survives it.
//   2. THE BUNDLED BINARY — the one this release PINNED, SIGNED and NOTARISED.
//      ⚠ **IT OUTRANKS `PATH`, AND THAT IS THE POINT OF BUNDLING.** If a stray `codex` on PATH
//      won, `packaging.versionPin` would be a false claim on every machine that happens to have
//      one, and "two operators, two Codex versions" — the cost `path` accepted — would survive the
//      decision taken to end it. A release that ships a protocol build must RUN that protocol
//      build by default.
//   3. `PATH`, then 4. the WELL-KNOWN prefixes — UNCHANGED, AND KEPT ON PURPOSE.
//      The bundled candidate can legitimately be absent: `@openai/codex-<platform>-<arch>` is an
//      OPTIONAL dependency gated on `os`/`cpu`, so a build produced where it did not install has
//      no bundle at all. Degrading to the v1 behaviour is strictly better than degrading to
//      nothing, and it costs one `require.resolve` that already failed.
//
// ⚠ **THE BUNDLED CANDIDATE IS NOT TRUSTED FOR BEING OURS.** It goes through `inspectCandidate`
// like every other — same executability, same writable-by-others walk over the file, its canonical
// target and every ancestor. An app bundle an attacker can rewrite is an attacker's binary no
// matter whose build produced it.
//
// 🔒 ⚠ **A FINDER-LAUNCHED APP HAS NEARLY NO `PATH`, AND THAT IS THE WHOLE REASON THIS FILE
// EXISTS** (U2, `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`). macOS gives a GUI
// app `launchd`'s environment — roughly `/usr/bin:/bin:/usr/sbin:/sbin` — and NOT the `PATH` the
// operator's shell builds from `.zshrc`. Every install location Codex actually lands in
// (`/opt/homebrew/bin`, a Volta/bun/npm prefix under `$HOME`) is therefore invisible to
// `spawn('codex')` unless Dopl looks for it, so a machine with a working `codex` in Terminal
// reports "not on this Mac's PATH" the moment Dopl is opened from the Dock. `delivery: 'path'`
// (`packaging.js`) made the operator's install the supply chain; it did not make the operator's
// SHELL the way to find it. ⚠ **AND THE BUNDLE DOES NOT RETIRE THIS FILE**: candidates 3 and 4 are
// still reached whenever the bundled candidate is absent or refused, on exactly the machines whose
// PATH is `launchd`'s.
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
// ⚠ **SOURCE IS PART OF THE ANSWER, AND IT MATTERS MORE NOW THAN IT DID.** Diagnostics have to be
// able to say WHICH file was resolved and HOW it was found (`override` / `bundled` / `path` /
// `well-known`). Under `delivery: 'path'` that was how a support session told two operators'
// Codexes apart; under `delivery: 'bundled'` it is how it tells THE SHIPPED ONE from a machine's
// own — the single fact that decides whether `packaging.versionPin` describes what actually ran.
// ⚠ The path is a filesystem path, never an auth material — `credential.js` still owns sign-in
// state and nothing here reads a token.

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

// ⚠ **THE VENDOR LAYOUT, MIRRORED FROM THE LAUNCHER WE DO NOT RUN.** `@openai/codex`'s own
// `bin/codex.js` maps `{platform, arch}` → a Rust target triple → `vendor/<triple>/bin/codex`, and
// Dopl reproduces that mapping rather than executing the launcher: the launcher is a Node process
// whose entire job is to `spawn` the same file, and `client.js` already owns the one child process
// this runtime is allowed. ⚠ **DARWIN ONLY, DELIBERATELY** (Samuel's macOS-only ruling): the four
// linux/win32 triples the launcher knows are omitted rather than carried as arms that can never be
// taken, and an unmapped platform answers `null` so the search falls through to `PATH`.
// ⚠ **`CODEX_MANAGED_PACKAGE_ROOT` IS NOT REPRODUCED AND MUST NOT BE.** The launcher sets it to
// advertise which package manager owns the install, so the CLI can offer to update itself. A
// bundled binary is updated by shipping a Dopl release; telling it otherwise would offer an
// operator an update that our own `versionPin` then contradicts.
const VENDOR_TRIPLE = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
};

// ⚠ THE PLATFORM PACKAGE IS AN ALIAS DIRECTORY, NOT A PACKAGE NAME. Every one of them declares
// `"name": "@openai/codex"` with the triple in its VERSION (`0.155.1-darwin-arm64`); npm installs
// them under the alias `@openai/codex-<platform>-<arch>`, which is what `require.resolve` walks and
// what `package.json › build.asarUnpack` globs. Resolving by the declared name would find the
// launcher instead.
const PLATFORM_PKG = (platform, arch) => `@openai/codex-${platform}-${arch}`;

/**
 * An in-asar path → its `app.asar.unpacked` twin. Pure string transform, no electron.
 *
 * ⚠ **THIS IS WHY THE BUNDLED PATH IS DERIVED AND NEVER HARDCODED.** `require.resolve` reports the
 * IN-ASAR path in a packaged app (`…/Dopl.app/Contents/Resources/app.asar/node_modules/@openai/…`)
 * even though `asarUnpack` put the real bytes beside it under `app.asar.unpacked`, and reports an
 * ordinary `node_modules` path in a dev tree, which has no `app.asar` segment at all. One
 * expression covers both, and a dev tree is left untouched because the regex matches nothing.
 * ⚠ VERBATIM the transform `../claude/loader.js › rewriteAsarUnpacked` has used since the desktop
 * shipped, negative lookahead included — an already-`.unpacked` path must be left alone, or a
 * second rewrite produces `app.asar.unpacked.unpacked`. It is copied rather than imported because
 * that module requires `electron` at load time and this one must stay spawn-free and electron-free.
 */
function rewriteAsarUnpacked(p) {
  if (typeof p !== 'string') return p;
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

/**
 * The bundled `codex` this release ships, or `null` when this build has none.
 *
 * `resolvePackage` — `require.resolve`, injected so a test can drive both a dev tree and a packaged
 * one without one existing on disk.
 *
 * ⚠ **`null` IS A NORMAL ANSWER, NOT A FAILURE.** `@openai/codex-<platform>-<arch>` is an OPTIONAL
 * dependency gated on `os`/`cpu`, so it is absent by design on every platform but the build host's.
 * The caller falls through to `PATH`; nothing is logged as an error.
 */
function bundledCandidate({ platform, arch, resolvePackage }) {
  const triple = VENDOR_TRIPLE[`${platform}-${arch}`];
  if (!triple || typeof resolvePackage !== 'function') return null;
  let pkgJson;
  try {
    pkgJson = resolvePackage(`${PLATFORM_PKG(platform, arch)}/package.json`);
  } catch (_) {
    return null;
  }
  if (typeof pkgJson !== 'string' || !pkgJson) return null;
  const root = path.dirname(rewriteAsarUnpacked(pkgJson));
  return path.join(root, 'vendor', triple, 'bin', BIN);
}

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
 *   `source`   `override` | `bundled` | `path` | `well-known` — how it was found, for diagnostics,
 *              and searched in that order. The argument for the order is in this file's header;
 *              it is a policy, so it is written down once and not re-litigated here.
 *   `rejected` every candidate that EXISTED and was refused, with its reason. ⚠ It is the
 *              difference between "you have no Codex" and "you have one Dopl will not run", and an
 *              operator who cannot tell those apart reinstalls the wrong thing.
 */
function resolveWith({ env, home, io, uid, execPath, platform, arch, resolvePackage }) {
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

  // ⚠ SECOND, AND ABOVE `PATH` — see the header. A bundled candidate that is REFUSED lands in
  // `rejected` like any other and the search continues: a tampered app bundle must not be the only
  // thing the operator is told about when a perfectly good `codex` sits on their PATH.
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
      // ⚠ **THE SECOND CLAUSE STOPPED BEING TRUE ON 2026-09-22 AND WAS REWRITTEN RATHER THAN
      // DROPPED.** It read "this release does not bundle it". This release DOES — so reaching here
      // means the bundled candidate was ABSENT, which on a `bundled` delivery is itself the news:
      // the build's optional platform package did not install, or the app bundle is missing its
      // unpacked half. Telling the operator only "install the CLI" would hide a broken build
      // behind a workaround that happens to work.
      : `\`${BIN}\` is not installed where Dopl can find it, and this build carries no bundled copy. Install the Codex CLI and re-open Dopl, or reinstall Dopl.`,
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
    platform: process.platform,
    arch: process.arch,
    // ⚠ THIS MODULE'S OWN `require.resolve`, not the caller's. Resolution is relative to the file
    // doing it, and `main/runtime/codex/` is inside the same package tree as the vendored binary
    // in both a dev checkout and a packaged app — which is exactly what makes the derivation work
    // without knowing which of the two it is standing in.
    resolvePackage: require.resolve,
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
  bundledCandidate,
  rewriteAsarUnpacked,
  forget,
  BIN_NAME,
  OVERRIDE_ENV,
  WELL_KNOWN,
  VENDOR_TRIPLE,
};
