// SESSION HEALTH (main/session-health.js) — "is this agent GETTING ANYWHERE", 2026-09-01
// (T25 / T50 / T51 / T83).
//
// ── WHAT THE FLAG IS FOR ────────────────────────────────────────────────────────────────
// Two live sessions reported `working · thinking` for sixteen minutes with zero output, and
// nothing in `read_sessions` could tell an orchestrator that from an agent doing a long piece of
// work. The three conditions below are what separates them, and the cases here drive each one
// ALONE — a suite that only proved the conjunction would not notice a condition being dropped,
// which is exactly how a flag becomes noise.
//
// ⚠ THE CLOCK IS INJECTED. `stale` is the only derivation in this module that reads one, and a
// case that used the real clock could only ever test one side of the bound.
//
// The block is source-extracted below its sentinel — `pillState` is injected REAL from
// `main/session-pill.js`, so these cases drive one program rather than a slice plus a stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "session-health.js"), "utf8");
const { pillState } = require(join(MAIN, "session-pill.js"));

const BEGIN = "// ─── BEGIN SESSION-HEALTH-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf("module.exports = {");
assert.notEqual(from, -1, "BEGIN SESSION-HEALTH-PURE sentinel missing");
assert.ok(to > from, "module.exports not found after the sentinel");
const BLOCK = SRC.slice(from, to);

// The purity assertion IS a test: it is what makes "this module reaches nothing" a fact rather
// than a docblock.
for (const banned of ["require(", "electron", "child_process", "fetch(", "@anthropic"]) {
  assert.ok(!BLOCK.includes(banned), `the extracted block must not reference ${banned}`);
}

const h = new Function(
  "pillState",
  `${BLOCK}\n return { STALE_QUIET_MS, countOrNull, lastSpokeAt, tokensSinceLastPost, isStale, health };`
)(pillState);

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

/** A live WORKING session, as the engine holds one. */
function working(over = {}) {
  return {
    state: { phase: "running", activity: "working", parked: false },
    startedAt: NOW - 60 * MINUTE,
    tokensSpent: 50_000,
    ...over,
  };
}

// ── 1. THE THREE CONDITIONS, EACH ALONE ──────────────────────────────────────────────────

test("STALE: working + quiet past the bound + still spending is the only true", () => {
  assert.equal(h.isStale(working(), NOW), true);
});

test("STALE: an IDLE or ENDED session is never stale — it is not stuck, it is between turns", () => {
  // ⚠ THE CONDITION THAT MATTERS MOST, because a session at rest is the common shape: an agent
  // that finished, said nothing and is waiting to be addressed has spent tokens and is quiet,
  // which is two of the three, and flagging it would fire on nearly every session on the machine.
  for (const state of [
    { phase: "running", activity: "idle", parked: false },
    { phase: "parked", activity: "parked", parked: true },
    { phase: "ended", activity: "idle", parked: false },
  ]) {
    assert.equal(h.isStale(working({ state }), NOW), false, JSON.stringify(state));
  }
});

test("STALE: quiet but NOT spending is a healthy agent, not a wedged one", () => {
  // It posted, then went quiet, and has burned nothing since. That is an agent waiting.
  assert.equal(
    h.isStale(working({ lastOwnPostAt: NOW - 60 * MINUTE, tokensAtLastPost: 50_000 }), NOW),
    false
  );
});

test("STALE: spending but RECENTLY SPOKEN is an agent doing its job out loud", () => {
  assert.equal(
    h.isStale(working({ lastOwnPostAt: NOW - MINUTE, tokensAtLastPost: 10_000 }), NOW),
    false
  );
});

test("STALE: the bound is exclusive at exactly ten minutes, and true just past it", () => {
  const at = (ms) => h.isStale(working({ lastOwnPostAt: NOW - ms, tokensAtLastPost: 0 }), NOW);
  assert.equal(h.STALE_QUIET_MS, 10 * MINUTE);
  assert.equal(at(h.STALE_QUIET_MS), false, "exactly at the bound is not past it");
  assert.equal(at(h.STALE_QUIET_MS + 1), true);
});

test("STALE: an UNMEASURED spend withholds the claim — it does not assert one", () => {
  // ⚠ THE FAIL-SAFE DIRECTION FOR AN ASSERTION ABOUT SOMEBODY'S AGENT IS TO WITHHOLD IT.
  // "Nothing told me what this costs" is not evidence that it is stuck.
  for (const tokensSpent of [undefined, null, NaN, -1, "50000"]) {
    assert.equal(h.isStale(working({ tokensSpent }), NOW), false, String(tokensSpent));
  }
});

test("STALE: with no clock basis at all it says nothing rather than guessing", () => {
  assert.equal(h.isStale(working({ startedAt: undefined, lastOwnPostAt: undefined }), NOW), false);
});

// ── 2. THE QUIET WINDOW'S BASIS ──────────────────────────────────────────────────────────

test("QUIET: measured from the last post, and from the START when it never posted", () => {
  // ⚠ THE FALLBACK IS THE WHOLE POINT: the session the ticket is about is the one that launched,
  // went quiet and was still reported `working` a quarter of an hour later. Falling back to
  // `now` would make exactly that case unflaggable forever.
  assert.equal(h.lastSpokeAt({ startedAt: 100, lastOwnPostAt: 500 }), 500);
  assert.equal(h.lastSpokeAt({ startedAt: 100 }), 100);
  assert.equal(h.lastSpokeAt({}), null);
  assert.equal(h.lastSpokeAt(null), null);
});

// ── 3. THE TOKEN DELTA ───────────────────────────────────────────────────────────────────

test("DELTA: it is the spend since this session last SAID something", () => {
  assert.equal(h.tokensSinceLastPost({ tokensSpent: 90_000, tokensAtLastPost: 50_000 }), 40_000);
});

test("DELTA: a session that never posted reports its WHOLE spend — everything bought nothing", () => {
  assert.equal(h.tokensSinceLastPost({ tokensSpent: 90_000 }), 90_000);
});

test("DELTA: unmeasured in, null out — never a confident zero", () => {
  for (const v of [undefined, null, "", NaN, Infinity, -1, {}]) {
    assert.equal(h.tokensSinceLastPost({ tokensSpent: v }), null, String(v));
  }
});

test("DELTA: it is clamped at zero — a resumed run must not report a negative spend", () => {
  assert.equal(h.tokensSinceLastPost({ tokensSpent: 10, tokensAtLastPost: 900 }), 0);
});

// ── 4. THE PROJECTION HALF ───────────────────────────────────────────────────────────────

test("HEALTH: every count is null until something measures it, and `stale` is a boolean", () => {
  // ⚠ `deniedCalls: 0` WOULD BE THE WORST OF THE ZEROES: it says "nothing was refused", which is
  // a claim no machine made. Absence is what the render prints nothing for.
  assert.deepEqual(h.health({}, NOW), {
    turns: null,
    tokensDelta: null,
    stale: false,
    deniedCalls: null,
    lastDeniedTool: null,
    lastWakeSeq: null,
    lastWakeAt: null,
  });
});

test("HEALTH: it carries the six facts off the session object, unchanged", () => {
  const s = working({
    turns: 12,
    tokensSpent: 90_000,
    tokensAtLastPost: 50_000,
    deniedCalls: 4,
    lastDeniedTool: "Bash",
    lastWakeSeq: 861,
    lastWakeAt: NOW - MINUTE,
  });
  assert.deepEqual(h.health(s, NOW), {
    turns: 12,
    tokensDelta: 40_000,
    stale: true,
    deniedCalls: 4,
    lastDeniedTool: "Bash",
    lastWakeSeq: 861,
    lastWakeAt: NOW - MINUTE,
  });
});

test("HEALTH: a non-string denied tool is absence, not a coerced label", () => {
  for (const v of [7, {}, [], true, ""]) {
    assert.equal(h.health({ lastDeniedTool: v }, NOW).lastDeniedTool, null, String(v));
  }
});

// ── 5. THE RULE THIS FILE RESTATES ───────────────────────────────────────────────────────

test("NULL: `countOrNull` agrees with `session-metrics.js › metricOrNull` value for value", () => {
  // ⚠ THE BLOCK MAY HOLD NO REQUIRE, so the rule is RESTATED rather than imported — which is
  // exactly the shape that drifts. Driven, not grepped. Same pin `session-telemetry.js` takes.
  const { metricOrNull } = require(join(MAIN, "session-metrics.js"));
  for (const v of [0, 1, 84_000, -1, -0.5, null, undefined, "", "7", NaN, Infinity, {}, [], true]) {
    assert.equal(h.countOrNull(v), metricOrNull(v), `disagreement on ${String(v)}`);
  }
});

// ── 6. THE STAMPS THIS MODULE READS ARE WRITTEN WHERE THE FACT IS ────────────────────────
//
// ⚠ NOTHING HERE STARTS A COUNTER, and the four writers are asserted rather than assumed: a
// field read here whose writer was deleted reads as "never measured" forever, silently.

test("WRITERS: each of the four stamps has exactly one producer, at the site that knows the fact", () => {
  const src = (f) => readFileSync(join(MAIN, f), "utf8");
  // A `result` IS a completed turn — the normalizer's own vocabulary.
  assert.match(src("session-io.js"), /s\.turns = \(Number\(s\.turns\) \|\| 0\) \+ 1;/);
  // The ONE place a post is minted, so "it spoke" and "when it spoke" cannot drift apart.
  const tag = src("session-outbound-tag.js");
  assert.match(tag, /s\.lastOwnPostAt = Date\.now\(\);/);
  assert.match(tag, /s\.tokensAtLastPost = Number\(s\.tokensSpent\) \|\| 0;/);
  // The denial ledger, beside the deny it counts.
  assert.match(src("session-windowless.js"), /s\.deniedCalls = \(Number\(s\.deniedCalls\) \|\| 0\) \+ 1;/);
  // The wake ACK, at delivery and on the VERDICT — never re-derived from the body.
  const gate = src("session-gate.js");
  assert.match(gate, /a\.wake === true && typeof a\.seq === 'number'/);
  assert.match(gate, /s\.lastWakeSeq = a\.seq;/);
});
