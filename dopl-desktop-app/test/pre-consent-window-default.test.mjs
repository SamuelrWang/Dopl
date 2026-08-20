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
const CONSENT = M("session-consent.js");

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

// ── the call sites: the gates SURVIVE so the machinery stays disarmed at its own guards ──

test("handleTrigger still gates the pre-consent window on BOTH switches", () => {
  const fn = fnOf(TRIGGER, "handleTrigger");
  assert.match(
    fn,
    /if \(settings\.getWindowMode\(\) && settings\.getPreConsentWindow\(\)\) \{/,
    "the pre-consent window is a session window, so it can never outlive the master switch"
  );
  // One gate, one call — a second openConsentWindow would be a second default.
  assert.equal((TRIGGER.match(/sessionEngine\.openConsentWindow\(/g) || []).length, 1);
});

test("inboundApproved still asks the master switch, so approved requests run HEADLESS", () => {
  // With getWindowMode() hard false, this conjunction is what routes every approved
  // request to the headless lane. Removing the guard would resurrect the windowed
  // responder behind the retirement's back.
  const fn = fnOf(TRIGGER, "inboundApproved");
  assert.match(fn, /if \(settings\.getWindowMode\(\) && \(await launchResponderSession\(/);
  assert.ok(
    !/getPreConsentWindow/.test(fn),
    "the pre-consent default must not decide how an APPROVED request runs"
  );
});

/** Comments stripped, so a docblock POINTING at the gate is not read as one. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("session-consent.js holds no gate of its own", () => {
  // ONE answer to "should this window exist", at the call site that is holding the
  // reason. A module that also refuses on its own behalf is the divided answer the
  // C-9 window-budget leak was made of. Its docblock must still SAY where the gate
  // is — that is why this reads the code and not the file.
  assert.ok(!/settings/.test(code(CONSENT)), "session-consent must not reach for settings at all");
  assert.match(CONSENT, /getPreConsentWindow/, "…but its docblock must name the one gate");
  // …and nothing was narrowed for the flip: the whole lifecycle is still here.
  for (const name of ["open", "decide", "close", "release", "takeForAdopt"]) {
    assert.ok(new RegExp(`\\b${name},`).test(CONSENT), `session-consent no longer exports ${name}`);
  }
});
