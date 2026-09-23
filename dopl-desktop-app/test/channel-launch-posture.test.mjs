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
import { SRC, SELECTION_SRC } from "./_channel-prefs-block.mjs";
import { codeOf, fnOf } from "./helpers/source-probe.mjs";

test("the posture is never SPENT by reading it — no take-and-remove twin exists", () => {
  assert.ok(!/function consumeLaunchPosture|takePostureFrom/.test(SRC + SELECTION_SRC),
    "no take-and-remove twin has appeared beside the record");
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
  assert.ok(!/PRESETS_KEY|channelPermissionPresets/.test(codeOf(SRC)),
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
  // ⚠ THE COMPOSITION CHANGED SHAPE ON 2026-09-21 (U5) AND THE PROPERTY DID NOT. The reader is
  // the VERSIONED, RUNTIME-KEYED selection now, rendered back into the legacy three-key wire for
  // every renderer older than U5; the fallback it falls back TO is `emptySelection()`, which is
  // the restrictive one by construction. Pinned as the SPELLING, because the store-backed reader
  // is the half source extraction cannot reach.
  assert.match(fnOf(SRC, "getLaunchPosture"), /toLegacyPosture\(ctx\(\), getLaunchSelection\(channelId\)\)/);
  assert.match(fnOf(SELECTION_SRC, "toLegacyPosture"), /rec\.tools \|\| ctx\.narrowestToolFor\(selection\.runtime\)/,
    "the restrictive fallback must survive the move, or an unset channel reads as no constraint");
  // …and the thing it falls back to really is the narrowest, not "whatever parsed".
  assert.match(fnOf(SELECTION_SRC, "emptySelection"), /messages: SELECTION_MESSAGE_MODES\[0\]/,
    "an unset selection resolves to the restrictive messaging member, never a wider one");
});
