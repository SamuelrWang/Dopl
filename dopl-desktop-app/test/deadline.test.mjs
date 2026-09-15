// THE ONE BOUND FOR AN AWAIT THAT MAY NEVER SETTLE (2026-09-15, F-700).
//
// F-698 bounded the refresh POST and watchdogged the two single-flight guards, and the
// 08:22:33Z boot still wedged: Electron's stdout carried `Network service crashed or was
// terminated, restarting service.` at that second, and `presence: superseding the in-flight
// beat` arrived at 08:23:05 — the first beat still in flight after THIRTY seconds, with no
// `reconcile:` / `namecache loaded` / `session-state push` line after it. The remaining
// unbounded await on every request path was Chromium's cookie store, whose in-flight
// `cookies.get` promise the crashed network service can simply drop.
//
// `main/deadline.js` is dependency-free, so this suite drives the REAL shipped function with a
// hand-driven clock rather than a source-sliced copy.
//
// Run: `node --test dopl-desktop-app/test/deadline.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const { withDeadline, DEADLINE } = createRequire(import.meta.url)(join(MAIN, "deadline.js"));

/** A hand-driven clock: `fire()` runs every armed, uncleared deadline. */
function fakeTimers() {
  const armed = [];
  return {
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false, unreffed: false, unref() { this.unreffed = true; } }; armed.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    armed,
    // ⚠ A REAL `setTimeout` FIRES ONCE. Marking it spent here is what makes "onDeadline is
    // called once" a claim about the code rather than about this fake.
    fire: () => { for (const t of armed) if (!t.cleared) { t.cleared = true; t.fn(); } },
  };
}

test("a promise that settles first RESOLVES THROUGH — the value is the store's own answer", async () => {
  const timers = fakeTimers();
  const jar = [{ name: "sb-x-auth-token", value: "v" }];
  const got = await withDeadline(Promise.resolve(jar), 5000, () => { throw new Error("must not fire"); }, timers);
  assert.equal(got, jar, "the winner's value is handed back, not a copy or a sentinel");
  assert.notEqual(got, DEADLINE);
});

test("a promise that never settles resolves the DEADLINE SENTINEL — which is how '' is told from 'never answered'", async () => {
  const timers = fakeTimers();
  const never = new Promise(() => {});
  const pending = withDeadline(never, 5000, () => {}, timers);
  assert.equal(timers.armed.length, 1, "one deadline armed");
  assert.equal(timers.armed[0].ms, 5000);
  timers.fire();
  assert.equal(await pending, DEADLINE);
});

// ⚠ The empty array is the case the sentinel exists for: a signed-out jar legitimately answers
// `[]`, so a falsy/empty return could never have meant "the store is gone".
test("an EMPTY answer is not a timeout — the sentinel is identity, not falsiness", async () => {
  const timers = fakeTimers();
  const got = await withDeadline(Promise.resolve([]), 5000, () => {}, timers);
  assert.deepEqual(got, []);
  assert.notEqual(got, DEADLINE);
});

test("the timer is CLEARED when the promise wins — a 5s timer per cookie read, left armed, is the leak", async () => {
  const timers = fakeTimers();
  await withDeadline(Promise.resolve("ok"), 5000, () => {}, timers);
  assert.equal(timers.armed.length, 1);
  assert.equal(timers.armed[0].cleared, true, "cleared on the resolve path");
  assert.equal(timers.armed[0].unreffed, true, "and unref'd, so a pending deadline never holds the quit path open");
});

test("the timer is cleared on the REJECT path too, and the rejection passes through untouched", async () => {
  const timers = fakeTimers();
  const boom = new Error("cookie store threw");
  await assert.rejects(
    withDeadline(Promise.reject(boom), 5000, () => {}, timers),
    (err) => err === boom
  );
  assert.equal(timers.armed[0].cleared, true);
});

test("onDeadline is called ONCE, with the deadline, and only on the timeout path", async () => {
  const timers = fakeTimers();
  const calls = [];
  const pending = withDeadline(new Promise(() => {}), 5000, (ms) => calls.push(ms), timers);
  timers.fire();
  timers.fire(); // a second sweep must not re-run a fired (and now cleared) deadline
  await pending;
  assert.deepEqual(calls, [5000], "one call, carrying the deadline it tripped");
});

// ⚠ The logger is diag in production. A diag that throws must not convert a bounded wait back
// into an unbounded one — same try/finally shape as `listener-heal.js › watchPass`.
// ⚠ AND THE THROW DOES NOT ESCAPE THE TIMER CALLBACK: in the main process there is no caller
// to catch it there, so a `finally` (watchPass's shape) would trade a wedge for an
// uncaughtException. `fire()` re-throws whatever the callback throws, so this asserts both.
test("a THROWING onDeadline still resolves the sentinel, and never escapes the timer", async () => {
  const timers = fakeTimers();
  const pending = withDeadline(new Promise(() => {}), 5000, () => { throw new Error("diag exploded"); }, timers);
  timers.fire();
  assert.equal(await pending, DEADLINE);
});

test("a non-promise value is accepted (Promise.resolve wraps it) and never arms a live wait", async () => {
  const timers = fakeTimers();
  assert.equal(await withDeadline("plain", 5000, () => {}, timers), "plain");
  assert.equal(timers.armed[0].cleared, true);
});
