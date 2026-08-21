// PHASE 9 (2026-08-18) — WINDOWING INVERTS: the pre-consent window stops being the
// default. THEN 2026-08-20 — WINDOW MODE RETIRES OUTRIGHT (Samuel's live-test ruling,
// settings.js header): the SESSION window follows it, hard OFF with no stored override.
//
// WHAT THIS FILE PINS NOW, in both directions:
//
//   • the pre-consent window stays opt-in-able machinery but its default stays OFF;
//   • `getWindowMode()` answers false UNCONDITIONALLY — not "defaults off", OFF. The
//     old default-ON was what minted a requester session window on the sender's own
//     thread opener and launched their agent against their own message (the
//     self-trigger bug, observed live 2026-08-20). A stored `sessionWindowMode: true`
//     from an old install must NOT resurrect it.
//
// Run: `node --test dopl-desktop-app/test/pre-consent-window-default.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const SETTINGS = M("settings.js");
const TRIGGER = M("trigger.js");

// settings.js requires electron-store, so the getters are sliced and evaluated
// against a fake store instead — a regex over `return false` could pass on a
// function that still reads the store first.
function gettersOver(stored) {
  const keys = {};
  for (const m of SETTINGS.matchAll(/const (\w+_KEY) = '([^']+)'/g)) keys[m[1]] = m[2];
  assert.ok(keys.PRE_CONSENT_WINDOW_KEY, "settings.js no longer names PRE_CONSENT_WINDOW_KEY");
  return new Function(
    "store",
    "PRE_CONSENT_WINDOW_KEY",
    `${fnOf(SETTINGS, "getWindowMode")}
     ${fnOf(SETTINGS, "getPreConsentWindow")}
     ${fnOf(SETTINGS, "setWindowMode")}
     return { getWindowMode, getPreConsentWindow, setWindowMode };`
  )({ get: (k) => stored[k], set: () => assert.fail("a retired setter must not write the store") },
    keys.PRE_CONSENT_WINDOW_KEY);
}

const KEY = "preConsentWindowMode";
const SESSION_KEY = "sessionWindowMode";

// ── the two switches, both answering "no window" ────────────────────────────

test("a fresh install opens NO pre-consent window", () => {
  // Unset must read false, and so must every value that is not a literal `true` —
  // a hand-edited store, a half-written migration and a stringly "true" all
  // resolve to the direction that mints no window.
  for (const stored of [{}, { [KEY]: undefined }, { [KEY]: null }, { [KEY]: 0 }, { [KEY]: "true" }, { [KEY]: 1 }]) {
    assert.equal(gettersOver(stored).getPreConsentWindow(), false, JSON.stringify(stored));
  }
});

test("the pre-consent capability is intact — opting back in is one boolean", () => {
  assert.equal(gettersOver({ [KEY]: true }).getPreConsentWindow(), true);
});

test("the SESSION window is RETIRED: hard OFF, no stored value resurrects it", () => {
  // Not a default — an answer. A `sessionWindowMode: true` persisted by any older
  // build must read false, or the sender-side session pop-up comes back for
  // exactly the installs that used it.
  for (const stored of [{}, { [SESSION_KEY]: true }, { [SESSION_KEY]: false }, { [SESSION_KEY]: "true" }]) {
    assert.equal(gettersOver(stored).getWindowMode(), false, JSON.stringify(stored));
  }
  // …and the pre-consent flag must not have been wired to the same key.
  assert.equal(gettersOver({ [SESSION_KEY]: true }).getPreConsentWindow(), false);
});

test("the retired setter answers false and never writes the store", () => {
  // gettersOver's fake store fails the test on any set() call.
  assert.equal(gettersOver({}).setWindowMode(true), false);
});

// ── THE MACHINERY IS GONE; THE SWITCHES OUTLIVE IT BY ONE WAVE ──────────────
//
// ⚠ THREE CALL-SITE TESTS STOOD HERE AND WENT WITH WHAT THEY GATED (2026-08-20, F-228):
// `handleTrigger`'s two-switch conjunct over `sessionEngine.openConsentWindow`, and the
// `session-consent.js holds no gate of its own` rule. There is no pre-consent window, no
// `openConsentWindow`, and no `session-consent.js`.
//
// ⚠ WHAT SURVIVES IS THE READING ABOVE, AND IT IS THE POINT OF KEEPING THIS FILE. Both getters
// still answer OFF for every stored value, so a machine carrying `sessionWindowMode: true` or
// `preConsentWindowMode: true` from an older install cannot re-arm anything, and the setter
// still refuses to write. That is the DISARMED-GUARD record F-228 asks for: the switches are
// deleted in the wave after this one, deliberately after a full green, so nothing can quietly
// come back in between.

test("the responder launch is WINDOWLESS, and it is the only shape left", () => {
  // 2026-08-20 (retirement): an approved request runs a windowless SDK session. No
  // master-switch read anywhere in the approval path — `launch()` refuses every non-windowless
  // shape outright now, so there is no switch left for this path to consult.
  const fn = fnOf(TRIGGER, "inboundApproved");
  assert.match(fn, /if \(await launchResponderSession\(/);
  assert.ok(!/getWindowMode/.test(fn), "no master-switch read here — the engine owns its own gate");
  assert.ok(
    !/getPreConsentWindow/.test(fn),
    "the pre-consent default must not decide how an APPROVED request runs"
  );
  const launch = fnOf(TRIGGER, "launchResponderSession");
  assert.match(launch, /windowless: true/);
  assert.match(launch, /triggerSeq: m\.seq/);
});

test("nothing in main opens a pre-consent window any more", () => {
  // The census, not a memory of it: the op, the module and the gate are all absent.
  assert.equal((TRIGGER.match(/openConsentWindow/g) || []).length, 0);
});
