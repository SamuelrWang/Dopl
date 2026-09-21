// THE LAUNCH STAMPS SURVIVE A RESTART — Samuel's ruling, 2026-09-18, and it REVERSES the one
// `main/session-own-launch.js` carried until that day.
//
// THE DEFECT, as it was received. A channel agent the operator started at the New Agent button
// carries `launchDepth: 0` — the one lane that may claim a human was at the keyboard — and may
// therefore staff its own channel. Parked agents began surviving an app restart (7ecd3975 +
// 65c43e22), and a restarted one is REBUILT FROM ITS DURABLE RECORD: `main/session-boot.js ›
// parkedSessionFromRecord` at the boot re-park, `main/session-park.js › startResume` at the crash
// resume. Neither stamp was on that record — `session-io.js › baseRecord` was a whitelist that
// omitted both — so the orchestrator woke at `launchDepth: undefined`, which
// `normalizeLaunchDepth` reads as the CAP, and every later worker launch was denied
// `launch-depth-capped`, in every posture, with no setting that could help.
//
// THE RULE NOW: the stamps are PERSISTED and both rebuild sites RESTORE them. What did not change
// is the fail-closed direction — a record that carries no stamp (every record written before this
// change) still reads as the cap — and the count of lanes that may MINT a depth, which is one.
// The census half of that claim lives in `test/session-own-launch.test.mjs` and
// `test/launch-chain.test.mjs`; this file drives the ROUND TRIP end to end.
//
// METHOD: the real projection and the real whitelist, source-extracted the way
// `session-model.test.mjs` already round-trips the model pick, feeding the real rebuild sites on
// `_session-boot-harness.mjs`'s rig, and the real `grantDecision` for the verdict.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";
import { harness, KEY, CHANNEL } from "./_session-boot-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const require_ = createRequire(import.meta.url);

const profiles = require_(join(MAIN, "session-profiles.js"));
const lane = require_(join(MAIN, "session-own-launch.js"));
const { DOPL_CHANNEL_TOOL } = require_(join(MAIN, "tool-profiles.js"));

const IO = readFileSync(join(MAIN, "session-io.js"), "utf8");
const STORE = readFileSync(join(MAIN, "session-store.js"), "utf8");
// ⚠ `runtimeRegistry` / `runtimeTruth` ARE INJECTED SINCE 2026-09-21 (U10): `baseRecord` also
// projects what the conversation was RUNNING AS off the session's own descriptor. Both are REAL —
// neither pulls electron — so this round trip still drives the SHIPPED projection.
const baseRecord = new Function(
  "runtimeRegistry", "runtimeTruth",
  `${fnOf(IO, "baseRecord")}\n return baseRecord;`
)(require_(join(MAIN, "runtime/index.js")), require_(join(MAIN, "session-runtime-truth.js")));
const durable = new Function(`${fnOf(STORE, "durableName")}\n${fnOf(STORE, "durableSessionRecord")}
                              return durableSessionRecord;`)();

const LAUNCH = { op: "manage", action: "launch", goal: "staff this channel" };
const SDK = "sdk-y1uun32v";

/** A live session as the engine stamps it, with only the fields `baseRecord` reads. */
const live = (over = {}) => ({
  key: KEY, sessionId: "s1", sdkSessionId: SDK, channelId: CHANNEL, taskId: "",
  workspaceId: "w1", side: "responder", profile: "channel_agent", mode: "interactive",
  startedAt: 1757000000000, agentId: "y1uun32v", counterpartyId: "peer-1", bind: "pair",
  model: "opus", runtimeId: "claude", ownPostSeq: 3,
  state: { phase: "parked", turns: 7, costUsd: 0.42 }, context: { channelName: "Dopl" },
  ...over,
});

/**
 * THE GATE'S VERDICT for an own-channel launch by a session carrying these stamps.
 *
 * ⚠ THE TWO AXES ARE HELD AT THE ADMITTING COMBINATION ON PURPOSE. Whether `bypass` +
 * auto-outbound is the right conjunction is `session-own-launch.test.mjs`'s question and it drives
 * every other pair exhaustively; the only variable here is whether the STAMP survived the disk.
 * ⚠ The two stamp fields are spelled exactly as `session-io.js › grantArgs` spells them when it
 * reads them off a live session — that spelling is itself pinned, in `launch-chain.test.mjs`.
 */
const verdictFor = (s) => profiles.grantDecision({
  profile: "full", channelId: CHANNEL, toolName: DOPL_CHANNEL_TOOL, input: LAUNCH,
  toolMode: "bypass", messageMode: "auto_both",
  launchDepth: s.launchDepth, launchChain: s.launchChain === true,
});

// ── 1. THE PROJECTION AND THE WHITELIST ──────────────────────────────────────────

test("the operator's depth-0 stamp reaches the disk, and so does an absent one", () => {
  const rec = durable(baseRecord(live({ launchDepth: 0 })));
  assert.equal(rec.launchDepth, 0, "the one value that means a human started this session");
  assert.equal(rec.launchChain, false, "…and the channel never armed chaining for it");
  // A launched worker stamps nothing, so nothing is what the record must carry.
  assert.equal(durable(baseRecord(live())).launchDepth, null);
  assert.equal(durable(baseRecord(live({ launchDepth: 1, launchChain: true }))).launchDepth, 1);
  assert.equal(durable(baseRecord(live({ launchChain: true }))).launchChain, true);
});

