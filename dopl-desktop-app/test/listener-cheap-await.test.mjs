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

const require = createRequire(import.meta.url);
const { LISTENER, REALTIME } = require("../main/config.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "listener-io.js"), "utf8");

const BEGIN = "// ─── BEGIN CHEAP-AWAIT";
const END = "// ─── END CHEAP-AWAIT";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN CHEAP-AWAIT sentinel missing");
assert.notEqual(to, -1, "END CHEAP-AWAIT sentinel missing");
assert.ok(to > from, "cheap-await sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { awaitTimeoutFor, fetchTimeoutFor, idleWaitFor, sleepOrWake, wakeEntry } =
  new Function(
    `${BLOCK}\n return { awaitTimeoutFor, fetchTimeoutFor, idleWaitFor, sleepOrWake, wakeEntry };`
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
