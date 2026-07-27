// Unit tests for the pure load-lifecycle core of main/load-guard.js.
//
// Unlike classify/tool-profiles/task-notify (which source-extract to dodge an
// electron require at module top), load-guard.js keeps its Electron use entirely
// inside `createLoadGuard` — the window is injected, nothing is require()d at the
// top — so the pure reducer (`decideLoad`) and the backoff schedule
// (`nextBackoffMs`) import directly. The imperative shell (timers, webContents
// calls) is the Electron boundary and is intentionally NOT covered here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { decideLoad, nextBackoffMs, WATCHDOG_MS } from "../main/load-guard.js";

const S = (attempt, remotePainted) => ({ attempt, remotePainted });
const step = (state, event) => decideLoad(state, event);

// ── Backoff schedule: 0s, 2s, 5s, then every 10s ──────────────────────────────

test("backoff schedule is 0s, 2s, 5s, then a 10s ceiling", () => {
  assert.equal(nextBackoffMs(0), 0);
  assert.equal(nextBackoffMs(1), 2000);
  assert.equal(nextBackoffMs(2), 5000);
  assert.equal(nextBackoffMs(3), 10000);
});

test("backoff holds the 10s ceiling for all later attempts", () => {
  for (const n of [4, 5, 10, 42, 1000]) assert.equal(nextBackoffMs(n), 10000);
});

test("backoff treats attempt 0 and any negative as immediate", () => {
  assert.equal(nextBackoffMs(0), 0);
  assert.equal(nextBackoffMs(-1), 0);
  assert.equal(nextBackoffMs(-7), 0);
});

test("backoff is monotonic non-decreasing", () => {
  let prev = -1;
  for (let n = 0; n <= 12; n++) {
    const v = nextBackoffMs(n);
    assert.ok(v >= prev, `attempt ${n} (${v}) < previous (${prev})`);
    prev = v;
  }
});

test("watchdog fires under the multi-minute OS TCP timeout it exists to beat", () => {
  assert.ok(WATCHDOG_MS >= 8000 && WATCHDOG_MS <= 15000, `WATCHDOG_MS=${WATCHDOG_MS}`);
});

// ── 'start': show loading only before the first remote paint ───────────────────

test("start on a never-painted window shows the loading screen and loads", () => {
  const { state, effect } = step(S(0, false), "start");
  assert.equal(effect.render, "loading");
  assert.equal(effect.load, true);
  assert.equal(effect.armWatchdog, true);
  assert.equal(effect.dropConnections, false);
  assert.equal(state.remotePainted, false);
});

test("start on an already-painted window loads without a loading flash", () => {
  // Chromium holds the current remote frame during the fetch, so no local screen.
  const { effect } = step(S(0, true), "start");
  assert.equal(effect.render, null);
  assert.equal(effect.load, true);
  assert.equal(effect.armWatchdog, true);
});

// ── 'finish': success resets the retry counter and marks painted ──────────────

test("finish marks remote painted and clears the attempt counter", () => {
  const { state, effect } = step(S(3, false), "finish");
  assert.equal(state.remotePainted, true);
  assert.equal(state.attempt, 0);
  assert.equal(effect.load, false);
  assert.equal(effect.armWatchdog, false);
  assert.equal(effect.render, null);
  assert.equal(effect.retryInMs, null);
});

// ── 'fail': show offline AND auto-retry (the old dead end) ────────────────────

test("fail shows the offline screen and schedules a backoff retry", () => {
  const { state, effect } = step(S(0, false), "fail");
  assert.equal(effect.render, "offline");
  assert.equal(effect.retryInMs, 2000); // attempt 0 -> next is attempt 1 -> 2s
  assert.equal(state.attempt, 1);
});

test("fail never drops connections (a fast failure has no dead sockets to clear)", () => {
  const { effect } = step(S(2, true), "fail");
  assert.equal(effect.dropConnections, false);
  assert.equal(effect.stopLoad, false);
  assert.equal(effect.retryInMs, nextBackoffMs(3));
});

// ── 'watchdog': stop, drop pools, keep loading up, retry ──────────────────────