test("the whitelist FAILS CLOSED over junk, and `null` is what the gate reads as the cap", () => {
  // ⚠ `null`, NOT `0`. The naive coercion is `Number.isFinite(Number(x))`, and `Number(null)`,
  // `Number("")`, `Number(false)` and `Number([])` are all 0 — which would hand the most
  // permissive value in the enum to the least trustworthy input there is.
  for (const junk of [undefined, null, NaN, Infinity, -1, -0.5, "0", "", {}, [], true, false]) {
    assert.equal(durable({ launchDepth: junk }).launchDepth, null,
      `${JSON.stringify(String(junk))} must reach the disk as UNKNOWN, never as zero`);
    assert.equal(lane.normalizeLaunchDepth(durable({ launchDepth: junk }).launchDepth),
      lane.MAX_LAUNCH_DEPTH, "…and UNKNOWN is the cap at the gate");
  }
  // ⚠ THE CAP IS NOT RE-SPELLED IN THE STORE. `durableSessionRecord` is in the PURE block and
  // cannot ask the module that owns `MAX_LAUNCH_DEPTH`, so it bounds the SHAPE and leaves the
  // clamp to `normalizeLaunchDepth` — one statement of the bound, still.
  assert.equal(durable({ launchDepth: 99 }).launchDepth, 99, "carried as shape…");
  assert.equal(lane.normalizeLaunchDepth(99), lane.MAX_LAUNCH_DEPTH, "…clamped where the cap lives");
  for (const junk of [undefined, null, 1, "true", {}, "yes"]) {
    assert.equal(durable({ launchChain: junk }).launchChain, false, JSON.stringify(String(junk)));
  }
});

// ── 2. THE BOOT RE-PARK (session-boot.js › parkedSessionFromRecord) ──────────────

test("BOOT: a depth-0 orchestrator wakes from its record able to launch again", () => {
  const rec = durable(baseRecord(live({ launchDepth: 0 })));
  const s = harness().boot.parkedSessionFromRecord(KEY, rec, SDK);
  assert.equal(s.launchDepth, 0, "restored off the record, which is the whole fix");
  assert.equal(s.launchChain, false);
  assert.equal(verdictFor(s), "allow", "the F-320 case, now surviving a restart");
});

test("BOOT: a launched worker stays capped, and an OLD-SHAPE record stays capped with it", () => {
  const worker = harness().boot.parkedSessionFromRecord(KEY, durable(baseRecord(live())), SDK);
  assert.equal(verdictFor(worker), "deny", "depth 1: its staff may not staff themselves");
  // ⚠ THE STALE-RECORD CASE, AND IT IS THE ACCEPTED COST OF THE RULING. A record written before
  // this change has NEITHER key; there is no migration, because guessing a depth nobody recorded
  // is the claim this lane exists to refuse. The operator relaunches such an agent once.
  const old = durable(baseRecord(live({ launchDepth: 0 })));
  delete old.launchDepth;
  delete old.launchChain;
  const stale = harness().boot.parkedSessionFromRecord(KEY, old, SDK);
  assert.equal(stale.launchDepth, undefined);
  assert.equal(stale.launchChain, false);
  assert.equal(verdictFor(stale), "deny", "absent is the cap — the fail-closed direction is intact");
});

test("BOOT: a capped session whose CHANNEL armed chaining is admitted anyway", () => {
  const rec = durable(baseRecord(live({ launchChain: true })));
  const s = harness().boot.parkedSessionFromRecord(KEY, rec, SDK);
  assert.equal(s.launchDepth, null, "still no depth to claim");
  assert.equal(s.launchChain, true, "…but the room's setting survived with it");
  assert.equal(verdictFor(s), "allow", "the setting skips the depth question, exactly as at spawn");
});

// ── 3. THE CRASH RESUME (session-park.js › startResume) ──────────────────────────

test("RESUME: the spec startResume hands the construction site carries both stamps", async () => {
  const h = harness();
  await h.park.startResume(durable(baseRecord(live({ launchDepth: 0 }))), SDK, "continue");
  assert.equal(h.calls.startSession.length, 1, "the resume reached startSession");
  const spec = h.calls.startSession[0];
  assert.equal(spec.launchDepth, 0);
  assert.equal(spec.launchChain, false);
  assert.equal(verdictFor(spec), "allow");
});

test("RESUME: depth 1 stays denied unless the record also says the room armed chaining", async () => {
  const capped = harness();
  await capped.park.startResume(durable(baseRecord(live({ launchDepth: 1 }))), SDK, "continue");
  assert.equal(verdictFor(capped.calls.startSession[0]), "deny");

  const chained = harness();
  await chained.park.startResume(
    durable(baseRecord(live({ launchDepth: 1, launchChain: true }))), SDK, "continue");
  assert.equal(chained.calls.startSession[0].launchChain, true);
  assert.equal(verdictFor(chained.calls.startSession[0]), "allow");
});

test("RESUME: an OLD-SHAPE record resumes capped, the same as the boot lane", async () => {
  const old = durable(baseRecord(live({ launchDepth: 0 })));
  delete old.launchDepth;
  delete old.launchChain;
  const h = harness();
  await h.park.startResume(old, SDK, "continue");
  assert.equal(h.calls.startSession[0].launchDepth, undefined);
  assert.equal(verdictFor(h.calls.startSession[0]), "deny");
});
