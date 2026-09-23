// THE SECOND INHERITANCE POINT (main/channel-seed-watch.js) — a channel this machine did NOT
// create in a renderer takes the operator's default agent settings, once.
//
// WHAT IT COSTS WHEN THIS IS WRONG. Samuel REVERSED a standing guardrail on 2026-09-22 (*"Agent
// created channels should inherit defaults"*; the reversal is the plan's Handoff item 3, which
// had recorded the non-inheritance as a RULING). The guardrail existed for a reason that did not
// go away: a defaults record that reaches a channel nobody is attending can widen what agents may
// do there, and `bypass` is one of the values it can carry. So the reversal had to keep three
// properties, and this file is where two of them are pinned:
//
//   · NOTHING IS READ AT A SPAWN. The seed is still a WRITE into the channel's own posture; the
//     defaults record is not wired into `session-engine.js`, `session-launch.js` or
//     `getLaunchPosture`'s fallback. The READER census lives in `session-posture-writers.test.mjs`
//     (it scans all of `main/`); what is pinned HERE is that this module cannot smuggle it in —
//     it never calls `getAgentDefaults`, and `channel-listener.js` is its only requirer.
//   · WRITE-ONCE SURVIVES. `seedChannel` refuses a channel that already has a posture, and it
//     refuses BEFORE it writes. That is a property of the function, not of who calls it, which is
//     exactly what lets a second caller be added at all.
//   · **A PRE-EXISTING CHANNEL IS NEVER SEEDED.** "Has no posture record yet" is TRUE of every
//     room an operator has never opened Settings for, so it is NOT the signal — using it would
//     stamp 50 existing rooms with the profile defaults on the next launch. The signal is a
//     per-machine first-seen WATERMARK in the SERVER'S clock, and the pass that learns it cannot
//     also act on it. Most of the cases below are about that boundary.
//
// WHY SOURCE EXTRACTION: the module pulls in electron-store, so it does not import under
// `node --test`. The decision half is fenced as a PURE block and sliced verbatim — the same
// pattern `agent-defaults.test.mjs` and `seed-decision.test.mjs` use.
//
// Run: `node --test dopl-desktop-app/test/channel-seed-watch.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sentinelBlock } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (p) => readFileSync(join(MAIN, p), "utf8");
const SRC = read("channel-seed-watch.js");

// Comments legitimately NAME what the module must not do, so every absence assertion below
// scans CODE only — the same `stripComments` the H2 suites share.
const stripComments = (src) => src.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
  .join("\n");

// ⚠ SLICED BY THE FENCE, NOT BY LINE NUMBERS — a comment added above the block must not move
// this suite onto a different program.
const block = sentinelBlock(SRC, "SEED-WATCH-DECIDE");
const { WATERMARK_V, stampMs, readWatermark, seenRows, decidePass } = new Function(
  `${block}\n return { WATERMARK_V, stampMs, readWatermark, seenRows, decidePass };`
)();

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "22222222-2222-4222-8222-222222222222";
const T = (iso) => Date.parse(iso);
const BOUND = { at: "2026-09-22T12:00:00.000Z", ms: T("2026-09-22T12:00:00.000Z") };

/** One row of the shape `GET /api/channels` answers with — a member room this account created. */
function ch(id, at, over = {}) {
  return { id, createdAt: at, createdBy: ME, isMember: true, ...over };
}
const pass = (over) => decidePass({
  channels: [], complete: true, selfUserId: ME, watermark: BOUND, nowMs: T("2026-09-22T13:00:00.000Z"),
  ...over,
});

// ── THE MIGRATION BOUNDARY — the crux ───────────────────────────────────────

