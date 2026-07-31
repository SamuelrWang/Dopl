// Q12 — the consent watcher's poll cadence, scheduler and rate cap.
//
// The watcher used to run `setInterval(tick, 2000)` forever, at the same rate
// whether the operator had requests pending or (almost always) none. This suite
// pins the adaptive replacement: fast right after activity, asleep otherwise,
// hard-capped, and never able to lose a record by throttling it.
//
// Run: `node --test dopl-desktop-app/test/consent-cadence.test.mjs`
//
// Unlike consent-watcher.test.mjs there is NO source slicing here:
// `main/consent-cadence.js` is deliberately pure (no electron, no store, no
// network, and its clock is always an argument), so the real module is imported.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const cadence = require(join(HERE, "..", "main", "consent-cadence.js"));

const {
  TICK_ACTIVE_MS,
  TICK_IDLE_MS,
  ACTIVE_WINDOW_MS,
  POLL_WINDOW_MS,
  MAX_POLLS_PER_WINDOW,
  nextPollDelay,
  nextScanDelay,
  recentPolls,
  pollAllowed,
  createScheduler,
} = cadence;

// ── nextPollDelay: per-record cadence ────────────────────────────────────────

test("inside the active window a record polls at the fast cadence", () => {
  // A wake / registration / decision just happened: react fast regardless of how
  // long this particular request has been parked.
  assert.equal(nextPollDelay(0, 0), TICK_ACTIVE_MS);
  assert.equal(nextPollDelay(45 * 60_000, 5_000), TICK_ACTIVE_MS);
  assert.equal(nextPollDelay(0, ACTIVE_WINDOW_MS - 1), TICK_ACTIVE_MS);
});

test("outside the active window the ladder backs off (15s -> 30s -> 60s)", () => {
  const idle = ACTIVE_WINDOW_MS; // exactly at the boundary = no longer active
  assert.equal(nextPollDelay(0, idle), 15_000);
  assert.equal(nextPollDelay(4 * 60_000, idle), 15_000);
  assert.equal(nextPollDelay(6 * 60_000, idle), 30_000); // 5–30 min
  assert.equal(nextPollDelay(45 * 60_000, idle), 60_000); // parked long
});

test("with no activity signal at all it goes straight to the ladder", () => {
  // The default is Infinity, i.e. "never any activity" — never the fast path.
  assert.equal(nextPollDelay(0), 15_000);
  assert.equal(nextPollDelay(60 * 60_000), 60_000);
});

test("the ladder is monotonic non-decreasing in elapsed time", () => {
  let prev = 0;
  for (const e of [0, 30_000, 61_000, 200_000, 6 * 60_000, 60 * 60_000]) {
    const d = nextPollDelay(e, Infinity);
    assert.ok(d >= prev, `delay should not decrease at ${e}ms`);
    prev = d;
  }
});

// ── nextScanDelay: the adaptive scan cadence ─────────────────────────────────

test("no records -> the idle cadence (the common case: a scan that does nothing)", () => {
  assert.equal(nextScanDelay(1_000_000, [], 1_000_000), TICK_IDLE_MS);
  // Even immediately after activity: with nothing to poll there is nothing to be
  // fast about. This is what kills the old 1,800-wakeups-an-hour idle burn.
  assert.equal(nextScanDelay(1_000_000, [], 999_999), TICK_IDLE_MS);
});

test("recent activity -> the fast cadence", () => {
  const now = 1_000_000;
  assert.equal(nextScanDelay(now, [now + 99_999], now - 1), TICK_ACTIVE_MS);
  assert.equal(
    nextScanDelay(now, [now + 99_999], now - (ACTIVE_WINDOW_MS - 1)),
    TICK_ACTIVE_MS
  );
});

test("otherwise it sleeps until the soonest record is due", () => {
  const now = 1_000_000;
  const stale = now - ACTIVE_WINDOW_MS;
  assert.equal(nextScanDelay(now, [now + 12_000, now + 25_000], stale), 12_000);
});

