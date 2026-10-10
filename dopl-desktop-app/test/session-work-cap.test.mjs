// THE CONTINUOUS-WORK CAP (main/session-work-cap.js) — "never park mid-work, but do park a runaway"
// (Samuel, 2026-10-10).
//
// THE THREE PROPERTIES, and they are the three the ruling named:
//  - A TOOL LOOP PAST 15 MINUTES STAYS ALIVE. Every live frame re-arms the idle TTL, so the 15-minute
//    number stops being accidentally in charge of "has this one long task finished".
//  - A RUNAWAY PAST THE CAP PARKS. Two hours of UNBROKEN work arms the timer at zero, and the ordinary
//    `idle_timeout` parks the session — resumable, posture and grants intact, exactly as a quiet one parks.
//  - IDLE BETWEEN TURNS STILL PARKS AT 15. A turn END ends the stretch and arms the plain TTL; nothing in
//    this file touches that path.
//
// ⚠ AND THE TRAP IT IS MOSTLY WRITTEN AGAINST: a stale `workSince` from a stretch that parked hours ago
// would make the first frame of the NEXT stretch read as already past the cap and park it instantly, on a
// loop. The clears are pinned here and the unstamped case is pinned to return the FULL cap.
//
// Run: `node --test dopl-desktop-app/test/session-work-cap.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadReducer } from "./_reducer-block.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const cap = createRequire(import.meta.url)(join(MAIN, "session-work-cap.js"));
const { initialSessionState, sessionReducer, idleTimeout, DEFAULT_IDLE_MS } = loadReducer();

const MIN = 60 * 1000;
const T0 = 1_700_000_000_000;
const running = () =>
  sessionReducer(initialSessionState(), { type: "launched", payload: { type: "init" } }).state;

// ── the bound itself ─────────────────────────────────────────────────────────

test("the cap is TWO HOURS, and it is a different number from the idle TTL", () => {
  assert.equal(cap.WORK_CAP_MS, 2 * 60 * 60 * 1000);
  assert.ok(
    cap.WORK_CAP_MS > DEFAULT_IDLE_MS,
    "a cap below the TTL would park every ordinary turn — the two answer different questions"
  );
});

// ── the stretch ──────────────────────────────────────────────────────────────

test("the FIRST live frame starts the stretch and later frames never move it", () => {
  const s = {};
  assert.equal(cap.noteWork(s, T0), T0);
  assert.equal(cap.noteWork(s, T0 + 30 * MIN), T0, "the stretch's start is its first frame, not its last");
  assert.equal(s.workSince, T0);
});

test("a boundary ends the stretch, and is idempotent", () => {
  const s = { workSince: T0 };
  cap.noteBoundary(s);
  assert.equal(s.workSince, null);
  cap.noteBoundary(s);
  assert.equal(s.workSince, null);
  // The next stretch starts from its own first frame rather than inheriting the old age.
  assert.equal(cap.noteWork(s, T0 + 5 * 60 * MIN), T0 + 5 * 60 * MIN);
});

test("an UNSTAMPED session has the WHOLE cap — a missed clear must not park anything", () => {
  assert.equal(cap.capMsLeft({}, T0), cap.WORK_CAP_MS);
  assert.equal(cap.capMsLeft({ workSince: null }, T0), cap.WORK_CAP_MS);
  // ⚠ Junk is an absence, never a confident zero: `Number(null)` is 0, which would read as the epoch.
  for (const junk of [undefined, "", "abc", NaN, Infinity, -1, {}]) {
    assert.equal(cap.capMsLeft({ workSince: junk }, T0), cap.WORK_CAP_MS, `workSince=${String(junk)}`);
  }
  assert.equal(cap.capMsLeft({ workSince: T0 }, undefined), cap.WORK_CAP_MS, "no clock, no claim");
});

