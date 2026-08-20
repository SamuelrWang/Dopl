// THE DURABLE LAUNCH POSTURE (main/channel-prefs.js) — the SECOND per-channel record,
// added 2026-08-20, and the half of the arm-vs-posture split that persists.
//
// WHY THERE ARE TWO RECORDS. H2 (2026-07-31) made the permission pair an ARM: single
// use, 30-minute TTL, consumable only by the consent-APPROVED launch. What H2 actually
// forbids is an AMBIENT read at a spawn nobody is attending — `startSession` is the one
// construction site for every spawn shape, so a durable pair folded in THERE re-armed
// peer wakes, crash resumes, recreated shells and requester auto-opens alike.
//
// It does not forbid durability. So the split is BY CONSUMER:
//   THE ARM      single use, expiring, ONE consumer — `trigger.js › inboundApproved`,
//                a human clicking Allow on a peer's request they are looking at.
//                Pinned in `channel-prefs.test.mjs` + `session-preset-start.test.mjs`.
//   THIS RECORD  durable, no TTL, spent by nothing, ONE consumer —
//                `channel-dir-ipc.js › sessions:launch`, the Agents tab's own button.
//                The operator launching THEIR OWN agent on THEIR OWN thread; the click
//                IS the consent, and no row is raised.
//
// WHAT IT FIXES. The Settings tab rendered the ARM beside the tool profile, the working
// folder and auto-send — all durable — and it was indistinguishable from them. The
// operator picked Bypass, the first launch spent it, and every later session started
// manual/ask while the control still read "Bypass". A fuse drawn as a switch.
//
// ⚠ EVERY CASE BELOW IS ABOUT THE ASYMMETRY BEING DELIBERATE. If someone "tidies" these
// two readers into symmetry — a TTL here, or an `at` stamp — the fix is undone and the
// Settings tab starts lying again. That is what these are guarding.
//
// Run: `node --test dopl-desktop-app/test/channel-launch-posture.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { prefs, SRC, CH_A, CH_B } from "./_channel-prefs-block.mjs";

const { armIsLive, armInto, readArmFrom, readPostureFrom, postureInto } = prefs;

const OK = { tools: "accept_edits", messages: "auto_inbound" };
const NOW = 1_700_000_000_000;
// ── THE DURABLE LAUNCH POSTURE (2026-08-20) ──────────────────────────────────
// The SECOND record, with the opposite lifetime. Everything here is about the
// ASYMMETRY being deliberate: the arm expires and is spent, this does neither,
// and the reason they can differ is that they have different CONSUMERS. H2's
// failure was an ambient read at an unattended spawn — `session-preset-start`
// pins that this record reaches exactly one attended launch and nothing else.

test("an unset channel's posture is the most restrictive pair, not a neighbour's", () => {
  const map = {};
  assert.equal(readPostureFrom(map, CH_A), null, "nothing stored reads as nothing");
  postureInto(map, CH_A, { tools: "bypass", messages: "auto_both" });
  assert.equal(readPostureFrom(map, CH_B), null, "per-channel isolation");
  assert.deepEqual(readPostureFrom(map, CH_A), { tools: "bypass", messages: "auto_both" });
});

test("the posture does NOT expire — that is the whole difference from the arm", () => {
  const map = {};
  postureInto(map, CH_A, OK);
  // The arm's own liveness rule, applied to the same shape, would refuse it: no
  // `at` stamp at all. `armIsLive` says no; the posture reader says yes.
  assert.equal(armIsLive(map[CH_A], NOW), false, "an arm with no stamp is dead by construction");
  assert.deepEqual(readPostureFrom(map, CH_A), OK, "the posture is not read through the TTL");
  // ...and a year later it is still the same answer.
  assert.deepEqual(readPostureFrom(map, CH_A), OK);
});

test("the posture is never SPENT by reading it", () => {
  const map = {};
  postureInto(map, CH_A, OK);
  for (let i = 0; i < 5; i += 1) assert.deepEqual(readPostureFrom(map, CH_A), OK);
  assert.ok(Object.prototype.hasOwnProperty.call(map, CH_A), "reading must not delete");
});

test("no `at` is ever written — a posture cannot be mistaken for an arm", () => {
  const map = {};
  postureInto(map, CH_A, { ...OK, at: NOW });
  assert.deepEqual(Object.keys(map[CH_A]).sort(), ["messages", "tools"],
    "extra properties are dropped, `at` included");
});

test("an unknown value on EITHER axis writes nothing at all", () => {
  for (const bad of [
    { tools: "root", messages: "ask" },
    { tools: "manual", messages: "auto_everything" },
    { tools: "bypass" },
    { messages: "auto_both" },
    null,
    [],
    "bypass",
  ]) {
    const map = {};
    assert.deepEqual(postureInto(map, CH_A, bad), { ok: false }, JSON.stringify(bad));
    assert.deepEqual(map, {}, "a rejected write must leave no half-applied posture");
  }
});

test("a missing channel id is refused on both halves", () => {
  const map = {};
  assert.deepEqual(postureInto(map, "", OK), { ok: false });
  assert.deepEqual(postureInto(null, CH_A, OK), { ok: false });
  assert.equal(readPostureFrom(map, ""), null);
  assert.equal(readPostureFrom(null, CH_A), null);
  assert.deepEqual(map, {});
});

test("the two records do not share storage — arming does not set a posture", () => {
  // Same map shape, same validator, DIFFERENT store keys in the live module. The
  // pure halves are proved independent here; the key split is asserted below.
  const arms = {};
  const postures = {};
  armInto(arms, CH_A, { tools: "bypass", messages: "auto_both" }, NOW);
  assert.equal(readPostureFrom(postures, CH_A), null, "an arm is not a posture");
  postureInto(postures, CH_B, OK);
  assert.equal(readArmFrom(arms, CH_B, NOW), null, "a posture is not an arm");
});

test("the live module keys the two records apart", () => {
  // ⚠ THE VALUE, NOT THE SYMBOL. One key for both would make every consent arm a
  // permanent channel setting — H2, exactly.
  assert.match(SRC, /const PRESETS_KEY = 'channelPermissionPresets'/);
  assert.match(SRC, /const POSTURE_KEY = 'channelLaunchPosture'/);
  assert.notEqual("channelPermissionPresets", "channelLaunchPosture");
});

test("getLaunchPosture falls back to the restrictive default, never to null", () => {
  // The asymmetry with getPermissionPreset is deliberate and stated in source: an
  // arm that is absent was NOT chosen, but a durable setting that is absent IS
  // manual/ask. A null here would make the Settings tab render nothing.
  const body = SRC.slice(SRC.indexOf("function getLaunchPosture("));
  assert.match(body.slice(0, 220), /readPostureFrom\(getAllPostures\(\), channelId\) \|\| defaultPreset\(\)/);
});
