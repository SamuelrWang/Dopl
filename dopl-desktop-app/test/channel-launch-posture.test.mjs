// THE DURABLE LAUNCH POSTURE (main/channel-prefs.js) — the per-channel permission pair the
// operator's OWN agent starts on when they press Launch on the Agents tab.
//
// ⚠ IT USED TO BE THE SECOND OF TWO RECORDS, AND SINCE 2026-08-20 IT IS THE ONLY ONE.
// H2 (2026-07-31) made the permission pair an ARM: single use, 30-minute TTL, consumable only
// by the consent-APPROVED launch. What H2 actually forbids is an AMBIENT read at a spawn nobody
// is attending — `startSession` is the one construction site for every spawn shape, so a durable
// pair folded in THERE re-armed peer wakes, crash resumes, recreated shells and requester
// auto-opens alike. It does not forbid durability, so the split was BY CONSUMER:
//   THE ARM      single use, expiring, ONE consumer — `trigger.js › inboundApproved`.
//   THIS RECORD  durable, no TTL, spent by nothing, ONE consumer —
//                `session-ipc-ops.js › sessions:launch`, the Agents tab's own button. The
//                operator launching THEIR OWN agent on THEIR OWN thread; the click IS the
//                consent, and no row is raised.
// Samuel's ruling deleted the arm (its web controls had stopped rendering at the 2026-08-18
// consent rewrite and nobody noticed — F-233), so the split resolved in this record's favour.
//
// ⚠ THAT MAKES THIS FILE'S ORIGINAL FRAMING OBSOLETE AND ITS CASES LIVE, WHICH IS WHY IT IS
// REWRITTEN RATHER THAN MERGED AWAY (INVARIANTS §14). Every case below was written as "the
// asymmetry with the arm is deliberate — do not tidy these two readers into symmetry". There is
// no second reader to be symmetrical with, so the ARGUMENT changes and the ASSERTIONS do not:
// no TTL, no `at`, never spent by reading, per-channel isolation, a rejected write leaving no
// half-applied posture. Those are the properties the Settings tab depends on, and they are the
// reason the arm was the thing that had to go rather than this.
//
// WHAT IT FIXES. The Settings tab rendered the ARM beside the tool profile, the working folder
// and auto-send — all durable — and it was indistinguishable from them. The operator picked
// Bypass, the first launch spent it, and every later session started manual/ask while the
// control still read "Bypass". A fuse drawn as a switch.
//
// WHAT IT CANNOT DO. SUPERVISION, never CONTAINMENT: `bypass` is still bounded by the channel's
// tool profile and by `session-profiles.js › SESSION_HARD_DENY`, and Axis B still refuses to let
// ANY tool posture send a message. Local-only (electron-store), never POSTed.
//
// Run: `node --test dopl-desktop-app/test/channel-launch-posture.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { prefs, SRC, CH_A, CH_B } from "./_channel-prefs-block.mjs";

const { readPostureFrom, postureInto } = prefs;

const OK = { tools: "accept_edits", messages: "auto_inbound" };
const NOW = 1_700_000_000_000;

test("an unset channel's posture is the most restrictive pair, not a neighbour's", () => {
  const map = {};
  assert.equal(readPostureFrom(map, CH_A), null, "nothing stored reads as nothing");
  postureInto(map, CH_A, { tools: "bypass", messages: "auto_both" });
  assert.equal(readPostureFrom(map, CH_B), null, "per-channel isolation");
  assert.deepEqual(readPostureFrom(map, CH_A), { tools: "bypass", messages: "auto_both" });
});

test("the posture does NOT expire — reading it is not a clock question at all", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20; INVARIANTS §14). This case used to prove the
  // asymmetry by applying the ARM's own liveness rule to this record's shape:
  // `armIsLive(map[CH_A], NOW)` answered false (no `at` stamp) while `readPostureFrom`
  // answered with the pair — one map, two readers, opposite verdicts, which was the whole
  // point. `armIsLive` is deleted, so the contrast has nothing to contrast against.
  //
  // The PROPERTY is unchanged and is what the Settings tab rests on: this reader takes no
  // clock, so there is no value of "now" at which a stored posture stops reading back. The
  // absence of a time argument is asserted structurally below, because a reader that GAINED
  // one would still pass the behavioural half on the day it was added.
  const map = {};
  postureInto(map, CH_A, OK);
  assert.deepEqual(readPostureFrom(map, CH_A), OK);
  // …and a year of calls later it is still the same answer.
  for (let i = 0; i < 5; i += 1) assert.deepEqual(readPostureFrom(map, CH_A), OK);
  assert.equal(readPostureFrom.length, 2, "(map, channelId) — no clock, so no expiry to have");
  assert.match(SRC, /function readPostureFrom\(map, channelId\) \{/,
    "the shipped signature, not just the sliced one");
});

