// THE CHAINED-LAUNCH BUDGET and THE INBOUND DIRECTION-RATE BOUND — the two backstops Samuel's
// 2026-08-31 rulings demanded, driven with an injected clock.
//
// ⚠ ONE FILE FOR BOTH, DELIBERATELY. They are two instances of the SAME shape (a rolling window,
// per key, refusing past a ceiling, recording nothing on a refusal) added on the same day for the
// same reason: a bound that could not be a DEPTH had to be a RATE. Keeping the cases side by side
// is what will stop the two drifting into different ideas of what "rolling" means.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");
const budget = require_(join(MAIN, "launch-budget.js"));
const rate = require_(join(MAIN, "direction-rate.js"));

const CH = "ch-1";
const AGENT = "k3wpf7c5";
const T0 = 1_700_000_000_000;

// ── THE CHAINED-LAUNCH BUDGET ────────────────────────────────────────────────────

test("BUDGET: it admits up to the ceiling and refuses past it, inside the window", () => {
  budget.resetForTests();
  for (let i = 0; i < budget.MAX_CHAINED_LAUNCHES; i += 1) {
    assert.equal(budget.spend(CH, T0 + i), true, `spend ${i}`);
  }
  assert.equal(budget.spend(CH, T0 + budget.MAX_CHAINED_LAUNCHES), false);
});

test("BUDGET: a REFUSAL records nothing, so a channel at the ceiling can recover", () => {
  // ⚠ THE FAILURE THIS FORBIDS: if a refused spend pushed the window forward, a channel under a
  // tight loop would be permanently at its ceiling — the loop would keep it there by failing.
  budget.resetForTests();
  for (let i = 0; i < budget.MAX_CHAINED_LAUNCHES; i += 1) budget.spend(CH, T0);
  for (let i = 0; i < 50; i += 1) assert.equal(budget.spend(CH, T0 + 1000 + i), false);
  assert.equal(budget.spentIn(CH, T0), budget.MAX_CHAINED_LAUNCHES, "still exactly the ceiling");
  // …and the oldest stamp ageing out is what gives one back.
  assert.equal(budget.spend(CH, T0 + budget.WINDOW_MS + 1), true);
});

test("BUDGET: the window ROLLS — it is not a bucket that resets at a boundary", () => {
  // ⚠ A FIXED BUCKET LETS A LOOP SPEND THE WHOLE ALLOWANCE TWICE AT THE BOUNDARY, which is twice
  // the rate at exactly the moment it matters.
  budget.resetForTests();
  for (let i = 0; i < budget.MAX_CHAINED_LAUNCHES; i += 1) budget.spend(CH, T0 + i);
  // One tick BEFORE the oldest ages out, nothing is available.
  assert.equal(budget.spend(CH, T0 + budget.WINDOW_MS - 1), false);
  // The moment it does, EXACTLY ONE is — not the whole allowance, which is the difference
  // between a rolling window and a bucket.
  assert.equal(budget.spend(CH, T0 + budget.WINDOW_MS), true);
  assert.equal(budget.spend(CH, T0 + budget.WINDOW_MS), false);
});

test("BUDGET: PER CHANNEL — one busy room cannot starve another", () => {
  budget.resetForTests();
  for (let i = 0; i < budget.MAX_CHAINED_LAUNCHES; i += 1) budget.spend(CH, T0 + i);
  assert.equal(budget.spend(CH, T0), false);
  assert.equal(budget.spend("ch-2", T0), true);
});

test("BUDGET: an uncountable spend is REFUSED, and reading never records", () => {
  budget.resetForTests();
  assert.equal(budget.spend("", T0), false, "no channel id ⇒ nothing to bound ⇒ no");
  assert.equal(budget.spend(null, T0), false);
  assert.equal(budget.spentIn(CH, T0), 0, "…and none of that was recorded");
  budget.spend(CH, T0);
  assert.equal(budget.spentIn(CH, T0), 1);
  assert.equal(budget.spentIn(CH, T0), 1, "reading twice is still one");
});

