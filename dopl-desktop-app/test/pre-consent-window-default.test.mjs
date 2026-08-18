// PHASE 9 — WINDOWING INVERTS: the pre-consent window stops being the DEFAULT.
//
// WHAT INVERTED. Until 2026-08-18 an inbound channel request minted a window per
// thread the instant it arrived — before anyone had looked at it — and clicking the
// notification opened the app on top of that. MAPPING.md's ruling turns it around:
// the notification FOCUSES the main app and lands on the channel, where the Inbox's
// launch panel is the decision surface, and the per-thread window becomes opt-in.
//
// WHY THIS IS A TEST AND NOT A COMMENT. "Stops being the default" is one careless
// edit away from two much worse things, in OPPOSITE directions:
//
//   • the window comes back, because someone collapsed the new switch into the old
//     one (they look interchangeable and are not);
//   • the SESSION window goes away with it, because someone took `getWindowMode()`
//     down instead — that switch governs the OPERATOR'S OWN runs, is still ON by
//     default, and Phase 10's opt-in pop-out is built on the machinery behind it.
//
// So both defaults are pinned as VALUES (the getters are evaluated against a fake
// store, not grepped), and the two call sites are pinned as SOURCE — one gains the
// new gate, the other must not.
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

// settings.js requires electron-store, so the two getters are sliced and evaluated
// against a fake store instead. Their whole content IS the absent-value branch, and
// a regex over `=== true` would pass just as happily on the wrong side of it.
function gettersOver(stored) {
  const keys = {};
  for (const m of SETTINGS.matchAll(/const (\w+_KEY) = '([^']+)'/g)) keys[m[1]] = m[2];
  assert.ok(keys.WINDOW_MODE_KEY, "settings.js no longer names WINDOW_MODE_KEY");
  assert.ok(keys.PRE_CONSENT_WINDOW_KEY, "settings.js no longer names PRE_CONSENT_WINDOW_KEY");
  return new Function(
    "store",
    "WINDOW_MODE_KEY",
    "PRE_CONSENT_WINDOW_KEY",
    `${fnOf(SETTINGS, "getWindowMode")}
     ${fnOf(SETTINGS, "getPreConsentWindow")}
     return { getWindowMode, getPreConsentWindow };`
  )(
    { get: (k) => stored[k] },
    keys.WINDOW_MODE_KEY,
    keys.PRE_CONSENT_WINDOW_KEY
  );
}

const KEY = "preConsentWindowMode";
const SESSION_KEY = "sessionWindowMode";

// ── the two defaults, in opposite directions ────────────────────────────────

test("a fresh install opens NO pre-consent window", () => {
  // The inversion itself. Unset must read false, and so must every value that is
  // not a literal `true` — a hand-edited store, a half-written migration and a
  // stringly "true" all resolve to the direction that mints no window.
  for (const stored of [{}, { [KEY]: undefined }, { [KEY]: null }, { [KEY]: 0 }, { [KEY]: "true" }, { [KEY]: 1 }]) {
    assert.equal(gettersOver(stored).getPreConsentWindow(), false, JSON.stringify(stored));
  }
});

test("the capability is intact — opting back in is one boolean", () => {
  assert.equal(gettersOver({ [KEY]: true }).getPreConsentWindow(), true);
});

test("the SESSION window is untouched and still defaults ON", () => {
  // Different switch, different question: this one is "do the operator's own runs
  // get a window", and Phase 9 did not answer it. Turning it off here would delete
  // the live session window, the tray toggle's meaning, and Phase 10's substrate.
  assert.equal(gettersOver({}).getWindowMode(), true, "unset must still be window mode");
  assert.equal(gettersOver({ [SESSION_KEY]: false }).getWindowMode(), false);
  // …and the pre-consent flag must not have been wired to the same key.
  assert.equal(gettersOver({ [SESSION_KEY]: true }).getPreConsentWindow(), false);
});

// ── the call sites ──────────────────────────────────────────────────────────

test("handleTrigger opens a pre-consent window only when BOTH switches say so", () => {
  const fn = fnOf(TRIGGER, "handleTrigger");
  assert.match(
    fn,
    /if \(settings\.getWindowMode\(\) && settings\.getPreConsentWindow\(\)\) \{/,
    "the pre-consent window is a session window, so it can never outlive the master switch"
  );
  // One gate, one call — a second openConsentWindow would be a second default.
  assert.equal((TRIGGER.match(/sessionEngine\.openConsentWindow\(/g) || []).length, 1);
});

test("the operator's own responder session is NOT gated on the new flag", () => {
  // `inboundApproved` decides session-window-vs-headless for a request the operator
  // has ALREADY approved. That is the operator's own run, and Phase 9 must not have
  // reached into it — if it had, every approval would silently go headless.
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
