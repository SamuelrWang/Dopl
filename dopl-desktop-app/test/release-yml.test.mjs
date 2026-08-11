// F-193 — the two pure decisions inside `scripts/release.sh`.
//
// The release wrapper is mostly orchestration (curl, gh, notarytool) and cannot
// be unit-tested without a network and a 200 MB DMG. Two pieces of it CAN be,
// and they are precisely the two that failed in production:
//
//   1. The latest-mac.yml re-hash. Stapling rewrites the DMG AFTER the feed is
//      generated, so the feed's DMG sha512/size describe bytes that no longer
//      exist — both shipped releases carried a lying feed. The patch must touch
//      the DMG entry and NOTHING ELSE: the zip entry and the top-level
//      `path`/`sha512` are what electron-updater actually installs from, and
//      moving either of them turns a cosmetic inaccuracy into a broken update.
//      So these tests assert byte-identity of the untouched regions, not just
//      "the dmg hash changed".
//
//   2. The post-upload asset assertion. `electron-builder --publish always`
//      reported success on both partial uploads. The only defense is re-reading
//      the release and refusing to proceed on a missing — or half-landed —
//      asset.
//
// The fixture is the REAL 1.10.1 feed, verbatim, because the shape (two entries
// in `files:`, then three top-level keys, one of which is another `sha512:`) is
// the whole reason the patcher is line-ranged rather than a YAML round-trip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { patchDmgEntry, assertAssets, fileEntries } = require("../scripts/release-yml.js");

const FIXTURE = `version: 1.10.1
files:
  - url: Dopl-1.10.1-arm64-mac.zip
    sha512: cKub0RBFGUmex0O5JnWf1JG2fV4EhtSKJVYbDpL0Bm8+Mid5vNhbangHG83MhXQuZfCAaaa0RI6y7HHLqOGhMg==
    size: 204164124
  - url: Dopl-1.10.1-arm64.dmg
    sha512: PRESTAPLEhashPRESTAPLEhashPRESTAPLEhashPRESTAPLEhashPRESTAPLEhashPRESTAPLEhashPRESTAPL==
    size: 204000000
path: Dopl-1.10.1-arm64-mac.zip
sha512: cKub0RBFGUmex0O5JnWf1JG2fV4EhtSKJVYbDpL0Bm8+Mid5vNhbangHG83MhXQuZfCAaaa0RI6y7HHLqOGhMg==
releaseDate: '2026-08-11T03:43:54.752Z'
`;

const STAPLED = {
  url: "Dopl-1.10.1-arm64.dmg",
  sha512: "kt6l4PbUfc8e7+dL9hOAi3+3jRBCGXyHOv5qt7qTk6hLiUeledYm6iv8NdOqWfHDIuljYSoF/ew9SpnwVdSvUA==",
  size: 204362311,
};

const ZIP_BLOCK = `  - url: Dopl-1.10.1-arm64-mac.zip
    sha512: cKub0RBFGUmex0O5JnWf1JG2fV4EhtSKJVYbDpL0Bm8+Mid5vNhbangHG83MhXQuZfCAaaa0RI6y7HHLqOGhMg==
    size: 204164124`;

// ── The re-hash ──────────────────────────────────────────────────────────────

test("the DMG entry is patched with the post-staple sha512 and size", () => {
  const { text, changed } = patchDmgEntry(FIXTURE, STAPLED);
  assert.equal(changed, true);
  assert.match(text, /- url: Dopl-1\.10\.1-arm64\.dmg\n {4}sha512: kt6l4PbU/);
  assert.match(text, /- url: Dopl-1\.10\.1-arm64\.dmg\n {4}sha512: \S+\n {4}size: 204362311\n/);
  assert.doesNotMatch(text, /PRESTAPLE/);
});

test("the zip entry comes out BYTE-IDENTICAL", () => {
  // The updater installs from the zip. If this block ever moves, an update
  // stops verifying and every desktop silently stays on the old build.
  const { text } = patchDmgEntry(FIXTURE, STAPLED);
  assert.ok(text.includes(ZIP_BLOCK), "zip entry was rewritten");
});

test("exactly two lines change — nothing else in the file moves", () => {
  const { text } = patchDmgEntry(FIXTURE, STAPLED);
  const before = FIXTURE.split("\n");
  const after = text.split("\n");
  assert.equal(after.length, before.length);
  const moved = before.map((l, i) => (l === after[i] ? null : i)).filter((i) => i !== null);
  // 0-indexed: the DMG entry's `sha512:` and `size:` lines, and only those.
  assert.deepEqual(moved, [6, 7], "only the DMG entry's sha512 and size lines may change");
});

test("the top-level path/sha512 (the ZIP's, not the DMG's) is left alone", () => {
  // Both `sha512:` keys are legal YAML at different depths; a naive
  // find-and-replace on the DMG hash would clobber the wrong one.
  const { text } = patchDmgEntry(FIXTURE, STAPLED);
  assert.ok(text.includes("\npath: Dopl-1.10.1-arm64-mac.zip\nsha512: cKub0RBFGUmex0O5"));
  assert.ok(text.endsWith("releaseDate: '2026-08-11T03:43:54.752Z'\n"));
});