test("the FIRST complete pass installs the boundary and seeds NOTHING", () => {
  // ⚠ THE 50-EXISTING-CHANNELS CASE, WHICH IS THE WHOLE REASON THE WATERMARK EXISTS. Every one
  // of these is unconfigured (no posture record), created by this account, and a member room —
  // i.e. it passes every gate EXCEPT the boundary. If the boundary were "has no posture yet",
  // all 50 would be stamped with the profile defaults the first time this build runs.
  const rooms = [];
  for (let i = 0; i < 50; i += 1) rooms.push(ch(`old-${i}`, `2026-0${1 + (i % 9)}-0${1 + (i % 9)}T09:00:00.000Z`));
  const res = decidePass({ channels: rooms, complete: true, selfUserId: ME, watermark: null, nowMs: 1 });
  assert.deepEqual(res.seed, [], "the pass that LEARNS the boundary cannot also act on it");
  assert.equal(res.install, T("2026-09-09T09:00:00.000Z"), "the boundary is the newest room it could see");
  assert.equal(res.advance, null, "an install is not also an advance");
  // …and on the NEXT pass, with that boundary stored, they are all below it and stay untouched.
  const next = decidePass({
    channels: rooms, complete: true, selfUserId: ME,
    watermark: { at: "2026-09-09T09:00:00.000Z", ms: T("2026-09-09T09:00:00.000Z") },
  });
  assert.deepEqual(next.seed, [], "a channel created BEFORE the watermark never inherits");
});

test("an INCOMPLETE pass can never become the boundary", () => {
  // A workspace that never answered is not a picture of the world: taking a boundary from it
  // would put every room in that workspace permanently below a line drawn without them.
  const res = decidePass({
    channels: [ch("a", "2026-05-05T00:00:00.000Z")], complete: false, selfUserId: ME,
    watermark: null, nowMs: 1,
  });
  assert.equal(res.install, null);
  assert.deepEqual(res.seed, [], "and with no boundary there is nothing to be newer than");
});

test("an install pass that saw NO channels falls to the local clock, and only then", () => {
  const res = decidePass({ channels: [], complete: true, selfUserId: ME, watermark: null, nowMs: 4242 });
  assert.equal(res.install, 4242, "there is no server value to take, and nothing pre-existing to protect");
  const withRows = decidePass({
    channels: [ch("a", "2020-01-01T00:00:00.000Z")], complete: true, selfUserId: ME,
    watermark: null, nowMs: 4242,
  });
  assert.equal(withRows.install, T("2020-01-01T00:00:00.000Z"),
    "a pass that saw a server stamp never crosses clocks");
});

test("the boundary moves only on a complete pass, and never backward", () => {
  const newer = [ch("n", "2026-09-23T00:00:00.000Z")];
  assert.equal(pass({ channels: newer, complete: false }).advance, null,
    "an incomplete pass sees an unknown part of the world");
  assert.equal(pass({ channels: newer }).advance, T("2026-09-23T00:00:00.000Z"));
  assert.equal(pass({ channels: [ch("o", "2026-01-01T00:00:00.000Z")] }).advance, null,
    "an older room cannot drag the boundary down");
  assert.equal(pass({ channels: [] }).advance, null, "and an empty pass moves nothing");
});

// ── THE FOUR GATES ──────────────────────────────────────────────────────────

test("an agent/MCP-created channel — this account, after the boundary — inherits", () => {
  // THE RULING, in one case. No renderer ran: the row simply appeared in a reconcile pass.
  const res = pass({ channels: [ch("new", "2026-09-22T12:00:01.000Z")] });
  assert.deepEqual(res.seed, ["new"]);
  assert.equal(res.advance, T("2026-09-22T12:00:01.000Z"), "and the boundary follows it");
});

test("the boundary is STRICT — a room stamped exactly at it does not inherit", () => {
  assert.deepEqual(pass({ channels: [ch("edge", BOUND.at)] }).seed, [],
    "it was visible to the pass that drew the line");
});

test("a PEER's brand-new channel does not inherit this operator's defaults", () => {
  // ⚠ The record is per-machine and a peer's creation is not "a channel this account created".
  // This is also what keeps the two-member case honest: only the creator's desktop seeds.
  assert.deepEqual(pass({ channels: [ch("theirs", "2026-09-23T00:00:00.000Z", { createdBy: PEER })] }).seed, []);
});

