// WHERE `codex` IS FOUND, AND WHAT DOPL REFUSES TO RUN — `main/runtime/codex/resolve-bin.js`.
//
// ⚠ THE SUBJECT IS THE SEARCH, NOT THE PROCESS. Nothing here spawns anything: `resolveWith` is a
// pure function of an environment and a filesystem, so every case below drives a FAKE tree. The
// one case that cannot be faked — that a real Finder launch has a short PATH — is what the module
// exists for and is named in its header.
//
// 🔒 THE CASE THAT BOUGHT THE FILE (U2, `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`):
// a GUI app inherits `launchd`'s `/usr/bin:/bin:/usr/sbin:/sbin`, so a Homebrew `codex` that works
// in Terminal is invisible to `spawn('codex')` and the operator is told Codex is not installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const resolver = require(join(HERE, "..", "main", "runtime", "codex", "resolve-bin.js"));

const HOME = "/Users/tester";
/** This test process's pretend uid, and a stranger's. */
const ME = 501;
const SOMEONE_ELSE = 502;
/** A GUI launch's PATH, verbatim — the whole point of the module. */
const FINDER_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SHELL_PATH = `/opt/homebrew/bin:${FINDER_PATH}`;

/**
 * A fake tree. `files` maps an absolute path to `{ mode, dir, real, targetDir }`:
 *   `mode`      the resolved file's own mode bits (0o755 = safe, 0o777 = world-writable).
 *   `dir`       the candidate's immediate directory mode (default 0o755).
 *   `real`      the canonical target when the candidate is a symlink.
 *   `targetDir` the canonical target's immediate directory mode (default 0o755).
 * `directoryModes` overrides any directory or ancestor mode.
 * Anything not named does not exist.
 */
