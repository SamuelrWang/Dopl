// Tests for the push-transport loop helpers in listener-io.js — the health-gated
// await/idle selection and the interruptible sleep.
//
// THE correctness invariant this file pins: when realtime is UNHEALTHY (or push
// is disabled), every selector collapses to today's held long-poll constants, so
// the channelLoop's await → classify → feed → cursor path is BYTE-FOR-BYTE
// today's behavior. Only when HEALTHY does the loop switch to the cheap catch-up
// (tiny timeoutMs) + a long idle a wake resolves early.
//
// Run: `node --test dopl-desktop-app/test/listener-cheap-await.test.mjs`
//
// WHY SOURCE EXTRACTION: listener-io.js is CommonJS and pulls in electron +
// electron-store, so it cannot be imported under `node --test`. The selectors +
// interruptible sleep are deliberately fenced by BEGIN/END sentinel comments as
// PURE functions (no electron/store/fetch refs; timers injected), so this test
// slices the fenced block and evaluates it verbatim. config.js has no electron
// dep, so the REAL LISTENER/REALTIME constants are required directly to prove
// the fallback selection equals today's held-poll values.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf, between, orderOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const { LISTENER, REALTIME } = require("../main/config.js");
// ⚠ REQUIRED FOR REAL, NOT SLICED (2026-08-30). The two timeout selectors, their named floors
// and `isWakeAbort` moved to `main/listener-budget.js` when this fix could not fit under the
// 500-line cap in listener-io.js — and that module is dependency-free, so the shipped code runs
// here directly instead of being reconstructed from source text.
const budget = require("../main/listener-budget.js");
const { awaitTimeoutFor, fetchTimeoutFor, isWakeAbort } = budget;

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "listener-io.js"), "utf8");
const LOOP = readFileSync(join(HERE, "..", "main", "channel-listener.js"), "utf8");

const BEGIN = "// ─── BEGIN CHEAP-AWAIT";
const END = "// ─── END CHEAP-AWAIT";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN CHEAP-AWAIT sentinel missing");
assert.notEqual(to, -1, "END CHEAP-AWAIT sentinel missing");
assert.ok(to > from, "cheap-await sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { idleWaitFor, sleepOrWake, wakeEntry } = new Function(
  `${BLOCK}\n return { idleWaitFor, sleepOrWake, wakeEntry };`
)();

// ── Health selection: cheap vs held ──────────────────────────────────────────

test("HEALTHY → cheap await + short fetch timeout", () => {
  assert.equal(awaitTimeoutFor(true, 1, 50000), 1);
  assert.equal(fetchTimeoutFor(true, 15000, 58000), 15000);
});

test("UNHEALTHY → the held long-poll timeouts (today's values)", () => {
  assert.equal(awaitTimeoutFor(false, 1, 50000), 50000);
  assert.equal(fetchTimeoutFor(false, 15000, 58000), 58000);
});

test("idle: HEALTHY + caught up → LONG idle; HEALTHY + draining → short gap", () => {
  assert.equal(idleWaitFor(true, false, 400, 300000), 300000, "caught up → wait for a wake");
  assert.equal(idleWaitFor(true, true, 400, 300000), 400, "still draining → page fast");
});

test("idle: UNHEALTHY → today's short IDLE_GAP regardless of drained", () => {
  assert.equal(idleWaitFor(false, false, 400, 300000), 400);
  assert.equal(idleWaitFor(false, true, 400, 300000), 400);
});

// ── Byte-for-byte fallback (the real shipped constants) ──────────────────────
// When unhealthy, awaitOrCheap builds `?timeoutMs=<awaitTimeoutFor>` with a
// fetch-abort of <fetchTimeoutFor>, and idleAfterAwait sleeps <idleWaitFor>.
// Feeding the REAL constants proves those equal today's held long-poll exactly.

