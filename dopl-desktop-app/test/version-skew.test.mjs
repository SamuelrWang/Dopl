// Q10 — peer version skew: reading a stale build off a peer's message.
//
// THE INCIDENT (2026-07-31). electron-updater downloads in the background and
// installs ON QUIT, and a background listener app is quit approximately never.
// A peer Mac sat on 1.7.14 for a whole evening after 1.7.15 shipped, so the
// released fix looked broken from this side — it was simply not running. Nothing
// in either app said so, and it cost a full debugging round.
//
// THE SHAPE OF THE FIX. app-version.js puts this build on every desktop request
// as `X-Dopl-App-Version`; the server stamps it onto the message as the RESERVED
// `metadata.appVersion` (header-only, caller copies stripped — see
// src/shared/auth/app-version-header.ts). This module reads that stamp off a
// PEER's message and reports it once.
//
// WHAT MUST NOT HAPPEN, and is pinned here: it must never nag (one line per peer
// build, per process), never speak about a peer we cannot compare (unstamped or
// unparseable → silence), never speak about a NEWER peer (that is this machine's
// problem, and the updater already owns that affordance), and never be able to
// break message dispatch (it is a diagnostic; it swallows its own errors).
//
// METHOD: the repo's source-extraction idiom. version-skew.js requires electron,
// so both sentinel blocks are sliced and evaluated with fakes standing in for the
// electron-bound bits (Notification, diag, the name cache, the version).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SRC = M("version-skew.js");

function block(begin, end) {
  const a = SRC.indexOf(begin);
  const b = SRC.indexOf(end);
  assert.notEqual(a, -1, `sentinel ${begin} missing from version-skew.js`);
  assert.ok(b > a, `sentinel ${end} missing after ${begin}`);
  return SRC.slice(a, b);
}
const PURE = block("// ─── BEGIN VERSION-SKEW-PURE", "// ─── END VERSION-SKEW-PURE");
const OBSERVE = block("// ─── BEGIN VERSION-SKEW-OBSERVE", "// ─── END VERSION-SKEW-OBSERVE");

// The pure half on its own — no fakes needed, no state.
const pure = new Function(
  `${PURE}\nreturn { BEHAVIOR_FLOOR, parseVersion, compareVersions, skewNotice, skewLine };`
)();

// The whole module, with every electron-bound free var faked. `metaStr` is the
// REAL one (targeting.js is dependency-free), so the metadata read is honest.
const TARGETING = M("targeting.js");
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(start, i);
}
const METASTR = extractFn(TARGETING, "metaStr");

function build(myVersion = "1.7.15") {
  const calls = { diag: [], notify: [], skew: [] };
  const Notification = class {
    constructor(opts) { this.opts = opts; }
    static isSupported() { return true; }
    show() { calls.notify.push(this.opts); }
  };
  const mod = new Function(
    "appVersion", "io", "Notification", "diag",
    `${METASTR}\n${PURE}\n${OBSERVE}\n` +
      `return { observe, setHandlers, skewNotice, compareVersions, BEHAVIOR_FLOOR };`
  )(
    { appVersion: () => myVersion },
    { displayNameFor: (id) => (id === "peer-1" ? "Sam" : "") },
    Notification,
    (...a) => calls.diag.push(a.join(" "))
  );
  mod.setHandlers({ onSkew: (s) => calls.skew.push(s) });
  return { mod, calls };
}

const ME = "me-1";
const entry = { channel: { id: "chan-abc-12345678", name: "General" } };
const from = (author, version) => ({
  kind: "message",
  seq: 7,
  authorUserId: author,
  authorKind: "agent",
  metadata: version === undefined ? {} : { appVersion: version },
});

// ── parsing + ordering ───────────────────────────────────────────────────────

test("parseVersion takes a release triple and ignores a pre-release tag", () => {
  assert.deepEqual(pure.parseVersion("1.7.15"), [1, 7, 15]);
  // 1.8.0-beta.2 and 1.8.0 speak the same contract, so the tag is not ordered on.
  assert.deepEqual(pure.parseVersion("1.8.0-beta.2"), [1, 8, 0]);
  for (const bad of ["", "v1.7.15", "1.7", "1.7.15.1", "latest", null, undefined, {}, 1.7]) {
    assert.equal(pure.parseVersion(bad), null, `parsed ${JSON.stringify(bad)}`);
  }
});

