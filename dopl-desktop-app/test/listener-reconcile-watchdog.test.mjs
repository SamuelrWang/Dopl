// THE LISTENER'S SINGLE-FLIGHT GUARD HAD NO DEADLINE, SO ONE HUNG PASS TURNED IT OFF FOR THE
// LIFE OF THE PROCESS (2026-09-14, Samuel's "neither agent woke" report).
//
// WHAT THE MACHINE ACTUALLY DID, from `~/Library/Application Support/dopl-desktop/listener.log`:
// after the 09:11:00.4Z boot the process logged `presence: started`,
// `realtime directives ARMED — rejoining` and `realtime health … subs=0/0 want=0`, and then NOT
// ONE reconcile line for the following nine hours — no `namecache loaded`, no `reconcile:` diag
// of any kind, `want=0` on every subsequent health line, zero channel loops. The `start()` pass
// never settled (the API was not answering in that window; the same second logged
// `version gate: floor fetch failed`), `reconciling` stayed non-null, and every later caller —
// the 5-minute interval, `wake()` on four powerMonitor resumes, `restart()` — took the
// `if (reconciling) return reconciling;` line and awaited a promise that never resolves.
//
// THE CONSEQUENCE IS THE BUG REPORT. A message posted into that channel at 18:28:32Z reached NO
// agent on the machine — not the one the server had named in `recipient_agent_ids`, not the one
// the author actually tagged, not by fan-out — because nothing was watching the channel. The
// server's verdict is a STORED ANSWER a machine executes (INVARIANTS §5 › THE DELIVERY
// KEYSTONE), and there was no machine listening to execute it.
//
// ⚠ WHY A DEADLINE ON THE GUARD RATHER THAN TIMEOUTS INSIDE `reconcileInner`. Every recovery path
// in that module funnels through the guard — `listener-heal.js`'s healer only heals a pass that
// RAN and answered badly, and `wake()`/`restart()` both call `reconcile()` — so the guard is the
// one place where "the pass is never coming back" is observable at all. Per-await timeouts would
// have to be exhaustive to be sufficient; a deadline on the guard is sufficient by construction.
//
// ⚠ WHY `watchPass` LIVES IN `listener-heal.js`. `channel-listener.js` was sitting at 499 of the
// 500-line cap, and the seam is real rather than arithmetic: that module is already the listener's
// self-heal (the loop-miss window, the enumeration retry ladder, the `want=0` re-apply), it is
// dependency-free, and being dependency-free is what lets this suite drive the REAL function
// instead of slicing source out of a module that requires electron.
//
// Run: `node --test dopl-desktop-app/test/listener-reconcile-watchdog.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const heal = require_(join(MAIN, "listener-heal.js"));
const { watchPass, RECONCILE_WATCHDOG_MS } = heal;

/** A hand-driven clock, so a three-minute deadline costs no wall time and no flake. */
function clock() {
  let seq = 0;
  const armed = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++seq;
        armed.set(id, { fn, at: ms });
        // ⚠ The shape `watchPass` calls `.unref()` on — a bare number would throw there, and the
        // production timer really does get unref'd, so the fake must be able to take it.
        return { id, unref() { this.unrefd = true; return this; } };
      },
      clearTimeout: (t) => { if (t) armed.delete(t.id); },
    },
    fire: () => { for (const [id, t] of [...armed]) { armed.delete(id); t.fn(); } },
    pending: () => armed.size,
  };
}

/** `channel-listener.js › reconcile` in miniature: the guard, the catch, and `watchPass`
 *  between them. ⚠ The SHIPPED `watchPass` is the subject; only the caller is restated, and it
 *  is restated because the real one cannot be loaded without electron. */
function guard() {
  const c = clock();
  const logged = [];
  const errors = [];
  const settlers = [];
  let reconciling = null;
  function reconcile() {
    if (reconciling) return reconciling;
    reconciling = watchPass(
      new Promise((resolve, reject) => settlers.push({ resolve, reject }))
        .catch((e) => errors.push(String(e && e.message))),
      (ms) => logged.push(`RELEASING the single-flight guard after ${ms / 1000}s`),
      RECONCILE_WATCHDOG_MS,
      c.timers
    ).then(() => { reconciling = null; });
    return reconciling;
  }
  return {
    reconcile,
    clock: c,
    logged,
    errors,
    starts: () => settlers.length,
    pending: () => reconciling !== null,
    finish: (i = settlers.length - 1) => settlers[i].resolve(),
    fail: (e, i = settlers.length - 1) => settlers[i].reject(e),
  };
}