test("fallback selection == today's held long-poll constants", () => {
  assert.equal(
    awaitTimeoutFor(false, REALTIME.CHEAP_AWAIT_TIMEOUT_MS, LISTENER.AWAIT_TIMEOUT_MS),
    LISTENER.AWAIT_TIMEOUT_MS
  );
  assert.equal(
    fetchTimeoutFor(false, REALTIME.CHEAP_FETCH_TIMEOUT_MS, LISTENER.AWAIT_FETCH_TIMEOUT_MS),
    LISTENER.AWAIT_FETCH_TIMEOUT_MS
  );
  assert.equal(
    idleWaitFor(false, true, LISTENER.IDLE_GAP_MS, REALTIME.LONG_IDLE_MS),
    LISTENER.IDLE_GAP_MS
  );
  assert.equal(
    idleWaitFor(false, false, LISTENER.IDLE_GAP_MS, REALTIME.LONG_IDLE_MS),
    LISTENER.IDLE_GAP_MS
  );
});

test("cheap await timeout is POSITIVE (the server schema rejects timeoutMs=0)", () => {
  // The /await route's zod schema requires timeoutMs.positive(); a 0 would 400.
  assert.ok(REALTIME.CHEAP_AWAIT_TIMEOUT_MS > 0);
  assert.ok(REALTIME.CHEAP_AWAIT_TIMEOUT_MS < LISTENER.AWAIT_TIMEOUT_MS);
});

// ── THE NAMED FLOORS (regression: 17 GB dev RSS, 2026-08-30) ─────────────────
// Both selectors used to hand their argument through untouched, so a config value
// that arrived as 0 / NaN / undefined produced a DIFFERENT FAILURE rather than a
// shorter hold — and neither of the two announces itself in a log:
//   * timeoutMs=0 fails the route's `.positive()` schema, so every poll 400s and
//     the channel lives on backoff() forever;
//   * a falsy FETCH budget makes sendOnce skip its AbortController timer entirely
//     (`timeoutMs ? setTimeout(…) : null`), so ONE hung request holds that
//     channel's loop for the life of the process, silently.

test("FLOOR: an unusable await budget becomes the floor, never a falsy timeout", () => {
  for (const bad of [0, -1, NaN, undefined, null, "", "nope"]) {
    assert.equal(awaitTimeoutFor(true, bad, 50000), 1, `healthy/${String(bad)}`);
    assert.equal(awaitTimeoutFor(false, 1, bad), 1, `unhealthy/${String(bad)}`);
  }
});

test("FLOOR: an unusable FETCH budget can never disarm sendOnce's abort timer", () => {
  for (const bad of [0, -1, NaN, undefined, null, 999]) {
    assert.ok(fetchTimeoutFor(true, bad, 58000) >= 1000, `healthy/${String(bad)}`);
    assert.ok(fetchTimeoutFor(false, 15000, bad) >= 1000, `unhealthy/${String(bad)}`);
  }
});

test("FLOOR: today's four shipped budgets pass through the clamp UNCHANGED", () => {
  // The floors must be a guard, not a retune — every real value is already above them.
  assert.equal(
    awaitTimeoutFor(true, REALTIME.CHEAP_AWAIT_TIMEOUT_MS, LISTENER.AWAIT_TIMEOUT_MS),
    REALTIME.CHEAP_AWAIT_TIMEOUT_MS
  );
  assert.equal(
    awaitTimeoutFor(false, REALTIME.CHEAP_AWAIT_TIMEOUT_MS, LISTENER.AWAIT_TIMEOUT_MS),
    LISTENER.AWAIT_TIMEOUT_MS
  );
  assert.equal(
    fetchTimeoutFor(true, REALTIME.CHEAP_FETCH_TIMEOUT_MS, LISTENER.AWAIT_FETCH_TIMEOUT_MS),
    REALTIME.CHEAP_FETCH_TIMEOUT_MS
  );
  assert.equal(
    fetchTimeoutFor(false, REALTIME.CHEAP_FETCH_TIMEOUT_MS, LISTENER.AWAIT_FETCH_TIMEOUT_MS),
    LISTENER.AWAIT_FETCH_TIMEOUT_MS
  );
});