test("compareVersions orders component-wise, and answers null for the unknown", () => {
  assert.equal(pure.compareVersions("1.7.14", "1.7.15"), -1);
  assert.equal(pure.compareVersions("1.7.15", "1.7.15"), 0);
  assert.equal(pure.compareVersions("1.7.16", "1.7.15"), 1);
  assert.equal(pure.compareVersions("1.8.0", "1.7.99"), 1, "minor beats patch");
  assert.equal(pure.compareVersions("2.0.0", "1.99.99"), 1, "major beats minor");
  assert.equal(pure.compareVersions("1.7.9", "1.7.10"), -1, "numeric, not lexical");
  // Null is NOT an ordering — every caller reads it as "say nothing".
  assert.equal(pure.compareVersions("nope", "1.7.15"), null);
  assert.equal(pure.compareVersions("1.7.15", ""), null);
});

// ── the verdict, both ways ───────────────────────────────────────────────────

test("an OLDER peer is a notice; SAME and NEWER are silence", () => {
  const older = pure.skewNotice("1.7.14", "1.7.15", "1.7.15");
  assert.equal(older.peer, "1.7.14");
  assert.equal(older.mine, "1.7.15");
  assert.equal(older.explains, true, "below the floor, so it explains a behavior gap");
  assert.equal(pure.skewNotice("1.7.15", "1.7.15", "1.7.15"), null, "same build");
  // A NEWER peer is deliberately silent: it is THIS machine that would need the
  // update, and the updater already owns that affordance (tray restart item).
  assert.equal(pure.skewNotice("1.7.16", "1.7.15", "1.7.15"), null, "newer peer");
});

test("older but ABOVE the floor is a log line only, not a human surface", () => {
  // The floor is what makes this non-nagging: age alone predicts nothing about
  // behavior, so only a peer that predates the current cross-machine contract
  // gets `explains` (and therefore a banner).
  const n = pure.skewNotice("1.8.0", "1.9.2", "1.7.15");
  assert.equal(n.explains, false);
  assert.equal(pure.skewNotice("1.7.14", "1.9.2", "1.7.15").explains, true);
});

test("an unknown version on EITHER side says nothing at all", () => {
  assert.equal(pure.skewNotice(undefined, "1.7.15", "1.7.15"), null);
  assert.equal(pure.skewNotice("", "1.7.15", "1.7.15"), null);
  assert.equal(pure.skewNotice("stale", "1.7.15", "1.7.15"), null);
  // …including when THIS build cannot name itself (a non-Electron context).
  assert.equal(pure.skewNotice("1.7.14", "", "1.7.15"), null);
});

test("the line names both builds and the one action that fixes it", () => {
  const line = pure.skewLine({ peer: "1.7.14", mine: "1.7.15" }, "Sam");
  assert.match(line, /Sam/);
  assert.match(line, /1\.7\.14/);
  assert.match(line, /1\.7\.15/);
  assert.match(line, /restart/i, "the update is already downloaded; only a restart applies it");
  assert.match(pure.skewLine({ peer: "1.7.14", mine: "1.7.15" }, ""), /The other side/);
});

// ── observing a real message ─────────────────────────────────────────────────

test("an older peer's message emits ONE diag and ONE quiet surface", () => {
  const { mod, calls } = build("1.7.15");
  const n = mod.observe(entry, from("peer-1", "1.7.14"), ME);

  assert.equal(n.peer, "1.7.14");
  assert.equal(calls.diag.length, 1);
  assert.match(calls.diag[0], /version skew/);
  assert.match(calls.diag[0], /1\.7\.14/);
  // Quiet: a SILENT banner, never a dialog. One line, no decision to make.
  assert.equal(calls.notify.length, 1);
  assert.equal(calls.notify[0].silent, true);
  assert.equal(calls.skew.length, 1);
  assert.equal(calls.skew[0].who, "Sam");
  assert.equal(calls.skew[0].mine, "1.7.15");
});

