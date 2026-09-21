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
/** A GUI launch's PATH, verbatim — the whole point of the module. */
const FINDER_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SHELL_PATH = `/opt/homebrew/bin:${FINDER_PATH}`;

/**
 * A fake tree. `files` maps an absolute path to `{ mode, dir }`:
 *   `mode`  the file's own mode bits (0o755 = safe, 0o777 = world-writable).
 *   `dir`   its directory's mode bits (default 0o755).
 * Anything not named does not exist.
 */
function fakeIo(files) {
  const dirs = new Map();
  for (const [file, spec] of Object.entries(files)) {
    dirs.set(file.slice(0, file.lastIndexOf("/")), (spec && spec.dir) ?? 0o755);
  }
  return {
    statSync(p) {
      if (Object.prototype.hasOwnProperty.call(files, p)) {
        const spec = files[p];
        return { isFile: () => true, mode: (spec && spec.mode) ?? 0o755 };
      }
      if (dirs.has(p)) return { isFile: () => false, mode: dirs.get(p) };
      const err = new Error(`ENOENT: ${p}`);
      err.code = "ENOENT";
      throw err;
    },
    accessSync(p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const err = new Error(`ENOENT: ${p}`);
        err.code = "ENOENT";
        throw err;
      }
      if (files[p] && files[p].noExec) {
        const err = new Error(`EACCES: ${p}`);
        err.code = "EACCES";
        throw err;
      }
    },
  };
}

const run = (env, files) => resolver.resolveWith({ env, home: HOME, io: fakeIo(files) });

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
  assert.match(loose.reason, /group- or world-writable/);
  assert.equal(loose.rejected.length, 1);
  assert.equal(loose.rejected[0].path, "/tmp/bin/codex");

  // The file is fine but its DIRECTORY is writable — replacing it is one `mv` away.
  const looseDir = run({ PATH: "/tmp/bin" }, { "/tmp/bin/codex": { dir: 0o777 } });
  assert.equal(looseDir.ok, false);
  assert.match(looseDir.reason, /directory/);
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