test("the sleep is clamped to [fast, idle] — never a busy loop, never a long stall", () => {
  const now = 1_000_000;
  const stale = now - ACTIVE_WINDOW_MS;
  // Overdue / imminent records never drive the scan below the fast cadence.
  assert.equal(nextScanDelay(now, [now - 500_000], stale), TICK_ACTIVE_MS);
  assert.equal(nextScanDelay(now, [now + 1], stale), TICK_ACTIVE_MS);
  // And a far-future record never lets the loop sleep past the idle cadence, so
  // an added or poked record is picked up within TICK_IDLE_MS at worst.
  assert.equal(nextScanDelay(now, [now + 10 * 60_000], stale), TICK_IDLE_MS);
});

// ── The rate cap (F-072: no unbounded poll loops) ────────────────────────────

test("recentPolls prunes anything outside the trailing window", () => {
  const now = 1_000_000;
  const times = [now - POLL_WINDOW_MS - 1, now - POLL_WINDOW_MS, now - 1, now];
  assert.deepEqual(recentPolls(times, now), [now - 1, now]);
});

test("pollAllowed binds at exactly MAX_POLLS_PER_WINDOW", () => {
  const now = 1_000_000;
  const under = Array.from({ length: MAX_POLLS_PER_WINDOW - 1 }, () => now);
  assert.equal(pollAllowed(under, now), true);
  assert.equal(pollAllowed([...under, now], now), false);
});

test("the cap releases as the window slides (it throttles, never wedges)", () => {
  const t0 = 1_000_000;
  const saturated = Array.from({ length: MAX_POLLS_PER_WINDOW }, () => t0);
  assert.equal(pollAllowed(saturated, t0), false);
  // One window later every one of those has aged out.
  assert.equal(pollAllowed(saturated, t0 + POLL_WINDOW_MS), true);
});

// ── createScheduler: the injectable-clock loop ───────────────────────────────

function fakeClock(t0 = 0) {
  let now = t0;
  let seq = 0;
  const timers = new Map(); // handle -> { at, fn }
  return {
    now: () => now,
    setTimer(fn, ms) {
      const h = ++seq;
      timers.set(h, { at: now + ms, fn });
      return h;
    },
    clearTimer(h) {
      timers.delete(h);
    },
    /** Runs every timer due within `ms`, in time order, advancing `now`. */
    advance(ms) {
      const target = now + ms;
      for (let guard = 0; guard < 10_000; guard++) {
        let pick = null;
        for (const [h, t] of timers) {
          if (t.at <= target && (!pick || t.at < pick[1].at)) pick = [h, t];
        }
        if (!pick) break;
        timers.delete(pick[0]);
        now = pick[1].at;
        pick[1].fn();
      }
      now = target;
    },
    armed: () => [...timers.values()].map((t) => t.at),
  };
}

test("start arms exactly one timer at the computed delay", () => {
  const clock = fakeClock(1000);
  const s = createScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayFor: () => 5_000,
    onScan: () => {},
  });
  s.start();
  assert.deepEqual(clock.armed(), [6_000]);
  assert.equal(s.running, true);
});

test("the delay is RECOMPUTED after every scan — this is what makes it adaptive", () => {
  const clock = fakeClock(0);
  const delays = [3_000, 3_000, 30_000, 30_000];
  let i = 0;
  const scans = [];
  const s = createScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayFor: () => delays[Math.min(i, delays.length - 1)],
    onScan: () => {
      scans.push(clock.now());
      i++;
    },
  });
  s.start();
  clock.advance(70_000);
  // 3s, 3s, then the cadence widens to 30s: 3000, 6000, 36000, 66000.
  assert.deepEqual(scans, [3_000, 6_000, 36_000, 66_000]);
});

