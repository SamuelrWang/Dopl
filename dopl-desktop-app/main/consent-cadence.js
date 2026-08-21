// Channels — consent-watcher POLL CADENCE (Q12 request-volume diet, 2026-07-31).
//
// Extracted from consent-watcher.js at the §2 500-line cap. Everything here is
// PURE (no electron, no store, no network, no clock of its own — `now` is always
// an argument), so unlike its parent this module can simply be `require`d by a
// `node --test` file. No source slicing needed.
//
// WHY THIS EXISTS. The watcher used to run `setInterval(tick, 2000)`: 1,800
// wakeups an hour, forever, each one decrypting the auth blob through
// `auth.isSignedIn()` — and that cadence never changed whether the operator had
// three requests waiting or, as is almost always the case, none at all.
//
// The watcher is a FALLBACK. Realtime wakes and the explicit `poke()` calls from
// trigger.js are the primary reaction path, and every in-app decision goes through
// one of them. (session-consent.js was the second poker and is deleted, F-228.) So the design here is: earn the fast cadence
// with recent activity, and otherwise sleep until something is actually due.

// Fast cadence, armed for ACTIVE_WINDOW_MS after a wake / registration / decision.
const TICK_ACTIVE_MS = 3_000;
// Steady state. Also the cap on how long a scan may sleep, so a record's own
// cadence is never delayed by more than this.
const TICK_IDLE_MS = 30_000;
const ACTIVE_WINDOW_MS = 60_000;

// Hard ceiling on consent GETs across ALL records, per trailing minute (the F-072
// rule: no unbounded poll loops). A poll that would exceed it is skipped; nothing
// is settled or dropped, the next scan just retries. Sized well above any
// legitimate load (a couple of pending records at the 3s floor), so it only ever
// binds on a pathological record set.
const POLL_WINDOW_MS = 60_000;
const MAX_POLLS_PER_WINDOW = 60;

// Poll cadence for ONE record. Two inputs, deliberately:
//
//   sinceActivityMs — time since the last wake / registration / decision / poke.
//     Inside the active window we poll at 3s (FASTER than the old flat 5s floor),
//     because that is when a decision is actually likely to land.
//   elapsedMs — how long the request has sat unanswered. Outside the active
//     window the ladder backs off hard (15s → 30s → 60s, was 10s → 20s → 60s):
//     every GET also runs the server's expire-stale sweep, so a tight loop is not
//     free, and a human who has not answered in ten minutes is not answering in
//     the next five seconds.
//
// The default `Infinity` means "no activity signal" → straight to the ladder.
function nextPollDelay(elapsedMs, sinceActivityMs = Infinity) {
  if (sinceActivityMs < ACTIVE_WINDOW_MS) return TICK_ACTIVE_MS;
  if (elapsedMs < 5 * 60_000) return 15_000;
  if (elapsedMs < 30 * 60_000) return 30_000;
  return 60_000;
}

// When the next SCAN should run. Empty record set → the idle cadence (the scan is
// then a pure no-op, which is the overwhelmingly common state). Recent activity →
// the fast cadence. Otherwise sleep until the soonest record is actually due,
// clamped to [TICK_ACTIVE_MS, TICK_IDLE_MS] so the scan never busy-loops and never
// adds more than TICK_IDLE_MS of latency to a record's own cadence.
function nextScanDelay(now, dueAts, lastActivityAt) {
  if (!dueAts.length) return TICK_IDLE_MS;
  if (now - lastActivityAt < ACTIVE_WINDOW_MS) return TICK_ACTIVE_MS;
  let soonest = Infinity;
  for (const at of dueAts) if (at < soonest) soonest = at;
  return Math.min(TICK_IDLE_MS, Math.max(TICK_ACTIVE_MS, soonest - now));
}

// Trailing-window poll times, oldest pruned. Kept as a plain array — the window
// holds at most MAX_POLLS_PER_WINDOW entries, so it never grows.
function recentPolls(times, now) {
  return times.filter((t) => now - t < POLL_WINDOW_MS);
}

// The global rate ceiling. False = skip this poll, keep the record pending.
function pollAllowed(times, now) {
  return recentPolls(times, now).length < MAX_POLLS_PER_WINDOW;
}

// The self-scheduling scan loop, with the clock injected so tests can drive it
// deterministically. `delayFor(now)` is recomputed after EVERY scan — that is what
// makes the cadence adaptive — and `bump()` re-arms immediately so a fresh
// activity signal does not have to wait out an already-armed idle timer.
//
// `onScan` throwing must not kill the loop, hence the try/finally: a scan that
// blows up still re-arms, exactly as the old setInterval would have.
function createScheduler({ now, setTimer, clearTimer, delayFor, onScan }) {
  let handle = null;
  let running = false;
  function clear() {
    if (handle !== null) { clearTimer(handle); handle = null; }
  }
  function arm() {
    clear();
    handle = setTimer(fire, delayFor(now()));
    if (handle && typeof handle.unref === 'function') handle.unref();
  }
  function fire() {
    handle = null;
    try { onScan(); } finally { if (running) arm(); }
  }
  return {
    start() { running = true; arm(); },
    stop() { running = false; clear(); },
    bump() { if (running) arm(); },
    get running() { return running; },
  };
}

module.exports = {
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
};