test("what is left shrinks with the stretch and clamps at zero", () => {
  const s = { workSince: T0 };
  assert.equal(cap.capMsLeft(s, T0), cap.WORK_CAP_MS);
  assert.equal(cap.capMsLeft(s, T0 + 30 * MIN), cap.WORK_CAP_MS - 30 * MIN);
  assert.equal(cap.capMsLeft(s, T0 + cap.WORK_CAP_MS), 0);
  assert.equal(cap.capMsLeft(s, T0 + 10 * cap.WORK_CAP_MS), 0, "never negative");
});

// ── the three rulings, as arithmetic over the real TTL table ─────────────────

test("A TOOL LOOP PAST 15 MINUTES STAYS ALIVE", () => {
  const st = running();
  const base = idleTimeout(st).ms;
  assert.equal(base, DEFAULT_IDLE_MS);
  const s = { state: st };
  // A frame a minute, for an hour. Every one re-arms the FULL TTL, so the session never reaches it.
  for (let i = 0; i <= 60; i += 1) {
    const ms = cap.workIdleMs(s, base, T0 + i * MIN);
    assert.equal(ms, DEFAULT_IDLE_MS, `minute ${i} must re-arm the full TTL, not count down`);
  }
  assert.equal(s.workSince, T0, "and it is all one stretch");
});

test("A RUNAWAY PAST THE CAP PARKS — the timer is armed at zero", () => {
  const s = { state: running() };
  const base = DEFAULT_IDLE_MS;
  cap.workIdleMs(s, base, T0);
  // Inside the last TTL-width of the cap the re-arm is SHORTENED to what is left, then hits zero.
  assert.equal(cap.workIdleMs(s, base, T0 + cap.WORK_CAP_MS - 5 * MIN), 5 * MIN);
  assert.equal(cap.workIdleMs(s, base, T0 + cap.WORK_CAP_MS), 0);
  assert.equal(cap.workIdleMs(s, base, T0 + cap.WORK_CAP_MS + 60 * MIN), 0);
});

test("the park a spent cap produces is the ORDINARY idle_timeout — resumable, not an end", () => {
  // The engine arms `idleTimeout(state).type` regardless of the clamp, so the cap cannot invent a terminal.
  const st = running();
  assert.equal(idleTimeout(st).type, "idle_timeout");
  const parked = sessionReducer(st, { type: "idle_timeout" }).state;
  assert.equal(parked.phase, "parked");
  assert.equal(parked.parked, true);
  assert.notEqual(parked.phase, "ended", "a cap must never end a slow task");
});

test("IDLE BETWEEN TURNS STILL PARKS AT 15 — a turn end arms the PLAIN TTL", () => {
  // The reducer's `result` emits a bare `scheduleIdle` (no `from`), which the engine does not clamp.
  const r = sessionReducer(running(), { type: "result" });
  assert.deepEqual(r.effects, [{ type: "scheduleIdle" }]);
  assert.equal(r.effects[0].from, undefined, "a turn end is not a work re-arm");
  assert.equal(idleTimeout(r.state).ms, DEFAULT_IDLE_MS);
});

test("a posting turn still gets its LONGER awaiting-peer bound, and the cap only shortens", () => {
  let s = sessionReducer(running(), { type: "outbound_post", payload: { toolUseId: "p1" } }).state;
  s = sessionReducer(s, { type: "result" }).state;
  assert.equal(s.activity, "awaiting_peer");
  const base = idleTimeout(s).ms;
  assert.ok(base > DEFAULT_IDLE_MS, "awaiting_peer is the 4h bound");
  // A fresh stretch cannot lengthen it, and cannot shorten it below what the cap has left either.
  assert.equal(cap.workIdleMs({ state: s }, base, T0), Math.min(base, cap.WORK_CAP_MS));
});

test("a zero or junk base arms zero rather than ignoring the TTL table", () => {
  assert.equal(cap.workIdleMs({}, 0, T0), 0);
  assert.equal(cap.workIdleMs({}, undefined, T0), 0);
  assert.equal(cap.workIdleMs({}, -1, T0), 0);
});
