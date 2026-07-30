// AUDIT F8 — the `launched` branch must respect the inbound gate's phase, like every other flip.
//
// gatePhase (main/session-reducer.js) is the rule that a PENDING inbound card WINS the displayed
// status: while a card waits, `phase` stays 'awaiting_inbound' (the pill reads "Message waiting")
// and `activity` carries the truth. Every other phase flip routes through it — the permission
// branches, the turn-end, the park. The `launched` branch set 'running' flat.
//
// That matters on exactly the path the v2.5 gate created: a parked shell holds an inbound card,
// the operator's Accept lazily resumes the SDK, and the resumed query's system/init fires
// `launched`. The card is still unanswered when a queued reply sits behind the head, so the pill
// flipped from "Message waiting" to "Working" under the operator — and the persist effect wrote
// the same clobbered phase to the durable record.
//
// SOURCE EXTRACTION: the reducer's BEGIN/END sentinel block, evaluated verbatim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-reducer.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-REDUCER");
const to = SRC.indexOf("// ─── END SESSION-REDUCER");
assert.ok(from !== -1 && to > from, "SESSION-REDUCER sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

const { initialSessionState, sessionReducer } = new Function(
  `${BLOCK}\n return { initialSessionState, sessionReducer };`
)();

const launched = (state) => sessionReducer(state, { type: "launched", payload: { type: "init", model: "m" } });
const findEff = (effects, type) => effects.find((e) => e.type === type);

// ── the bug ──────────────────────────────────────────────────────────────────────

test("F8: a HELD inbound card keeps the phase when a resumed SDK boots", () => {
  const s0 = { ...initialSessionState(), hasPendingInbound: true };
  const { state, effects } = launched(s0);
  assert.equal(state.phase, "awaiting_inbound", 'the pill must keep reading "Message waiting"');
  assert.equal(findEff(effects, "persist").phase, "awaiting_inbound", "and the record must agree with it");
});

test("F8: the card's phase survives even when the session was parked before the wake", () => {
  const s0 = { ...initialSessionState(), hasPendingInbound: true, parked: true, phase: "awaiting_inbound" };
  // `launched` is not one of the events a parked session ignores (FIX #5), so it lands here.
  const { state } = launched(s0);
  assert.equal(state.phase, "awaiting_inbound");
});

// ── everything else is unchanged ─────────────────────────────────────────────────

test("F8: with no card waiting, launched still flips launching -> running", () => {
  const { state, effects } = launched(initialSessionState());
  assert.equal(state.phase, "running");
  assert.equal(findEff(effects, "persist").phase, "running");
  assert.deepEqual(
    effects.map((e) => e.type),
    ["persist", "emit", "lifecycle", "scheduleIdle"],
    "the effect set is untouched"
  );
  assert.equal(findEff(effects, "lifecycle").kind, "task_started");
});

test("F8: the persisted phase and the state phase can never disagree", () => {
  for (const hasPendingInbound of [true, false]) {
    const { state, effects } = launched({ ...initialSessionState(), hasPendingInbound });
    assert.equal(findEff(effects, "persist").phase, state.phase);
  }
});

test("F8: both phases route through gatePhase in the shipped source", () => {
  const at = BLOCK.indexOf("if (type === 'launched')");
  assert.notEqual(at, -1, "the launched branch moved");
  const branch = BLOCK.slice(at, BLOCK.indexOf("\n  }", at));
  assert.ok(!/phase: 'running'/.test(branch), "no bare 'running' may remain in the branch");
  assert.ok(branch.includes("gatePhase(state, 'running')"), "the branch asks the gate for its phase");
});
