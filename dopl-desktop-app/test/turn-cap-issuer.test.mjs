// THE TURN CAP IS ISSUER-KEYED (2026-09-05, task 9a) — 200 for the session a human started, 24
// for one an agent started, and the operator's setting still beats both.
//
// ⚠ WHAT WAS BROKEN. One number, 24, applied to every spawn shape. It was sized for the runaway a
// CHAIN produces (an agent spawns an agent, the two talk with nobody watching) and it was also
// the bound on the session a human launches from the New Agent button and sits in front of — so
// long attended work ended mid-analysis, repeatedly, with the operator right there.
//
// ⚠ THE ISSUER KEY IS `launchDepth`, AND IT IS NOT NEW. `session-launch-op.js` is the only lane
// that may set 0 (the button, a human at the keyboard); everything above it is agent-issued
// through `session-own-launch.js`, which already contains it. This suite pins the three things
// that make the split safe, and each is a way it could silently regress:
//   1. ABSENT IS THE AGENT NUMBER. A resume, a recreate and the peer-triggered responder all pass
//      no depth, and the responder is exactly the two-agent exchange the 24 was written for. A
//      `!= 0` / truthiness spelling here would hand every one of them 200.
//   2. THE SETTING IS THE AUTHORITY, THE ISSUER ONLY PICKS THE FALLBACK. Keying on top of
//      `getTurnCap`'s RESULT would mean a hand-set cap silently means something different
//      depending on who launched — the inversion #1101 item 4b rules out.
//   3. THE CAP RIDES THE BUDGET ACROSS A RESUME. A recreate deliberately does not resurrect a
//      depth it cannot verify, so a 200-turn session that crashed at turn 80 would come back at
//      24 with 80 spent and die on its first `result`. `readCaps` prefers the persisted cap.
//
// METHOD is this directory's: `session-state.js` is pure and is required for real; `getTurnCap`
// and `readCaps` are SLICED from the shipped source and driven with fakes, so nothing here can
// pass against a copy of the logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const state = require("../main/session-state.js");
const { defaultTurnCap, DEFAULT_TURN_CAP, OPERATOR_TURN_CAP, UNLIMITED_TURN_CAP: UNLIMITED } = state;

// ── 1. the issuer split, and its fail-closed direction ───────────────────────

test("depth 0 is the operator's lane; everything else is the agent number", () => {
  assert.equal(defaultTurnCap(0), OPERATOR_TURN_CAP);
  assert.equal(OPERATOR_TURN_CAP, 200, "the ruled operator default");
  assert.equal(DEFAULT_TURN_CAP, 24, "…and the ruled agent-issued default, unchanged");
  for (const depth of [1, 2, 7]) assert.equal(defaultTurnCap(depth), DEFAULT_TURN_CAP, `depth ${depth}`);
});

test("ABSENT IS THE AGENT NUMBER — a lane that names no issuer narrows itself", () => {
  // ⚠ THE SAME DIRECTION `session-own-launch.js` READS THIS FIELD IN. A resume, a recreate, the
  // directive lane and the peer-triggered responder all pass nothing; the responder is the
  // two-agent ping-pong 24 exists for, so widening on absence would remove the bound from the one
  // shape that most needs it.
  for (const depth of [undefined, null, "0", "", false, -1, NaN, {}, 0.0000001]) {
    assert.equal(defaultTurnCap(depth), DEFAULT_TURN_CAP, JSON.stringify(String(depth)));
  }
});