test("a workspace-visible room this operator has not JOINED does not inherit", () => {
  assert.deepEqual(pass({ channels: [ch("nm", "2026-09-23T00:00:00.000Z", { isMember: false })] }).seed, []);
  assert.deepEqual(pass({ channels: [ch("nm", "2026-09-23T00:00:00.000Z", { isMember: undefined })] }).seed, [],
    "absent is 'no', never 'probably'");
});

test("an UNRESOLVED operator identity seeds nothing", () => {
  // Fail-closed: `myUserId` is null until the listener resolves it, and a null id must not match
  // a null `createdBy` on some malformed row.
  assert.deepEqual(pass({ selfUserId: null, channels: [ch("x", "2026-09-23T00:00:00.000Z")] }).seed, []);
  assert.deepEqual(
    pass({ selfUserId: null, channels: [ch("x", "2026-09-23T00:00:00.000Z", { createdBy: null })] }).seed, []);
});

// ── HOSTILE / MALFORMED INPUT ───────────────────────────────────────────────

test("a row with no parseable server stamp neither inherits nor moves the boundary", () => {
  const rows = [
    ch("no-stamp", undefined), ch("junk", "not a date"), ch("empty", ""),
    { id: "missing-fields" }, null, ch(undefined, "2027-01-01T00:00:00.000Z"),
  ];
  const res = pass({ channels: rows });
  assert.deepEqual(res.seed, []);
  assert.equal(res.advance, null, "a boundary must never rest on a value this build could not read");
  assert.deepEqual(seenRows(rows, ME), [], "every one of them is dropped whole");
});

test("a corrupt, wrong-version or unreadable watermark reads as ABSENT, which re-installs", () => {
  // ⚠ THE FAIL-CLOSED DIRECTION. The alternative reading — "treat it as epoch" — would seed every
  // channel the operator has ever created, which is the exact failure the record exists to stop.
  assert.equal(readWatermark(null), null);
  assert.equal(readWatermark("2026-09-22"), null);
  assert.equal(readWatermark([]), null);
  assert.equal(readWatermark({ at: BOUND.at }), null, "no version");
  assert.equal(readWatermark({ v: WATERMARK_V + 1, at: BOUND.at }), null, "a version this build does not know");
  assert.equal(readWatermark({ v: WATERMARK_V, at: "junk" }), null);
  assert.deepEqual(readWatermark({ v: WATERMARK_V, at: BOUND.at }), BOUND);
  assert.ok(Number.isNaN(stampMs(42)) && Number.isNaN(stampMs("")) && Number.isNaN(stampMs(null)));
});

test("every room in a pass is decided against the boundary AS IT STOOD, and seeds oldest first", () => {
  // ⚠ A RUNNING MAX WOULD DROP THE OLDER SIBLING. Two rooms created in the same window — say the
  // operator's agent makes one and their own second machine's dialog makes another — must both be
  // measured against the stored boundary, not against each other.
  const res = pass({
    channels: [ch("later", "2026-09-22T12:00:09.000Z"), ch("sooner", "2026-09-22T12:00:03.000Z")],
  });
  assert.deepEqual(res.seed, ["sooner", "later"]);
  assert.equal(res.advance, T("2026-09-22T12:00:09.000Z"));
});

// ── THE TWO PROPERTIES THE REVERSAL HAD TO KEEP ─────────────────────────────