test("FLOOR: timeoutMs=1 is the DESIGN on the cheap path, not a collapsed budget", () => {
  // ⚠ THE POINT OF THIS PIN IS TO STOP THE NEXT READER "FIXING" IT. A `timeoutMs=1`
  // in the server log is the push transport working: it is the smallest value the
  // route schema accepts, chosen so a healthy socket gets a single-DB-read catch-up
  // with no held serverless function, paired with the wake-interruptible LONG_IDLE.
  // Raising the await floor above 1 would break that, not repair it.
  assert.equal(REALTIME.CHEAP_AWAIT_TIMEOUT_MS, 1);
  assert.equal(awaitTimeoutFor(true, REALTIME.CHEAP_AWAIT_TIMEOUT_MS, LISTENER.AWAIT_TIMEOUT_MS), 1);
});

// ── Backstop: the caught-up idle is the SHORT one that bounds missed-wake latency
// The v2.2 fix shortened LONG_IDLE_MS from 5min to <=45s so a push that connects
// but silently drops a wake still surfaces via this caught-up re-poll in <=45s.
// The healthy+caught-up path must select exactly this constant (wake-interruptible).

test("caught-up-healthy idle uses the SHORT backstop constant (<=45s), not ~5min", () => {
  assert.ok(REALTIME.LONG_IDLE_MS <= 45_000, "worst-case missed-wake latency is bounded to <=45s");
  assert.ok(REALTIME.LONG_IDLE_MS < 5 * 60 * 1000, "shortened from the old 5-min idle");
  // The caught-up-healthy branch (drained=false) selects LONG_IDLE_MS verbatim.
  assert.equal(
    idleWaitFor(true, false, LISTENER.IDLE_GAP_MS, REALTIME.LONG_IDLE_MS),
    REALTIME.LONG_IDLE_MS
  );
});

// ── Interruptible sleep ──────────────────────────────────────────────────────

function fakeTimers() {
  let fired = null;
  return {
    setTimeout: (fn) => { fired = fn; return 7; },
    clearTimeout: () => { fired = null; },
    fire: () => { const fn = fired; if (fn) fn(); },
    pending: () => fired !== null,
  };
}

test("sleepOrWake resolves EARLY when the entry is woken", async () => {
  const T = fakeTimers();
  const entry = {};
  let resolved = false;
  const p = sleepOrWake(entry, 5_000_000, T).then(() => { resolved = true; });
  assert.equal(typeof entry.sleepWaker, "function", "waker parked on the entry");
  assert.equal(resolved, false, "does not resolve before the wake");
  wakeEntry(entry); // realtime INSERT wake
  await p;
  assert.equal(resolved, true);
  assert.equal(entry.sleepWaker, null, "waker cleared after resolving");
  assert.equal(T.pending(), false, "timer cleared on early resolve");
});

test("sleepOrWake resolves on its timer when NOT woken", async () => {
  const T = fakeTimers();
  const entry = {};
  let resolved = false;
  const p = sleepOrWake(entry, 5_000_000, T).then(() => { resolved = true; });
  assert.equal(resolved, false);
  T.fire(); // the idle elapsed
  await p;
  assert.equal(resolved, true);
  assert.equal(entry.sleepWaker, null);
});

test("wakeEntry also aborts an in-flight await and is safe when idle", () => {
  let aborted = false;
  const entry = { awaitCtrl: { abort: () => { aborted = true; } } };
  wakeEntry(entry);
  assert.equal(aborted, true, "in-flight cheap await is aborted for fast catch-up");
  assert.equal(entry.dirty, true, "dirty flag set to coalesce the catch-up");
  // No throw on an entry with nothing in flight / undefined entry.
  wakeEntry({});
  wakeEntry(undefined);
});

test("a second wake after the sleep already resolved is a no-op", async () => {
  const T = fakeTimers();
  const entry = {};
  const p = sleepOrWake(entry, 5_000_000, T);
  wakeEntry(entry);
  await p;
  // sleepWaker is null now; a stray wake must not throw.
  wakeEntry(entry);
  assert.equal(entry.sleepWaker, null);
});