function fakeIo(files, directoryModes = {}) {
  const dirs = new Map();
  const fileRecords = new Map();
  const addAncestors = (file) => {
    let dir = dirname(file);
    while (!dirs.has(dir)) {
      dirs.set(dir, 0o755);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  };
  for (const [file, spec] of Object.entries(files)) {
    const record = spec || {};
    const real = record.real || file;
    fileRecords.set(file, record);
    fileRecords.set(real, record);
    addAncestors(file);
    addAncestors(real);
    dirs.set(dirname(file), record.dir ?? 0o755);
    if (real !== file) dirs.set(dirname(real), record.targetDir ?? 0o755);
  }
  for (const [dir, mode] of Object.entries(directoryModes)) dirs.set(dir, mode);
  return {
    realpathSync(p) {
      const spec = fileRecords.get(p);
      if (spec) return spec.real || p;
      const err = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
    statSync(p) {
      if (fileRecords.has(p)) {
        const spec = fileRecords.get(p);
        return { isFile: () => true, mode: (spec && spec.mode) ?? 0o755, uid: (spec && spec.uid) ?? ME };
      }
      if (dirs.has(p)) {
        const entry = dirs.get(p);
        return typeof entry === 'object'
          ? { isFile: () => false, mode: entry.mode, uid: entry.uid ?? ME }
          : { isFile: () => false, mode: entry, uid: ME };
      }
      const err = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
    accessSync(p) {
      if (!fileRecords.has(p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      if (fileRecords.get(p) && fileRecords.get(p).noExec) {
        const err = new Error(`EACCES: ${p}`);
        err.code = "EACCES";
        throw err;
      }
    },
  };
}

const run = (env, files, directoryModes, opts = {}) => resolver.resolveWith({
  env,
  home: HOME,
  io: fakeIo(files, directoryModes),
  // ⚠ `in`, not `=== undefined`: the strict-reading case passes uid EXPLICITLY undefined, and a
  // default that swallowed it would assert the opposite of what it says.
  uid: "uid" in opts ? opts.uid : ME,
  execPath: opts.execPath,
  // ⚠ OMITTED BY DEFAULT, WHICH IS WHAT KEEPS THE PRE-BUNDLE CASES MEANING WHAT THEY MEANT. With
  // no `resolvePackage` the bundled candidate is `null` and the search starts at PATH, exactly as
  // it did under `delivery: 'path'` — the cases below that DO exercise the bundle pass all three.
  platform: opts.platform,
  arch: opts.arch,
  resolvePackage: opts.resolvePackage,
});

test("finds a Homebrew codex a Finder launch's PATH cannot see", () => {
  const files = { "/opt/homebrew/bin/codex": {} };
  // The bug, stated as a test: on the shell's PATH it is found by PATH…
  const shell = run({ PATH: SHELL_PATH }, files);
  assert.equal(shell.ok, true);
  assert.equal(shell.path, "/opt/homebrew/bin/codex");
  assert.equal(shell.source, "path");
  // …and under Finder's PATH it is STILL found, by the well-known list. Before this module that
  // second case was `spawn('codex')` → ENOENT → "not on this Mac's PATH".
  const finder = run({ PATH: FINDER_PATH }, files);
  assert.equal(finder.ok, true);
  assert.equal(finder.path, "/opt/homebrew/bin/codex");
  assert.equal(finder.source, "well-known");
});

test("searches the well-known prefixes under a real home", () => {
  for (const dir of ["/usr/local/bin", `${HOME}/.local/bin`, `${HOME}/.bun/bin`, `${HOME}/.volta/bin`, `${HOME}/.npm-global/bin`]) {
    const found = run({ PATH: FINDER_PATH }, { [`${dir}/codex`]: {} });
    assert.equal(found.ok, true, `${dir} should be searched`);
    assert.equal(found.path, `${dir}/codex`);
  }
});

test("PATH outranks the well-known list, and the list is not re-walked for it", () => {
  const found = run(
    { PATH: `${HOME}/.local/bin:${FINDER_PATH}` },
    { [`${HOME}/.local/bin/codex`]: {}, "/opt/homebrew/bin/codex": {} }
  );
  assert.equal(found.path, `${HOME}/.local/bin/codex`);
  assert.equal(found.source, "path");
});

test("the override outranks everything and never silently falls back", () => {
  const files = { "/custom/codex": {}, "/opt/homebrew/bin/codex": {} };
  const picked = run({ PATH: SHELL_PATH, [resolver.OVERRIDE_ENV]: "/custom/codex" }, files);
  assert.equal(picked.path, "/custom/codex");
  assert.equal(picked.source, "override");

  // 🔒 A NAMED FILE THAT IS NOT THERE IS AN ERROR. Running the Homebrew one instead would measure
  // a different binary than the operator named, which is how a support session reads the wrong
  // version out of a diagnostic.
  const missing = run({ PATH: SHELL_PATH, [resolver.OVERRIDE_ENV]: "/custom/gone" }, files);
  assert.equal(missing.ok, false);
  assert.equal(missing.path, null);
  assert.match(missing.reason, /not found/);
});

test("refuses a codex anyone can rewrite, and says which", () => {
  // The file itself is world-writable.
  const loose = run({ PATH: "/tmp/bin" }, { "/tmp/bin/codex": { mode: 0o777 } });
  assert.equal(loose.ok, false);
  assert.match(loose.reason, /writable by other users/);
  assert.equal(loose.rejected.length, 1);
  assert.equal(loose.rejected[0].path, "/tmp/bin/codex");

  // The file is fine but its DIRECTORY is writable — replacing it is one `mv` away.
  const looseDir = run({ PATH: "/tmp/bin" }, { "/tmp/bin/codex": { dir: 0o777 } });
  assert.equal(looseDir.ok, false);
  assert.match(looseDir.reason, /directory/);
});

test("resolves a safe symlink to the canonical executable", () => {
  const found = run(
    { PATH: "/opt/homebrew/bin" },
    { "/opt/homebrew/bin/codex": { real: "/opt/homebrew/Cellar/codex/1.0/bin/codex" } }
  );
  assert.equal(found.ok, true);
  assert.equal(found.path, "/opt/homebrew/Cellar/codex/1.0/bin/codex");
});

test("refuses a symlink whose canonical target directory is writable", () => {
  const found = run(
    { PATH: "/opt/homebrew/bin" },
    {
      "/opt/homebrew/bin/codex": {
        real: "/shared/tools/codex",
        targetDir: 0o777,
      },
    }
  );
  assert.equal(found.ok, false);
  assert.match(found.reason, /resolved target directory.*writable by other users/);
});

test("refuses a canonical target beneath a writable ancestor", () => {
  const found = run(
    { PATH: "/opt/homebrew/bin" },
    { "/opt/homebrew/bin/codex": { real: "/shared/releases/codex/1.0/bin/codex" } },
    { "/shared/releases": 0o777 }
  );
  assert.equal(found.ok, false);
  assert.match(found.reason, /ancestor.*writable by other users/);
});

test("a refused install does not read as a missing one", () => {
  const refused = run({ PATH: "/tmp/bin" }, { "/tmp/bin/codex": { mode: 0o777 } });
  const absent = run({ PATH: FINDER_PATH }, {});
  // ⚠ THE TWO REFUSALS MUST DIFFER: "install it" is the wrong instruction for a machine that has
  // one, and re-installing into the same writable prefix reproduces the refusal exactly.
  assert.notEqual(refused.reason, absent.reason);
  assert.match(absent.reason, /not installed where Dopl can find it/);
  assert.equal(absent.rejected.length, 0);
});

test("skips a non-executable and keeps looking", () => {
  const found = run(
    { PATH: `/usr/bin:${"/opt/homebrew/bin"}` },
    { "/usr/bin/codex": { noExec: true }, "/opt/homebrew/bin/codex": {} }
  );
  assert.equal(found.ok, true);
  assert.equal(found.path, "/opt/homebrew/bin/codex");
  assert.equal(found.rejected[0].reason, "not executable by this user");
});

test("the process-wide answer is cached until it is forgotten", () => {
  const first = resolver.resolveCodexBin();
  assert.equal(resolver.resolveCodexBin(), first, "same object, not a second filesystem walk");
  resolver.forget();
  assert.notEqual(resolver.resolveCodexBin(), first, "forget() re-asks");
  // ⚠ NO ASSERTION ON `ok` — this runs on a real machine, which may or may not have a Codex. The
  // shape is what is pinned; the answer is the machine's.
  assert.equal(typeof resolver.resolveCodexBin().ok, "boolean");
  resolver.forget();
});

test("no caller spawns the bare name any more", () => {
  const read = (rel) => require("node:fs").readFileSync(join(HERE, "..", "main", "runtime", "codex", rel), "utf8");
  // ⚠ BIDIRECTIONAL-ISH: the point is not that the string is absent (it is the module's own name)
  // but that no `spawn`/`execFile` CALL takes it. These three were the call sites.
  const client = read("client.js");
  assert.ok(!/spawn\(BIN\b/.test(client), "client.js must spawn the resolved path");
  assert.ok(!/execFile\(BIN\b/.test(client), "client.js must probe the resolved path");
  assert.ok(!/execFile\('codex'/.test(read("credential.js")), "credential.js must exec the resolved path");
  for (const file of ["client.js", "credential.js"]) {
    assert.match(read(file), /resolve-bin/, `${file} must ask the resolver`);
  }
});

// ─── THE TWO REAL INSTALLS THAT WERE REFUSED (measured 2026-09-22) ────────────────────────────
//
// 🔒 Both of these are REGRESSION tests for a refusal that shipped, not hypotheticals. `codex-cli
// 0.155.1` was installed on this machine and the resolver answered "not installed where Dopl can
// find it" — twice, for two different reasons.

test("accepts a Homebrew install, whose directories are group-writable BY DESIGN", () => {
  // `/opt/homebrew` is `drwxrwxr-x <me>:admin` on every Homebrew Mac — that is how `brew install`
  // works without `sudo`. The flat `& 0o022` reading refused it outright.
  const brewDirs = { "/opt/homebrew": 0o775, "/opt/homebrew/bin": 0o775 };
  const found = run({ PATH: "/opt/homebrew/bin" }, { "/opt/homebrew/bin/codex": {} }, brewDirs);
  assert.equal(found.ok, true, found.reason);
  assert.equal(found.path, "/opt/homebrew/bin/codex");
});

test("still refuses the same layout when the owner is someone else", () => {
  // ⚠ THE NARROWING IS ABOUT OWNERSHIP, NOT ABOUT GIVING UP. Group-writable and owned by a THIRD
  // party is the actual hole: another account can swap the binary.
  const theirs = { "/opt/homebrew": { mode: 0o775, uid: SOMEONE_ELSE }, "/opt/homebrew/bin": { mode: 0o775, uid: SOMEONE_ELSE } };
  const found = run({ PATH: "/opt/homebrew/bin" }, { "/opt/homebrew/bin/codex": {} }, theirs);
  assert.equal(found.ok, false);
  assert.match(found.reason, /writable by other users/);
});

test("world-writable is refused no matter who owns it", () => {
  // /tmp is the case: world-writable and owned by root. Ownership never excuses `o+w`.
  for (const uid of [ME, 0, SOMEONE_ELSE]) {
    const found = run({ PATH: "/tmp/bin" }, { "/tmp/bin/codex": {} }, { "/tmp/bin": { mode: 0o777, uid } });
    assert.equal(found.ok, false, `uid ${uid} must not excuse world-write`);
    assert.match(found.reason, /writable by other users/);
  }
});

test("an unknown uid keeps the strict reading — unknown is not a reason to widen", () => {
  const found = run(
    { PATH: "/opt/homebrew/bin" },
    { "/opt/homebrew/bin/codex": {} },
    { "/opt/homebrew": 0o775, "/opt/homebrew/bin": 0o775 },
    { uid: undefined }
  );
  assert.equal(found.ok, false, "no uid → group-write is refused as before");
});

test("finds an `npm i -g` install beside the running node", () => {
  // 🔒 THE SECOND REFUSAL: `npm prefix -g` under Homebrew's node is the KEG —
  // `/opt/homebrew/Cellar/node/<version>/bin` — which carries a version and so cannot be a
  // constant, and `/opt/homebrew/bin` holds no symlink for a non-formula package. WELL_KNOWN could
  // not name it; `nodeNeighbours(process.execPath)` derives it.
  const keg = "/opt/homebrew/Cellar/node/24.7.0";
  const found = run(
    { PATH: FINDER_PATH },
    { [`${keg}/bin/codex`]: {} },
    { "/opt/homebrew/Cellar": 0o775, "/opt/homebrew": 0o775 },
    { execPath: `${keg}/bin/node` }
  );
  assert.equal(found.ok, true, found.reason);
  assert.equal(found.path, `${keg}/bin/codex`);
  assert.equal(found.source, "well-known");
});

test("nodeNeighbours derives the bin dir and the keg's .bin, and nothing from an empty path", () => {
  const dirs = resolver.nodeNeighbours("/opt/homebrew/Cellar/node/24.7.0/bin/node");
  assert.deepEqual(dirs, [
    "/opt/homebrew/Cellar/node/24.7.0/bin",
    "/opt/homebrew/Cellar/node/24.7.0/lib/node_modules/.bin",
  ]);
  assert.deepEqual(resolver.nodeNeighbours(""), []);
  assert.deepEqual(resolver.nodeNeighbours(undefined), []);
});

test("THIS machine's own Codex resolves — the end-to-end case the unit fakes stand in for", () => {
  // ⚠ CONDITIONAL ON A REAL INSTALL, and it says so rather than passing quietly: the suite runs on
  // machines with no Codex. When one IS present it must RESOLVE — that is the whole bug.
  resolver.forget();
  const real = resolver.resolveCodexBin();
  resolver.forget();
  if (!real.ok && real.rejected.length === 0) {
    console.log("      ℹ no codex on this machine — the live half of this case did not run");
    return;
  }
  assert.equal(real.ok, true, `a codex exists here and was refused: ${real.reason}`);
  assert.ok(real.path && real.path.startsWith("/"), "an absolute path");
});

// ─── THE BUNDLED BINARY (Samuel's ruling, 2026-09-22) ─────────────────────────────────────────
//
// 🔒 `delivery` moved from `path` to `bundled` (`main/runtime/codex/packaging.js`). These cases
// pin the ORDER — the one thing a reader cannot infer from the descriptor — and the DERIVATION of
// the bundled path, which differs between a dev checkout and a packaged app and must never be a
// constant.

/** A dev checkout's `require.resolve` answer: an ordinary `node_modules` path, no asar segment. */
const DEV_PKG_JSON = "/repo/dopl-desktop-app/node_modules/@openai/codex-darwin-arm64/package.json";
const DEV_BIN = "/repo/dopl-desktop-app/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex";
/** A packaged app's: `require.resolve` reports the IN-ASAR path even for an `asarUnpack`ed file. */
const ASAR_PKG_JSON = "/Applications/Dopl.app/Contents/Resources/app.asar/node_modules/@openai/codex-darwin-arm64/package.json";
const ASAR_BIN = "/Applications/Dopl.app/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex";

const resolveTo = (answer) => () => answer;
const resolveMissing = () => {
  throw Object.assign(new Error("MODULE_NOT_FOUND"), { code: "MODULE_NOT_FOUND" });
};
/** `run` plus the three inputs the bundled candidate is derived from. */
const runBundled = (env, files, directoryModes, opts = {}) => run(env, files, directoryModes, {
  platform: "darwin",
  arch: "arm64",
  resolvePackage: resolveTo(DEV_PKG_JSON),
  ...opts,
});

test("the bundled path is DERIVED, and dev and packaged derive differently", () => {
  // ⚠ THE WHOLE CASE FOR DERIVING IT. `asarUnpack` puts the real bytes beside `app.asar` under
  // `app.asar.unpacked`, but `require.resolve` still reports the IN-ASAR path — a hardcoded
  // constant would be right in exactly one of these two trees.
  const dev = resolver.bundledCandidate({ platform: "darwin", arch: "arm64", resolvePackage: resolveTo(DEV_PKG_JSON) });
  assert.equal(dev, DEV_BIN, "a dev tree has no `app.asar` segment and is left untouched");
  const packaged = resolver.bundledCandidate({ platform: "darwin", arch: "arm64", resolvePackage: resolveTo(ASAR_PKG_JSON) });
  assert.equal(packaged, ASAR_BIN, "a packaged app resolves to the unpacked twin");

  // ⚠ AND THE REWRITE IS NOT REPEATABLE-UNSAFE: an already-unpacked path must be left alone, or a
  // second pass yields `app.asar.unpacked.unpacked`.
  assert.equal(resolver.rewriteAsarUnpacked(ASAR_BIN), ASAR_BIN);
});

test("a platform with no vendor triple, and an absent package, both answer null rather than guessing", () => {
  // ⚠ `null` IS A NORMAL ANSWER. The platform package is an OPTIONAL dependency gated on
  // `os`/`cpu`, so it is absent by design everywhere but the build host — the caller falls through
  // to PATH, which is why PATH was kept.
  assert.equal(resolver.bundledCandidate({ platform: "linux", arch: "x64", resolvePackage: resolveTo(DEV_PKG_JSON) }), null);
  assert.equal(resolver.bundledCandidate({ platform: "darwin", arch: "arm64", resolvePackage: resolveMissing }), null);
  assert.equal(resolver.bundledCandidate({ platform: "darwin", arch: "arm64", resolvePackage: undefined }), null);
  // Only the two macOS triples are carried — Samuel's macOS-only ruling, not an oversight.
  assert.deepEqual(Object.keys(resolver.VENDOR_TRIPLE).sort(), ["darwin-arm64", "darwin-x64"]);
});

test("the bundled binary OUTRANKS a codex on PATH — the point of pinning a version", () => {
  // If a stray PATH install won, `packaging.versionPin` would be a false claim on every machine
  // that happens to have one, and the skew `bundled` was chosen to end would survive the choice.
  const found = runBundled(
    { PATH: SHELL_PATH },
    { [DEV_BIN]: {}, "/opt/homebrew/bin/codex": {} }
  );
  assert.equal(found.ok, true, found.reason);
  assert.equal(found.path, DEV_BIN);
  assert.equal(found.source, "bundled");
});

test("the OVERRIDE still outranks the bundle — an operator naming a file gets that file", () => {
  const files = { [DEV_BIN]: {}, "/custom/codex": {} };
  const picked = runBundled({ PATH: SHELL_PATH, [resolver.OVERRIDE_ENV]: "/custom/codex" }, files);
  assert.equal(picked.path, "/custom/codex");
  assert.equal(picked.source, "override");

  // 🔒 AND IT STILL REFUSES RATHER THAN FALLING BACK TO THE BUNDLE. Quietly running the shipped
  // binary when the operator named another is how a support session measures the wrong thing —
  // the failure mode bundling makes MORE likely, not less, because there is now always one to
  // fall back to.
  const missing = runBundled({ PATH: SHELL_PATH, [resolver.OVERRIDE_ENV]: "/custom/gone" }, files);
  assert.equal(missing.ok, false);
  assert.equal(missing.source, "override");
  assert.match(missing.reason, /not found/);
});

test("no bundle in this build falls through to PATH, and says so when nothing is there", () => {
  const found = run(
    { PATH: SHELL_PATH },
    { "/opt/homebrew/bin/codex": {} },
    {},
    { platform: "darwin", arch: "arm64", resolvePackage: resolveMissing }
  );
  assert.equal(found.path, "/opt/homebrew/bin/codex");
  assert.equal(found.source, "path");

  const absent = run({ PATH: FINDER_PATH }, {}, {}, { platform: "darwin", arch: "arm64", resolvePackage: resolveMissing });
  assert.equal(absent.ok, false);
  // ⚠ THE OLD SENTENCE SAID "this release does not bundle it" AND IS NOW FALSE. Reaching here on a
  // bundled delivery means the BUILD is missing its binary, which is news in its own right.
  assert.match(absent.reason, /no bundled copy/);
  assert.doesNotMatch(absent.reason, /does not bundle/);
});

test("the bundled binary is NOT trusted for being ours — the writability walk still applies", () => {
  // 🔒 An app bundle an attacker can rewrite is an attacker's binary whoever built it. And a
  // REFUSED bundle must not end the search: a good codex on PATH is still a better answer than
  // none, and the refusal is still reported.
  const found = runBundled(
    { PATH: SHELL_PATH },
    { [DEV_BIN]: { dir: 0o777 }, "/opt/homebrew/bin/codex": {} }
  );
  assert.equal(found.ok, true, found.reason);
  assert.equal(found.source, "path", "a refused bundle falls through rather than stranding the operator");
  assert.equal(found.rejected.length, 1);
  assert.equal(found.rejected[0].path, DEV_BIN);
  assert.match(found.rejected[0].reason, /writable by other users/);
});

test("THIS checkout's bundled codex is the one that resolves", () => {
  // ⚠ THE END-TO-END CASE, and it is unconditional BECAUSE the dependency is now in
  // `package.json › dependencies` — on darwin-arm64 a checkout that installed cannot lack it.
  // Anywhere else it is skipped loudly rather than asserted away.
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    console.log("      ℹ not darwin-arm64 — the bundled half of this case did not run");
    return;
  }
  resolver.forget();
  const real = resolver.resolveCodexBin();
  resolver.forget();
  assert.equal(real.ok, true, real.reason);
  assert.equal(real.source, "bundled", `resolved ${real.path} instead of the shipped binary`);
  assert.match(real.path, /@openai\/codex-darwin-arm64\/vendor\/aarch64-apple-darwin\/bin\/codex$/);
});