test("bump() re-arms immediately instead of waiting out an armed idle timer", () => {
  const clock = fakeClock(0);
  let delay = TICK_IDLE_MS;
  const scans = [];
  const s = createScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayFor: () => delay,
    onScan: () => scans.push(clock.now()),
  });
  s.start();
  assert.deepEqual(clock.armed(), [TICK_IDLE_MS]); // a 30s sleep is armed

  clock.advance(1_000); // 29s still to go
  delay = TICK_ACTIVE_MS; // activity arrives (markActivity)
  s.bump();

  // The old 30s timer is GONE, not left running alongside the new one.
  assert.deepEqual(clock.armed(), [1_000 + TICK_ACTIVE_MS]);
  clock.advance(TICK_ACTIVE_MS);
  assert.deepEqual(scans, [4_000]);
});

test("bump() before start does nothing (no timer leaks out of a stopped watcher)", () => {
  const clock = fakeClock(0);
  const s = createScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayFor: () => 5_000,
    onScan: () => {},
  });
  s.bump();
  assert.deepEqual(clock.armed(), []);
});

test("stop() clears the armed timer and stops re-arming", () => {
  const clock = fakeClock(0);
  const scans = [];
  const s = createScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayFor: () => 5_000,
    onScan: () => scans.push(clock.now()),
  });
  s.start();
  clock.advance(5_000);
  assert.equal(scans.length, 1);
  s.stop();
  assert.deepEqual(clock.armed(), []);
  clock.advance(60_000);
  assert.equal(scans.length, 1); // nothing ran after stop
  assert.equal(s.running, false);
});

test("a throwing scan still re-arms (one bad tick must not kill the loop)", () => {
  const clock = fakeClock(0);
  let calls = 0;
  const s = createScheduler({
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    delayFor: () => 5_000,
    onScan: () => {
      calls++;
      if (calls === 1) throw new Error("boom");
    },
  });
  s.start();
  assert.throws(() => clock.advance(5_000), /boom/);
  // The re-arm happens in a `finally`, so the loop survived the throw.
  assert.deepEqual(clock.armed(), [10_000]);
  clock.advance(5_000);
  assert.equal(calls, 2);
});

test("timers are unref'd so the watcher never holds the process open", () => {
  let unrefs = 0;
  const handle = { unref: () => { unrefs++; } };
  const s = createScheduler({
    now: () => 0,
    setTimer: () => handle,
    clearTimer: () => {},
    delayFor: () => 5_000,
    onScan: () => {},
  });
  s.start();
  assert.equal(unrefs, 1);
});

// ── The diet, as arithmetic ──────────────────────────────────────────────────

test("REQUESTS PER HOUR: one record parked for an hour, decided elsewhere", () => {
  // The old ladder, verbatim from git history, so this comparison stays honest.
  const oldDelay = (elapsed) => {
    if (elapsed < 60_000) return 5_000;
    if (elapsed < 5 * 60_000) return 10_000;
    if (elapsed < 30 * 60_000) return 20_000;
    return 60_000;
  };
  const count = (delayFn) => {
    let t = 0;
    let n = 0;
    while (t < 60 * 60_000) {
      t += delayFn(t);
      n++;
    }
    return n;
  };
  const before = count(oldDelay);
  // Activity only at t=0, so the active window covers the first minute.
  const after = count((t) => nextPollDelay(t, t));

  assert.equal(before, 141); // 12 + 24 + 75 + 30
  assert.equal(after, 116); // 20 (fast first minute) + 16 + 50 + 30
  assert.ok(after < before, "the parked-record cost must not go up");
  // Modest on purpose: a record parked for a full hour is the WORST case and a
  // rare one. The first minute even got faster (20 polls vs 12) because that is
  // when a decision actually lands. The real saving is the zero-record case below.
});

test("REQUESTS PER HOUR: the common case is zero records, and it costs nothing", () => {
  // This is the real win. With no pending record the scan makes NO request at
  // all, and the wakeup rate drops from 1,800/h (the old flat 2s interval) to
  // 3,600_000 / TICK_IDLE_MS.
  const oldWakeupsPerHour = (60 * 60_000) / 2_000;
  const newWakeupsPerHour = (60 * 60_000) / nextScanDelay(0, [], 0);
  assert.equal(oldWakeupsPerHour, 1_800);
  assert.equal(newWakeupsPerHour, 120);
});