test("WRITE-ONCE: seedChannel still refuses a configured channel, BEFORE it writes", () => {
  // ⚠ ASSERTED ON THE SHIPPED SOURCE because `agent-defaults.js` needs electron-store. The
  // ORDER is the property: a guard after the write is not a guard. `hasLaunchPosture` asks BOTH
  // stored records (`channel-prefs.js`), so a channel configured before U5 counts as configured.
  const seed = read("agent-defaults.js");
  const body = seed.slice(seed.indexOf("function seedChannel("));
  assert.ok(body.length > 0, "seedChannel is still where the census expects it");
  const guard = body.indexOf("channelPrefs.hasLaunchPosture(channelId)");
  const write = body.indexOf("channelPrefs.setLaunchSelection(");
  assert.ok(guard > -1, "the write-once guard is still there");
  assert.ok(write > -1 && guard < write, "and it refuses before anything is written");
  assert.match(body.slice(guard, write), /return \{ ok: true, seeded: false \}/,
    "an already-configured channel is skipped WHOLE, not partially re-seeded");
  assert.match(read("channel-prefs.js"), /function hasLaunchPosture\(channelId\) \{/,
    "…and the presence probe it refuses on has not been renamed out from under it");
});

test("the watch can never become a spawn-time read of the defaults record", () => {
  const code = stripComments(SRC);
  // ⚠ THE ONE ENTRY POINT INTO `agent-defaults.js` IS THE WRITER. Reading the record here would
  // be one line from handing it to a launch.
  assert.ok(!/getAgentDefaults|effectiveDefaults|FACTORY_DEFAULTS/.test(code),
    "the defaults record is never READ here — only seedChannel's own write path touches it");
  assert.ok(!/getLaunchPosture|launchStartModes|getLaunchSelection/.test(code),
    "and no posture is read here either: this module decides on TIMESTAMPS, not on settings");
  // ⚠ NOT ON THE SESSION PATH, BY REQUIRE. A spawn module reaching this one would be a launch
  // able to reach the defaults record through the door the census just opened.
  for (const m of ["session-engine", "session-launch", "session-launch-op", "trigger", "session-spawner"]) {
    assert.ok(!new RegExp(`require\\('\\./${m}'\\)`).test(code), `it does not reach ${m}.js`);
  }
  const requirers = readdirSync(MAIN)
    .filter((f) => f.endsWith(".js") && f !== "channel-seed-watch.js")
    .filter((f) => /require\('\.\/channel-seed-watch'\)/.test(stripComments(read(f))))
    .sort();
  assert.deepEqual(requirers, ["channel-listener.js"],
    "the watch is reachable ONLY from the listener's reconcile pass — the place that already " +
      "learns about new channels — and from no launch lane");
  // ⚠ AND IT IS CALLED WITH THE PASS'S OWN COMPLETENESS AND THE RESOLVED IDENTITY, not with
  // `true` and not with a name. Both gates are only as good as what the call site hands over.
  assert.match(stripComments(read("channel-listener.js")),
    /seedWatch\.observeChannels\(desired, failedWorkspaces\.size === 0, myUserId\)/,
    "the listener hands over the real completeness flag and the resolved operator id");
});

test("observeChannels SEEDS FIRST and ADVANCES SECOND, and installs instead of seeding", () => {
  // ⚠ ASSERTED ON THE SHIPPED SOURCE (electron-store again), and the ORDER is the property.
  // Advancing first would move the boundary past a channel a crash then left unseeded — and it
  // would do so silently, because the next pass would find that channel below the line.
  const body = SRC.slice(SRC.indexOf("function observeChannels("));
  const install = body.indexOf("res.install != null");
  const loop = body.indexOf("for (const id of res.seed)");
  const seedCall = body.indexOf("agentDefaults.seedChannel(id)");
  const advance = body.indexOf("res.advance != null");
  assert.ok(install > -1 && loop > install, "the install pass returns before the seed loop is reached");
  assert.match(body.slice(install, loop), /return \{ installed: true, seeded: \[\] \}/,
    "…and it returns having seeded nothing");
  assert.ok(seedCall > loop && advance > seedCall,
    "every decided channel is handed to the ONE writer before the boundary moves");
});

test("the record stays LOCAL — nothing here posts, fetches or names it to the server", () => {
  const code = stripComments(SRC);
  assert.ok(!/fetch\(|apiFetch|channel-post|listener-io|POST/.test(code),
    "Samuel's 2026-09-18 privacy ruling: the defaults never leave this machine, so the seed is " +
      "applied BY this machine rather than sent to the creation");
});