test("the posture is never SPENT by reading it", () => {
  // ⚠ THE ONE PROPERTY THE ARM'S DELETION MAKES MORE IMPORTANT, NOT LESS. `consumePermissionPreset`
  // was a read that DELETED, and it lived one function away from this one in the same module. The
  // asymmetry is gone from the source, so the only thing left saying "this half must not grow a
  // consume twin" is this case and the block in `channel-prefs.js`.
  const map = {};
  postureInto(map, CH_A, OK);
  for (let i = 0; i < 5; i += 1) assert.deepEqual(readPostureFrom(map, CH_A), OK);
  assert.ok(Object.prototype.hasOwnProperty.call(map, CH_A), "reading must not delete");
  assert.ok(!/function consumeLaunchPosture|takePostureFrom/.test(SRC),
    "no take-and-remove twin has appeared beside it");
});

test("no `at` is ever written — nothing bookkeeping-shaped rides in on a valid pair", () => {
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

test("two channels hold independent postures, and one write never reaches the other", () => {
  // ⚠ REWRITTEN FROM "the two records do not share storage" (2026-08-20; INVARIANTS §14). The
  // original drove `armInto` into one map and `postureInto` into another and asserted neither
  // reader saw the other's record — the pure half of "one store key for both would make every
  // consent arm a permanent channel setting, which IS H2". With the arm deleted there is one
  // record and the cross-reader case cannot be written.
  //
  // What is kept is the isolation the original was built on top of, now stated within the
  // surviving record: this is the property that stops a `bypass` chosen for one channel from
  // becoming the posture the operator's agent starts on in another.
  const map = {};
  postureInto(map, CH_A, { tools: "bypass", messages: "auto_both" });
  postureInto(map, CH_B, { tools: "manual", messages: "ask" });
  assert.deepEqual(readPostureFrom(map, CH_A), { tools: "bypass", messages: "auto_both" });
  assert.deepEqual(readPostureFrom(map, CH_B), { tools: "manual", messages: "ask" });
  // …and overwriting one leaves the other byte-identical.
  postureInto(map, CH_A, OK);
  assert.deepEqual(readPostureFrom(map, CH_B), { tools: "manual", messages: "ask" });
});

test("the module keys the posture under its own store key, and the arm's is gone", () => {
  // ⚠ REWRITTEN, NOT REMOVED (2026-08-20; INVARIANTS §14). This asserted BOTH keys existed and
  // differed by VALUE — `PRESETS_KEY = 'channelPermissionPresets'` vs
  // `POSTURE_KEY = 'channelLaunchPosture'` — because one key for both would have made every
  // consent arm a permanent channel setting, which is H2 exactly. `PRESETS_KEY` is deleted.
  //
  // The surviving half is worth more than it looks: the posture must keep its OWN key rather
  // than inheriting the arm's now-vacant one. `channelPermissionPresets` still exists in the
  // electron-store of every installed build, holding pairs an operator armed under the OLD
  // single-use contract. Reading those under durable semantics would resurrect exactly the
  // grant H2 was written to stop — a posture chosen once, months ago, for one consent card,
  // silently becoming the channel's standing launch setting.
  assert.match(SRC, /const POSTURE_KEY = 'channelLaunchPosture'/);
  // ⚠ CODE ONLY. The module's header NAMES `channelPermissionPresets` at length, explaining what
  // the arm was and why it went — which is the documentation §14 asks for, and would make a
  // whole-source scan here fail on the excision note itself.
  const code = SRC.split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
    .join("\n");
  assert.ok(!/PRESETS_KEY|channelPermissionPresets/.test(code),
    "the arm's key must not be read, re-used, or migrated FROM — stale arms stay unread");
});

test("getLaunchPosture falls back to the restrictive default, never to null", () => {
  // ⚠ THE ASYMMETRY THIS STATED IS NOW JUST THE RULE. It read "the asymmetry with
  // getPermissionPreset is deliberate: an arm that is absent was NOT chosen, but a durable
  // setting that is absent IS manual/ask". There is no `getPermissionPreset`. The rule stands
  // on its own: a null here would make the Settings tab render nothing where it must render
  // Manual / Ask, and a caller that treated null as "no constraint" would be the wrong
  // direction entirely.
  // ⚠ THE FALLBACK MOVED INTO `effectivePosture` (2026-08-22) and did not weaken: that helper is
  // `readPostureFrom(...) || defaultPreset()` plus the always-present `model` key the renderer's
  // own-key capability probe needs. Driven for real — shape and all — in
  // `agent-model-selection.test.mjs`'s two WIRE cases; pinned here as the SPELLING, because the
  // store-backed reader is the half source extraction cannot reach.
  const body = SRC.slice(SRC.indexOf("function getLaunchPosture("));
  assert.match(body.slice(0, 220), /effectivePosture\(getAllPostures\(\), channelId\)/);
  const helper = SRC.slice(SRC.indexOf("function effectivePosture("));
  assert.match(helper.slice(0, 400), /stored \|\| defaultPreset\(\)/,
    "the restrictive fallback must survive the move, or an unset channel reads as no constraint");
});