test("watchdog stops the hung load, drops both pools, and retries on backoff", () => {
  const { state, effect } = step(S(0, false), "watchdog");
  assert.equal(effect.stopLoad, true);
  assert.equal(effect.dropConnections, true);
  assert.equal(effect.retryInMs, 2000);
  assert.equal(state.attempt, 1);
  assert.equal(effect.render, "loading"); // never painted -> keep loading screen up
});

test("watchdog on a painted window drops pools but keeps the last frame", () => {
  const { effect } = step(S(1, true), "watchdog");
  assert.equal(effect.dropConnections, true);
  assert.equal(effect.render, null); // don't flash loading over a working page
  assert.equal(effect.retryInMs, nextBackoffMs(2));
});

test("only watchdog drops connections; start/finish/fail/kick/gone do not", () => {
  for (const ev of ["start", "finish", "fail", "kick", "gone"]) {
    assert.equal(step(S(0, false), ev).effect.dropConnections, false, `${ev} dropped connections`);
  }
  assert.equal(step(S(0, false), "watchdog").effect.dropConnections, true);
});

// ── 'gone': renderer crash → rebuild through the guard ────────────────────────

test("gone reloads from scratch and forgets the prior paint", () => {
  const { state, effect } = step(S(2, true), "gone");
  assert.equal(effect.render, "loading");
  assert.equal(effect.load, true);
  assert.equal(effect.armWatchdog, true);
  assert.equal(state.remotePainted, false);
  assert.equal(state.attempt, 0);
});

// ── 'kick' (wake): retry a stalled load, leave a healthy window alone ─────────

test("kick on a painted window is a no-op", () => {
  const { effect } = step(S(0, true), "kick");
  assert.equal(effect.load, false);
  assert.equal(effect.render, null);
  assert.equal(effect.armWatchdog, false);
});

test("kick on a never-painted window retries the load immediately", () => {
  const { effect } = step(S(1, false), "kick");
  assert.equal(effect.render, "loading");
  assert.equal(effect.load, true);
  assert.equal(effect.armWatchdog, true);
  assert.equal(effect.retryInMs, null); // immediate, not backoff-delayed
});

// ── Unknown events are inert ──────────────────────────────────────────────────

test("an unknown event changes nothing and does nothing", () => {
  const { state, effect } = step(S(4, true), "???");
  assert.deepEqual(state, S(4, true));
  assert.deepEqual(effect, {
    render: null, load: false, armWatchdog: false,
    stopLoad: false, dropConnections: false, retryInMs: null,
  });
});

// ── Integration walks over the reducer ────────────────────────────────────────

test("walk: a hung first load recovers to painted content", () => {
  let s = S(0, false);
  let r = step(s, "start"); // fresh load
  assert.equal(r.effect.render, "loading");
  s = r.state;

  r = step(s, "watchdog"); // hung -> stop+drop+retry
  assert.equal(r.effect.dropConnections, true);
  assert.equal(r.effect.retryInMs, 2000);
  assert.equal(r.state.attempt, 1);
  s = r.state;

  r = step(s, "start"); // the scheduled retry
  assert.equal(r.effect.render, "loading"); // still not painted
  s = r.state;

  r = step(s, "finish"); // remote paints
  assert.equal(r.state.remotePainted, true);
  assert.equal(r.state.attempt, 0);
  s = r.state;

  // A wake nudge on the now-healthy window does nothing.
  assert.equal(step(s, "kick").effect.load, false);
});

test("walk: repeated fast failures escalate 2s -> 5s -> 10s", () => {
  let s = S(0, false);
  const delays = [];
  for (let i = 0; i < 4; i++) {
    const r = step(s, "fail");
    delays.push(r.effect.retryInMs);
    assert.equal(r.effect.render, "offline");
    s = step(r.state, "start").state; // the retry attempt fires
  }
  assert.deepEqual(delays, [2000, 5000, 10000, 10000]);
});

test("walk: a successful reload after paint resets the backoff", () => {
  let s = S(2, true); // previously painted, 2 failed attempts
  let r = step(s, "fail");
  assert.equal(r.state.attempt, 3);
  s = step(r.state, "finish").state;
  assert.equal(s.attempt, 0, "finish must clear the retry counter");
});