test("a pass that never settles RELEASES the guard, so the next tick runs", async () => {
  const g = guard();
  const first = g.reconcile();
  assert.equal(g.starts(), 1);
  // Coalescing is the behaviour being PRESERVED, not traded away — M1 is still real.
  g.reconcile();
  assert.equal(g.starts(), 1, "a concurrent caller must still coalesce onto the in-flight pass");

  g.clock.fire();
  await first;

  assert.equal(g.pending(), false, "the guard must be clear once the deadline trips");
  // 🔒 THE WHOLE REGRESSION: before the fix this stayed 1 for the life of the process.
  g.reconcile();
  assert.equal(g.starts(), 2, "the next reconcile must actually start a pass");
});

test("tripping the watchdog says so — a wedged listener must never be silent", async () => {
  const g = guard();
  const first = g.reconcile();
  g.clock.fire();
  await first;
  // `status()` answers "watching 0 channels" for a wedged listener AND for a signed-out one, so
  // the log line is the only thing that can tell an operator — or a later reader of
  // listener.log — which of the two happened. That is how this bug went nine hours unnoticed.
  assert.match(g.logged.join("\n"), /RELEASING the single-flight guard/);
});

test("a pass that finishes normally clears the guard and leaves no armed timer", async () => {
  const g = guard();
  const p = g.reconcile();
  g.finish();
  await p;
  assert.equal(g.pending(), false);
  assert.equal(g.logged.length, 0, "a healthy pass must not log the watchdog line");
  // 🔒 CLEARED, NOT LEFT TO FIRE. An un-cleared watchdog per pass is a timer leak on a function
  // that runs every five minutes for the life of the app.
  assert.equal(g.clock.pending(), 0, "the watchdog must be cleared when the pass wins the race");
});

test("a THROWING pass still clears the guard, and its error still surfaces", async () => {
  const g = guard();
  const p = g.reconcile();
  g.fail(new Error("listWorkspaces exploded"));
  await p;
  assert.equal(g.pending(), false);
  assert.match(g.errors.join("\n"), /listWorkspaces exploded/);
  assert.equal(g.clock.pending(), 0);
});

/**
 * 🔒 ABANDONED, NOT CANCELLED — the cost this fix knowingly accepts.
 *
 * The hung pass is still out there and may settle later, beside a newer one. That is the M1
 * re-entrancy the guard was built for, and it is defended a layer down: `channel-listener.js`
 * re-checks `loops.get(id)` immediately before creating a loop, and the crash handler
 * compare-and-deletes. This case exists so the next reader finds the trade STATED rather than
 * inferring it from a silence — and so a future "fix" that tries to reject the abandoned promise
 * has to argue with a test: an unhandled rejection in the main process is a worse failure than
 * the brief overlap it would be warning about.
 */
test("the abandoned pass settling later is harmless — no throw, no second release", async () => {
  const g = guard();
  const first = g.reconcile();
  g.clock.fire();
  await first;
  const second = g.reconcile();
  g.finish(0); // the ABANDONED pass — #0, not the live one — finally answers
  assert.equal(g.pending(), true, "the second pass's own guard must be untouched by it");
  assert.equal(g.errors.length, 0);
  // …and the live pass still settles on its own terms.
  g.finish(1);
  await second;
  assert.equal(g.pending(), false);
});

/**
 * 🔒 THE BOUND IS A DEADLOCK DETECTOR, NOT A LATENCY BUDGET.
 *
 * A healthy cold pass enumerates every workspace and refreshes each name cache serially — ~14s
 * across 13 workspaces on the incident machine (the 08:48:58Z–08:49:12Z `namecache loaded` run).
 * A bound anywhere near that would abandon working passes and start overlapping them, which is
 * the M1 hazard on purpose rather than by accident.
 */
test("the deadline is well clear of a slow-but-working pass", () => {
  assert.ok(
    RECONCILE_WATCHDOG_MS >= 60_000,
    `RECONCILE_WATCHDOG_MS is ${RECONCILE_WATCHDOG_MS}ms — a cold pass measured ~14s, and a ` +
      "bound near that turns the watchdog into a source of overlapping reconciles"
  );
});

/** And the caller is actually wired to it — a helper nothing calls fixes nothing. */
test("🔒 channel-listener's reconcile guard goes through watchPass", () => {
  const src = readFileSync(join(MAIN, "channel-listener.js"), "utf8");
  assert.match(src, /reconciling = heal\.watchPass\(/);
});