// ── THE ABORT DISCRIMINATION (regression: 17 GB dev RSS, 2026-08-30) ─────────
//
// `channelLoop` treated EVERY AbortError as "normal long-poll turnover" and
// re-awaited with no delay. That was written for the HELD poll, where
// AWAIT_FETCH_TIMEOUT_MS (58s) is deliberately LONGER than the server's 50s hold,
// so the server always answers first and an abort really was a wake.
//
// It is wrong on the CHEAP path, which is the normal one whenever push is healthy:
// there CHEAP_FETCH_TIMEOUT_MS (15s) sits under a route whose own ceiling is 60s,
// so a merely SLOW server blows our budget while it is still working. Re-polling
// at zero delay then sets the loop's rate to the SERVER'S LATENCY instead of the
// 45s idle — every channel re-issues the instant it gives up, each abandoned
// request leaves the server still executing it, and the set converges on whatever
// rate keeps the server exactly slow enough to keep aborting. Self-sustaining,
// and it never backs off.
//
// The discriminator is OWNERSHIP: `awaitCtrl` is the loop's own controller and only
// wakeEntry/wake abort it, while the fetch budget aborts sendOnce's private one.

test("BUDGET: a WAKE re-polls now; our own expired budget does NOT", () => {
  // The real shipped classifier, driven directly. Both paths reject with the SAME
  // AbortError, so the discriminator has to be OWNERSHIP: `signal` is channelLoop's own
  // per-iteration controller, aborted only by wakeEntry/wake, while the fetch budget
  // aborts sendOnce's separate private controller this signal never sees.
  const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
  assert.equal(isWakeAbort(abort, { aborted: true }), true, "a wake: catch up NOW");
  assert.equal(isWakeAbort(abort, { aborted: false }), false, "our budget: take the ladder");
  assert.equal(isWakeAbort(abort, undefined), false, "no signal is not a wake");
  assert.equal(isWakeAbort(new Error("ECONNRESET"), { aborted: true }), false,
    "a network error is not a wake, whatever the signal says");
  assert.equal(isWakeAbort(null, { aborted: true }), false);
});

test("BUDGET: channelLoop asks isWakeAbort — the undiscriminated continue is gone", () => {
  // The regression itself: `if (err && err.name === 'AbortError') continue;` — one branch
  // for two events, and the zero-delay half won.
  const fn = fnOf(LOOP, "channelLoop");
  assert.ok(
    !/name === 'AbortError'\) continue;/.test(fn),
    "an AbortError may no longer take a single undiscriminated zero-delay continue"
  );
  assert.match(fn, /if \(io\.isWakeAbort\(err, awaitCtrl\.signal, entry\.channel\.id\)\) continue;/);
  const branch = between(fn, "io.isWakeAbort", "if (res.status === 404)", "channelLoop catch");
  assert.match(branch, /await backoff\(entry\)/,
    "everything that is NOT a wake takes the capped-exponential ladder");
  assert.ok(
    orderOf(branch, "io.isWakeAbort", "await backoff(entry)", "channelLoop catch"),
    "the wake check comes FIRST, so a wake is never delayed by the ladder"
  );
  assert.match(fnOf(SRC, "isWakeAbort"), /diag\('await budget expired'/,
    "listener-io wraps the pure decision so a blown budget leaves a log line");
});

test("BUDGET: the fetch budget still outlives the HELD hold, so a held poll never aborts", () => {
  // The property the old comment was true under, and the reason the wake half stays.
  assert.ok(
    LISTENER.AWAIT_FETCH_TIMEOUT_MS > LISTENER.AWAIT_TIMEOUT_MS,
    "the server's clean timedOut:true must beat our AbortController on the held path"
  );
});

test("LEAK: channelLoop releases the bodies its error branches never read", () => {
  // An unread undici Response pins its socket (api-repair.js › discardBody). The
  // leaking branches are the ERROR branches — the ones a saturated server puts
  // every watched channel on at once.
  const fn = fnOf(LOOP, "channelLoop");
  assert.match(fn, /if \(!res\.ok\) io\.discardBody\(res\);/,
    "every non-ok response is released once, before the branches that abandon it");
  assert.ok(
    orderOf(fn, "io.discardBody(res)", "if (res.status === 404)", "channelLoop"),
    "the release must precede the returns that abandon the body"
  );
  assert.match(SRC, /\bdiscardBody,/, "listener-io must re-export it for the loop");
});