test("ONE STATEMENT OF EACH NUMBER, in session-state.js — nothing retypes them", () => {
  // ⚠ settings.js's own header records that these constants were once TWO copies and that nothing
  // pinned them together. A second literal is how that returns, in a worse shape: the tiering
  // would drift per call site.
  const STATE = M("session-state.js");
  assert.equal((STATE.match(/const OPERATOR_TURN_CAP = 200;/g) || []).length, 1);
  assert.equal((STATE.match(/const DEFAULT_TURN_CAP = 24;/g) || []).length, 1);
  // ⚠ `channel-dir-ipc.js` JOINED THE LIST 2026-09-05: the turn-cap read hands the SPA both
  // documented defaults (the row must NAME them and cannot require session-state.js), which is
  // exactly the place a literal would have been typed instead of imported.
  for (const file of ["settings.js", "session-engine.js", "session-reducer.js", "runtime/claude/launch-spec.js",
    "channel-dir-ipc.js"]) {
    assert.ok(!/(TURN_CAP|turnCap)\s*=\s*(200|24)\b/.test(M(file).replace(/^\s*\/\/.*$/gm, "")),
      `${file} retypes a cap literal instead of importing it`);
  }
});

// ── 2. the setting stays the authority ───────────────────────────────────────

// ⚠ THE SLICE TAKES TWO FUNCTIONS NOW, NOT ONE (2026-09-05, the control's backend). `getTurnCap`
// stopped carrying its own coercion and now calls `readTurnCapSetting`, because the settings ROW
// needs "what did the operator set" (null | 0 | positive) and `getTurnCap` answers "what does a
// session get" — the two differ on exactly the case the control must render, unset vs a typed
// number. Both halves are sliced from the shipped source, so every case below still drives the
// real program and a second copy of the coercion would still be a second program.
const getTurnCap = (stored) => new Function(
  "store", "TURN_CAP_KEY", "defaultTurnCap", "UNLIMITED_TURN_CAP",
  `${fnOf(M("settings.js"), "readTurnCapSetting")}\n${fnOf(M("settings.js"), "getTurnCap")}\n return getTurnCap;`
)({ get: () => stored }, "sessionTurnCap", defaultTurnCap, UNLIMITED);

// The control's own read, sliced the same way: it is what the bridge answers and what the row
// renders, so "unset" and "unlimited" have to stay two different values all the way out.
// ⚠ CURRIED LIKE EVERY HARNESS IN THIS FILE: `readTurnCapSetting(stored)` hands back the
// FUNCTION and the caller invokes it — `readTurnCapSetting(stored)()`. Two cases below
// compared the function itself to a number and failed on the shipped-correct read
// (2026-09-05, first terminal run). The product code was never wrong.
const readTurnCapSetting = (stored) => new Function(
  "store", "TURN_CAP_KEY",
  `${fnOf(M("settings.js"), "readTurnCapSetting")}\n return readTurnCapSetting;`
)({ get: () => stored }, "sessionTurnCap");

// …and the writer, driven against a fake store that records what it was actually asked to do.
const setTurnCap = (stored) => {
  const store = {
    value: stored, wrote: false, deleted: false,
    get: () => store.value,
    set: (_k, v) => { store.wrote = true; store.value = v; },
    delete: () => { store.deleted = true; store.value = undefined; },
  };
  const fn = new Function(
    "store", "TURN_CAP_KEY",
    `${fnOf(M("settings.js"), "readTurnCapSetting")}\n${fnOf(M("settings.js"), "normalizeTurnCapInput")}\n`
    + `${fnOf(M("settings.js"), "setTurnCap")}\n return setTurnCap;`
  )(store, "sessionTurnCap");
  return (value) => ({ answer: fn(value), store: store });
};

test("a set cap wins at BOTH tiers — the issuer keys the FALLBACK, never the result", () => {
  for (const depth of [0, 1, undefined]) {
    assert.equal(getTurnCap(50)(depth), 50, `depth ${String(depth)}: the operator's number, untiered`);
  }
});

test("…and an unset / hand-corrupted store falls through to the issuer's default", () => {
  for (const junk of [undefined, null, "", "   ", "x", NaN, -3, false, {}, []]) {
    assert.equal(getTurnCap(junk)(0), OPERATOR_TURN_CAP, JSON.stringify(junk));
    assert.equal(getTurnCap(junk)(1), DEFAULT_TURN_CAP, JSON.stringify(junk));
  }
});