test("NOT A NAG: the same peer build is reported once, however many messages", () => {
  const { mod, calls } = build("1.7.15");
  for (let i = 0; i < 25; i++) mod.observe(entry, from("peer-1", "1.7.14"), ME);
  assert.equal(calls.diag.length, 1);
  assert.equal(calls.notify.length, 1);
  // A DIFFERENT build from the same peer is news again (they restarted into
  // something still stale), and so is the same build from a different peer.
  mod.observe(entry, from("peer-1", "1.7.13"), ME);
  mod.observe(entry, from("peer-2", "1.7.14"), ME);
  assert.equal(calls.diag.length, 3);
});

test("same / newer peers are silent all the way through observe", () => {
  const { mod, calls } = build("1.7.15");
  assert.equal(mod.observe(entry, from("peer-1", "1.7.15"), ME), null);
  assert.equal(mod.observe(entry, from("peer-2", "1.9.0"), ME), null);
  assert.equal(calls.diag.length, 0);
  assert.equal(calls.notify.length, 0);
  assert.equal(calls.skew.length, 0);
});

test("an older-but-compatible peer logs and does NOT surface", () => {
  const { mod, calls } = build("1.9.2"); // floor is 1.7.15
  const n = mod.observe(entry, from("peer-1", "1.8.0"), ME);
  assert.equal(n.explains, false);
  assert.equal(calls.diag.length, 1, "the log always gets it");
  assert.equal(calls.notify.length, 0, "the human does not");
  assert.equal(calls.skew.length, 0);
});

test("nothing to compare, nothing said: unstamped, self-authored, or identity-less", () => {
  const { mod, calls } = build("1.7.15");
  assert.equal(mod.observe(entry, from("peer-1", undefined), ME), null, "the web / an external agent");
  assert.equal(mod.observe(entry, from("peer-1", "nonsense"), ME), null);
  assert.equal(mod.observe(entry, from(ME, "1.7.14"), ME), null, "my own build is not skew");
  assert.equal(mod.observe(entry, from("peer-1", "1.7.14"), null), null, "identity unresolved");
  assert.equal(mod.observe(entry, null, ME), null);
  assert.equal(calls.diag.length, 0);
});

test("a diagnostic can never break dispatch: a throwing surface is swallowed", () => {
  const { mod, calls } = build("1.7.15");
  mod.setHandlers({ onSkew: () => { throw new Error("tray is gone"); } });
  assert.doesNotThrow(() => mod.observe(entry, from("peer-1", "1.7.14"), ME));
  assert.ok(calls.diag.some((l) => /tray handler failed/.test(l)));
});

test("the de-dupe memory is BOUNDED (F-072: nothing here grows without limit)", () => {
  const { mod, calls } = build("1.7.15");
  for (let i = 0; i < 250; i++) mod.observe(entry, from(`peer-${i}`, "1.7.14"), ME);
  // 250 distinct peers all reported; the cap clears rather than accumulates, and
  // the only cost of a clear is one repeated line.
  assert.equal(calls.diag.length, 250);
  assert.match(SRC, /const SEEN_CAP = \d+;/);
  assert.match(SRC, /if \(seen\.size >= SEEN_CAP\) seen\.clear\(\);/);
});

// ── the wiring, statically ───────────────────────────────────────────────────

test("the tray is the surface, and index.js is what connects it", () => {
  const INDEX = M("index.js");
  assert.match(INDEX, /versionSkew\.setHandlers\(\{ onSkew: \(skew\) => tray\.setPeerSkew\(skew\) \}\)/);
  const TRAY = M("tray.js");
  assert.match(TRAY, /function setPeerSkew\(skew\)/);
});

test("the floor is a named constant with a stated meaning, not a literal in a branch", () => {
  assert.equal(pure.BEHAVIOR_FLOOR, "1.7.15");
  assert.match(SRC, /const BEHAVIOR_FLOOR = '1\.7\.15';/);
  // It is compared, never trusted for anything else — no gate reads it.
  assert.equal(SRC.includes("BEHAVIOR_FLOOR)"), true);
});
