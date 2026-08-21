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

// The sliced block must stay electron/fs/path/store-free (§H-7) — it is the fallback
// (defaultSessionDir) that lives OUTSIDE it and gets passed IN, never the other way.
// Scan CODE only (strip // comments — they legitimately say "electron-free").
const CODE = BLOCK.split("\n").map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); }).join("\n");
for (const banned of ["require(", "electron", "fs.", "os.", "child_process", "process."]) {
  assert.ok(!CODE.includes(banned), `CHANNEL-DIR-RESOLVE block must not reference ${banned}`);
}

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

// ── item 6/7: sessionSpawnDir + resolvedDirLabel (composition over the pure block) ──
// sessionSpawnDir(channelId) = resolveSpawnDir(stored, defaultSessionDir(), isDir).dir
// and resolvedDirLabel = abbreviateHome(that, home). The fs-backed defaultSessionDir /
// getChannelDir / isDir are the electron boundary (manually traced); here we pin the
// COMPOSITION — "stored-if-exists else ~/Downloads", then abbreviated — using the same
// pure primitives that ship, with ~/Downloads injected as the fallback.

const HOME = "/Users/me";
const DOWNLOADS = "/Users/me/Downloads"; // item 6 default (defaultSessionDir when it exists)
const CHANNEL_DIR = "/Users/me/Downloads/project";

// Mirror of sessionSpawnDir's delegation, with the fs bits injected.
const spawnDir = (stored, exists) => resolveSpawnDir(stored, DOWNLOADS, exists).dir;
const dirLabel = (stored, exists) => abbreviateHome(spawnDir(stored, exists), HOME);

test("sessionSpawnDir: a stored per-channel dir that still exists is the cwd", () => {
  assert.equal(spawnDir(CHANNEL_DIR, (p) => p === CHANNEL_DIR), CHANNEL_DIR);
});

test("sessionSpawnDir: unset OR deleted per-channel dir falls back to ~/Downloads", () => {
  assert.equal(spawnDir(null, () => true), DOWNLOADS, "unset -> Downloads default");
  assert.equal(spawnDir("", () => true), DOWNLOADS, "blank -> Downloads default");
  assert.equal(spawnDir(CHANNEL_DIR, () => false), DOWNLOADS, "deleted since chosen -> Downloads default");
});

test("resolvedDirLabel: abbreviates the resolved dir, never null", () => {
  assert.equal(dirLabel(null, () => true), "~/Downloads", "the default reads ~/Downloads");
  assert.equal(dirLabel(CHANNEL_DIR, (p) => p === CHANNEL_DIR), "~/Downloads/project", "a set per-channel dir shows abbreviated");
});

// ── THE DELETED-DIR SELF-HEAL, AND WHERE IT LIVES ────────────────────────────
// ⚠ IT MOVED ON 2026-08-20, AND IT WAS NOT RUNNING BEFORE THAT. The sweep — clear a stored
// dir the operator has since DELETED, so the tray stops offering a dead path — lived in
// `spawnDirFor`, the `claude -p` lane's cwd resolver. That lane was deleted on 2026-08-20
// (Samuel's ruling) and `spawnDirFor` lost its last caller with it, while `sessionSpawnDir`'s
// docblock still deferred to it in terms ("spawnDirFor still owns the deleted-dir sweep").
// So for that interval NOTHING swept and a stale entry lived forever.
//
// It is `sessionSpawnDir`'s now, because the read that resolves the cwd is exactly the moment
// the staleness is discovered. Asserted against the STORE side-effect rather than the return
// value: the returned dir was always correct (it fell back), and a test over the fallback
// alone is what let the missing sweep go unnoticed.

test("sessionSpawnDir CLEARS a stored dir that has been deleted since it was chosen", () => {
  const store = { [CHANNEL_DIR]: true };
  const cleared = [];
  // The composition as it ships, with the two fs-backed edges injected.
  const sessionSpawnDir = (channelId) => {
    const stored = store[channelId] ? CHANNEL_DIR : null;
    const { dir, usingCustom } = resolveSpawnDir(stored, DOWNLOADS, () => false); // the dir is gone
    if (stored && !usingCustom) cleared.push(channelId);
    return dir;
  };
  assert.equal(sessionSpawnDir(CHANNEL_DIR), DOWNLOADS, "the caller still gets a usable cwd");
  assert.deepEqual(cleared, [CHANNEL_DIR], "and the dead entry is dropped, not left to rot");
});

test("sessionSpawnDir clears NOTHING when the stored dir is still there, or when none is set", () => {
  const cleared = [];
  const run = (stored, exists) => {
    const { dir, usingCustom } = resolveSpawnDir(stored, DOWNLOADS, exists);
    if (stored && !usingCustom) cleared.push(stored);
    return dir;
  };
  assert.equal(run(CHANNEL_DIR, (p) => p === CHANNEL_DIR), CHANNEL_DIR);
  assert.equal(run(null, () => true), DOWNLOADS);
  assert.equal(run("", () => true), DOWNLOADS);
  assert.deepEqual(cleared, [], "a live dir and an unset one are both left alone");
});

test("the sweep really lives in sessionSpawnDir, and spawnDirFor is gone", () => {
  // Source-level, because the composition above is a mirror: if the mirror and the module ever
  // part company, these two assertions are what says so.
  const fn = SRC.slice(SRC.indexOf("function sessionSpawnDir("), SRC.indexOf("function resolvedDirLabel("));
  assert.match(fn, /clearChannelDir\(channelId\)/, "the self-heal is in the live read path");
  assert.equal(/function spawnDirFor\s*\(/.test(SRC), false,
    "the CLI lane's resolver is deleted — reviving it would be a second answer to one question");
});