// ── 9(b): 0 MEANS UNLIMITED ──────────────────────────────────────────────────

test("a 0 the operator SET is unlimited, at both tiers", () => {
  // The whole of 9(b)'s coercion change: `n > 0` used to send this to the default, so the one
  // value a person types to say "stop stopping me" read as an unset key.
  assert.equal(getTurnCap(0)(0), UNLIMITED, "operator-launched");
  assert.equal(getTurnCap(0)(1), UNLIMITED, "…and an agent-issued session the operator unbounded");
  assert.equal(getTurnCap("0")(0), UNLIMITED, "a numeric string from a text box");
});

test("…but only a 0 that IS one: '' / null / false coerce to 0 and must stay 'unset'", () => {
  // ⚠ THE REASON THE RAW VALUE IS READ BY TYPE. Number('') === 0. An empty or hand-mangled key
  // silently unbounding every session on the machine is the failure this shape exists to refuse.
  for (const notZero of ["", "   ", null, false, undefined]) {
    assert.notEqual(getTurnCap(notZero)(0), UNLIMITED, JSON.stringify(notZero));
  }
});

// ── the CONTROL's backend (2026-09-05, #1177 ruling (a), mechanism #1179) ────

test("the control's read keeps UNSET and UNLIMITED apart — the row's whole honesty", () => {
  // ⚠ THIS IS THE ONE THING `getTurnCap` CANNOT ANSWER, and the reason the read is split. Unset
  // means "the issuer-keyed default applies" and 0 means "no cap at all"; a control that showed
  // them as one value would be a control that lies about what the machine is doing.
  assert.equal(readTurnCapSetting(undefined)(), null, "unset");
  assert.equal(readTurnCapSetting(0)(), 0, "unlimited, deliberately set");
  assert.equal(readTurnCapSetting("0")(), 0, "…typed into a text box");
  assert.equal(readTurnCapSetting(50)(), 50);
  assert.equal(readTurnCapSetting("50")(), 50);
  assert.equal(readTurnCapSetting(50.9)(), 50, "floored, exactly as the engine's read floors it");
});

test("…and junk reads as UNSET, never as unlimited", () => {
  // Same list the getter falls through on, asserted at the surface the operator SEES: a
  // hand-mangled key must present as "nothing set", not as an unbounded machine.
  for (const junk of [null, "", "   ", "x", NaN, -3, false, {}, []]) {
    assert.equal(readTurnCapSetting(junk)(), null, JSON.stringify(junk));
  }
});

test("the setter mirrors the reader: what goes in is what comes back out", () => {
  for (const [input, expected] of [[50, 50], ["50", 50], [50.9, 50], [0, 0], ["0", 0], ["  7 ", 7]]) {
    const { answer, store } = setTurnCap(undefined)(input);
    assert.equal(answer, expected, JSON.stringify(input));
    assert.equal(store.value, expected, `${JSON.stringify(input)} reached the store`);
  }
});

test("null and '' DELETE the key — the only way back to the default", () => {
  // ⚠ THE CONTROL MUST BE ABLE TO SEND THIS. Without a delete there is no "unset" to return to,
  // and an operator who typed a number once would be stuck with a number forever.
  for (const clear of [null, "", "   "]) {
    const { answer, store } = setTurnCap(99)(clear);
    assert.equal(answer, null, JSON.stringify(clear));
    assert.ok(store.deleted, `${JSON.stringify(clear)} deleted the key`);
    assert.ok(!store.wrote, `${JSON.stringify(clear)} wrote nothing`);
  }
});

test("junk WRITES NOTHING and answers the value that is still there", () => {
  // ⚠ AN UNRECOGNISED WRITE MUST NOT CLEAR THE OPERATOR'S CAP. Silently unsetting on junk is
  // worse than refusing, because the caller cannot tell it happened; here the answer is the
  // surviving value, which is what lets an optimistic control revert.
  for (const junk of ["x", NaN, -3, false, {}, [], undefined, Infinity]) {
    const { answer, store } = setTurnCap(99)(junk);
    assert.equal(answer, 99, JSON.stringify(junk));
    assert.ok(!store.wrote && !store.deleted, `${JSON.stringify(junk)} touched the store`);
  }
});