test("BUDGET: the channel map is BOUNDED — an unbounded one leaks for the process's life", () => {
  budget.resetForTests();
  for (let i = 0; i < budget.MAX_TRACKED_CHANNELS + 20; i += 1) budget.spend(`ch-${i}`, T0);
  // The eviction costs at worst one channel a fresh budget, never a refusal it should not have
  // had — so what is asserted is the bound, not which key survived.
  assert.equal(budget.spend(`ch-${budget.MAX_TRACKED_CHANNELS + 100}`, T0), true);
});

test("BUDGET: the ceiling is stated in terms of what the machine can actually run", () => {
  // ⚠ NOT DERIVED IN CODE, deliberately (a `2 * 6` would tie a COST ceiling to a RATE ceiling and
  // move one when the other is tuned) — but the RELATIONSHIP is the justification, so it is
  // asserted here where a future retune will read it.
  const windowless = require_(join(MAIN, "session-windowless.js"));
  assert.ok(budget.MAX_CHAINED_LAUNCHES > windowless.MAX_CONCURRENT_SESSIONS,
    "a budget below the machine's own concurrency ceiling would refuse a legitimate first wave");
  assert.ok(budget.WINDOW_MS >= 60_000, "a window under a minute bounds nothing a turn cannot beat");
});

// ── THE INBOUND DIRECTION-RATE BOUND ─────────────────────────────────────────────

test("RATE: it admits up to the ceiling per TARGET agent and refuses past it", () => {
  rate.resetForTests();
  for (let i = 0; i < rate.MAX_DIRECTIONS; i += 1) {
    assert.equal(rate.admit(AGENT, T0 + i), true, `direction ${i}`);
  }
  assert.equal(rate.admit(AGENT, T0 + rate.MAX_DIRECTIONS), false);
  assert.equal(rate.admit("zz11yy22", T0), true, "a different session is unaffected");
});

test("RATE: a REFUSAL records nothing, and the window rolls", () => {
  rate.resetForTests();
  for (let i = 0; i < rate.MAX_DIRECTIONS; i += 1) rate.admit(AGENT, T0);
  for (let i = 0; i < 20; i += 1) assert.equal(rate.admit(AGENT, T0 + 100 + i), false);
  assert.equal(rate.receivedIn(AGENT, T0), rate.MAX_DIRECTIONS);
  assert.equal(rate.admit(AGENT, T0 + rate.WINDOW_MS + 1), true);
});

test("RATE: an uncountable delivery is REFUSED — the one this exists to stop", () => {
  rate.resetForTests();
  assert.equal(rate.admit("", T0), false);
  assert.equal(rate.admit(null, T0), false);
  assert.equal(rate.receivedIn("", T0), 0);
});

test("RATE: the agent map is bounded, and its slack is above the live-session ceiling", () => {
  const windowless = require_(join(MAIN, "session-windowless.js"));
  assert.ok(rate.MAX_TRACKED_AGENTS > windowless.MAX_CONCURRENT_SESSIONS,
    "a live session must never be evicted from the ledger by its own siblings");
  rate.resetForTests();
  for (let i = 0; i < rate.MAX_TRACKED_AGENTS + 20; i += 1) rate.admit(`a${i}`.padEnd(8, "z"), T0);
  assert.equal(rate.admit("zzzzzzzz", T0), true);
});

test("RATE: the ceiling is loose enough for real work and tight enough for a loop", () => {
  // A hop costs a whole TURN, so a legitimate supervisor correcting one worker a few times during
  // a piece of work never sees this; a tight loop reaches it in seconds.
  assert.ok(rate.MAX_DIRECTIONS >= 3 && rate.MAX_DIRECTIONS <= 12);
  assert.ok(rate.WINDOW_MS >= 60_000);
});
