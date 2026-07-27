// Tests for the Round C per-channel working-directory resolution (channel-dirs.js).
// The spawn cwd rule is the correctness-critical bit: a stored folder that STILL
// EXISTS becomes the cwd; an unset/blank/deleted one falls back to the sandbox. If
// that ever inverts, a deleted project folder would either crash the spawn or (far
// worse) never fall back, so this is fenced as a pure helper and pinned here.
//
// Run: `node --test dopl-desktop-app/test/channel-dirs.test.mjs`
//
// WHY SOURCE EXTRACTION: channel-dirs.js is CommonJS and pulls in electron
// (dialog/BrowserWindow) + electron-store, so it cannot be imported under
// `node --test`. The resolution + display helpers are deliberately fenced by
// BEGIN/END sentinel comments as PURE functions (existence is INJECTED, no
// electron/fs/store refs), so this test slices the fenced block and evaluates it
// verbatim — the test stays honest to what ships.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "channel-dirs.js"), "utf8");

const BEGIN = "// ─── BEGIN CHANNEL-DIR-RESOLVE";
const END = "// ─── END CHANNEL-DIR-RESOLVE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN CHANNEL-DIR-RESOLVE sentinel missing");
assert.notEqual(to, -1, "END CHANNEL-DIR-RESOLVE sentinel missing");
assert.ok(to > from, "channel-dir sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { resolveSpawnDir, abbreviateHome } = new Function(
  `${BLOCK}\n return { resolveSpawnDir, abbreviateHome };`
)();

const SANDBOX = "/Users/me/Library/Application Support/Dopl/channel-sessions/abc";
const CUSTOM = "/Users/me/Downloads/project";

// ── resolveSpawnDir: stored+exists → that dir; missing/deleted → sandbox ──────

test("stored dir that still exists -> that dir (usingCustom)", () => {
  const r = resolveSpawnDir(CUSTOM, SANDBOX, (p) => p === CUSTOM);
  assert.equal(r.dir, CUSTOM);
  assert.equal(r.usingCustom, true);
});

test("stored dir that was deleted -> sandbox fallback", () => {
  const r = resolveSpawnDir(CUSTOM, SANDBOX, () => false);
  assert.equal(r.dir, SANDBOX);
  assert.equal(r.usingCustom, false);
});

test("no stored dir (unset/blank) -> sandbox fallback", () => {
  for (const v of [null, undefined, "", "   ", 0, {}]) {
    const r = resolveSpawnDir(v, SANDBOX, () => true);
    assert.equal(r.dir, SANDBOX, `fallback for ${JSON.stringify(v)}`);
    assert.equal(r.usingCustom, false);
  }
});

test("a blank stored dir never probes existence (short-circuits)", () => {
  let probed = false;
  const r = resolveSpawnDir("   ", SANDBOX, () => {
    probed = true;
    return true;
  });
  assert.equal(probed, false, "blank stored dir must not reach the existence probe");
  assert.equal(r.dir, SANDBOX);
});

test("the existence probe is what gates a non-blank stored dir", () => {
  const seen = [];
  resolveSpawnDir(CUSTOM, SANDBOX, (p) => {
    seen.push(p);
    return true;
  });
  assert.deepEqual(seen, [CUSTOM], "the raw stored path is probed exactly once");
});

// ── abbreviateHome: $HOME -> ~ for display only ──────────────────────────────

test("abbreviateHome collapses $HOME to ~ (display only)", () => {
  const home = "/Users/me";
  assert.equal(abbreviateHome("/Users/me/Downloads", home), "~/Downloads");
  assert.equal(abbreviateHome("/Users/me", home), "~"); // home itself
  assert.equal(abbreviateHome("/opt/homebrew", home), "/opt/homebrew"); // outside home untouched
});

test("abbreviateHome respects the path boundary (no sibling false-match)", () => {
  // /Users/menace must NOT be abbreviated against home /Users/me.
  assert.equal(abbreviateHome("/Users/menace/x", "/Users/me"), "/Users/menace/x");
});

test("abbreviateHome is safe with no home / nullish path", () => {
  assert.equal(abbreviateHome("/x", ""), "/x");
  assert.equal(abbreviateHome(null, "/Users/me"), "");
});