test("the store never holds Infinity — 0 is the durable spelling of unlimited", () => {
  // `session-state.js` records why the STATE carries Infinity; the store cannot, because it
  // round-trips through JSON and would read back as null on the next boot.
  const { store } = setTurnCap(undefined)(0);
  assert.equal(store.value, 0);
  assert.ok(Number.isFinite(store.value));
});

test("UNLIMITED survives the state coercion, and no counter can reach it", () => {
  assert.equal(state.initialSessionState({ turnCap: UNLIMITED }).turnCap, UNLIMITED);
  assert.equal(state.turnCapReached({ turns: 0, turnCap: UNLIMITED }), false);
  assert.equal(state.turnCapReached({ turns: 1e9, turnCap: UNLIMITED }), false);
  // ⚠ AND 0 NEVER REACHES THE STATE AS A CAP: `turns >= 0` is true on the first result, so an
  // "unlimited" spelled 0 in here would be the strictest cap there is.
  assert.equal(state.initialSessionState({ turnCap: 0 }).turnCap, DEFAULT_TURN_CAP);
  assert.equal(state.turnCapReached({ turns: 0, turnCap: 0 }), true, "why 0 is not the spelling");
  // Only by identity — junk that merely looks non-finite is still junk.
  for (const junk of [NaN, "Infinity", -Infinity, "unlimited"]) {
    assert.equal(state.initialSessionState({ turnCap: junk }).turnCap, DEFAULT_TURN_CAP, String(junk));
  }
});

test("UNLIMITED is not durable — the record stores 0 and a resume re-reads the setting", () => {
  // `JSON.stringify(Infinity)` is `null`, so it cannot round-trip; `durableSessionRecord` coerces
  // it to 0 = "no stored cap" (pinned in session-store.test.mjs) and `readCaps` falls through to
  // the setting, which is the authority and still says unlimited.
  assert.equal(readCaps({ ...fakeSettings, getTurnCap: () => UNLIMITED })({ turnCap: 0 }).turnCap, UNLIMITED);
});

// ── 3. the cap rides the budget across a resume ──────────────────────────────

const readCaps = (settings) => new Function(
  "settings", `${fnOf(M("session-engine.js"), "readCaps")}\n return readCaps;`
)(settings);

const fakeSettings = { getTurnCap: (d) => defaultTurnCap(d), getIdleTtlMs: () => 900000, getCostCapUsd: () => 0 };

test("a FRESH launch reads the issuer's default", () => {
  assert.equal(readCaps(fakeSettings)({ launchDepth: 0 }).turnCap, OPERATOR_TURN_CAP);
  assert.equal(readCaps(fakeSettings)({}).turnCap, DEFAULT_TURN_CAP);
});

test("a RESUME keeps the cap it was launched under, because it carries no issuer", () => {
  // The regression this exists for: rec.turnCap 200 + rec.turns 80, resumed with no depth. Read
  // the default instead and the session ends with `turn_cap` on its first result event.
  const caps = readCaps(fakeSettings)({ turnCap: 200, turns: 80 });
  assert.equal(caps.turnCap, 200);
});

test("a legacy record (turnCap 0 / absent) reads the default rather than a cap of zero", () => {
  for (const stored of [0, undefined, null, "x", NaN, -1, 1 / 0]) {
    assert.equal(readCaps(fakeSettings)({ turnCap: stored }).turnCap, DEFAULT_TURN_CAP, JSON.stringify(stored));
    assert.equal(readCaps(fakeSettings)({ turnCap: stored, launchDepth: 0 }).turnCap, OPERATOR_TURN_CAP);
  }
});

test("no settings module (harness / early boot) hands in NO caps, exactly as before", () => {
  assert.deepEqual(readCaps(null)({ launchDepth: 0 }), {});
});