test("patching an already-correct feed reports changed:false and returns it verbatim", () => {
  // The --skip-build repair path re-runs this step over a feed a previous run
  // already fixed; a second pass must be a no-op, not a second edit.
  const once = patchDmgEntry(FIXTURE, STAPLED);
  const twice = patchDmgEntry(once.text, STAPLED);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test("a feed with no DMG entry is an ERROR, not a silent skip", () => {
  const zipOnly = FIXTURE.split("\n")
    .filter((l) => !/dmg|PRESTAPLE|204000000/.test(l))
    .join("\n");
  assert.throws(() => patchDmgEntry(zipOnly, STAPLED), /has NO \.dmg entry/);
});

test("a DMG name that disagrees with the feed is an ERROR (mismatched build)", () => {
  assert.throws(
    () => patchDmgEntry(FIXTURE, { ...STAPLED, url: "Dopl-1.10.2-arm64.dmg" }),
    /from different builds/
  );
});

test("a DMG entry missing its size line is an ERROR", () => {
  const noSize = FIXTURE.replace("    size: 204000000\n", "");
  assert.throws(() => patchDmgEntry(noSize, STAPLED), /missing size/);
});

test("two DMG entries are an ERROR — the patcher rewrites exactly one", () => {
  const two = FIXTURE.replace(
    "path: Dopl",
    "  - url: Dopl-1.10.1-x64.dmg\n    sha512: xx==\n    size: 5\npath: Dopl"
  );
  assert.throws(() => patchDmgEntry(two, STAPLED), /has 2 \.dmg entries/);
});

test("garbage in is refused before anything is written", () => {
  assert.throws(() => patchDmgEntry(FIXTURE, { ...STAPLED, size: 0 }), /positive integer/);
  assert.throws(() => patchDmgEntry(FIXTURE, { ...STAPLED, sha512: "" }), /base64 digest/);
  assert.throws(() => patchDmgEntry(FIXTURE, { ...STAPLED, url: "x.zip" }), /must name a \.dmg/);
  assert.throws(() => patchDmgEntry("nothing: here\n", STAPLED), /no `files:` block/);
});

test("fileEntries stops at the first top-level key", () => {
  const entries = fileEntries(FIXTURE.split("\n"));
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.url),
    ["Dopl-1.10.1-arm64-mac.zip", "Dopl-1.10.1-arm64.dmg"]
  );
});

// ── The asset-list assertion ─────────────────────────────────────────────────

const FIVE = [
  "Dopl-1.10.1-arm64-mac.zip",
  "Dopl-1.10.1-arm64-mac.zip.blockmap",
  "Dopl-1.10.1-arm64.dmg",
  "Dopl-1.10.1-arm64.dmg.blockmap",
  "latest-mac.yml",
];
const ghAssets = (names) => ({
  assets: names.map((name) => ({ name, size: 1234, state: "uploaded" })),
});
// `assert.throws` does not hand back the error, and these tests care about what
// the message SAYS — the message is the whole remedy an operator gets at 3am.
const caught = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new assert.AssertionError({ message: "expected a throw, got none" });
};

test("all five present and uploaded passes", () => {
  const res = assertAssets(ghAssets(FIVE), FIVE);
  assert.equal(res.ok, true);
  assert.deepEqual(res.extra, []);
});

test("the 1.10.0 failure — DMG missing — is caught and named", () => {
  const err = caught(() =>
    assertAssets(ghAssets(FIVE.filter((n) => n !== "Dopl-1.10.1-arm64.dmg")), FIVE)
  );
  assert.match(err.message, /MISSING 1 ASSET/);
  assert.match(err.message, /Dopl-1\.10\.1-arm64\.dmg/);
  assert.match(err.message, /present:/); // says what IS there, so the fix is obvious
  assert.match(err.message, /remedy:/);
});

test("the 1.10.1 failure — zip + feed missing — is caught and both are named", () => {
  const err = caught(() =>
    assertAssets(
      ghAssets(FIVE.filter((n) => n !== "latest-mac.yml" && n !== "Dopl-1.10.1-arm64-mac.zip")),
      FIVE
    )
  );
  assert.match(err.message, /MISSING 2 ASSET/);
  assert.match(err.message, /Dopl-1\.10\.1-arm64-mac\.zip/);
  assert.match(err.message, /latest-mac\.yml/);
});

test("an empty release is caught rather than read as 'nothing missing'", () => {
  assert.throws(() => assertAssets({ assets: [] }, FIVE), /MISSING 5 ASSET/);
});

test("an asset row that exists but never finished uploading is caught", () => {
  // `gh` lists the row the moment the upload starts; the URL 404s until state
  // flips to "uploaded". Present-but-unfinished reads as success to a name check.
  const half = ghAssets(FIVE);
  half.assets[2].state = "starter";
  assert.throws(() => assertAssets(half, FIVE), /PRESENT BUT NOT UPLOADED/);

  const zeroed = ghAssets(FIVE);
  zeroed.assets[4].size = 0;
  assert.throws(() => assertAssets(zeroed, FIVE), /PRESENT BUT NOT UPLOADED/);
});

test("extra assets are reported, not rejected", () => {
  const res = assertAssets(ghAssets([...FIVE, "SHA256SUMS.txt"]), FIVE);
  assert.deepEqual(res.extra, ["SHA256SUMS.txt"]);
});

test("a bare array works, and a non-list is refused", () => {
  assert.equal(assertAssets(ghAssets(FIVE).assets, FIVE).ok, true);
  assert.throws(() => assertAssets({}, FIVE), /expected `\{assets:\[\.\.\.\]\}`/);
  assert.throws(() => assertAssets(ghAssets(FIVE), []), /non-empty list/);
});
