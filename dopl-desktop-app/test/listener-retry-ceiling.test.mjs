// THE SELF-HEAL HAD A RATE AND NO GIVE-BACK (2026-08-30, the abort-churn incident).
//
// `listener-heal.createReconcileHealer` bounded the workspace-list retry in CONCURRENCY —
// one shared `retryTimer`, so two failure paths could never stack — and not at all in
// DURATION. The delay was a flat `ENUM_RETRY_RECONCILE_MS` (30s) re-armed from the very
// failure it had just produced, so a condition that does not clear on its own (a stale
// cookie the bearer authority cannot rotate, a saturated API, an offline machine) re-ran
// the WHOLE reconcile pass twice a minute for the life of the process — each pass
// re-listing workspaces, re-reading every name cache and re-enumerating every channel,
// and (before the same wave taught `listener-io` to release them) leaving an unread
// `Response` behind on every one of those calls.
//
// `MISS_GIVE_UP_COUNT` had already learned the other half of this lesson on the loop-miss
// path: "at most once per window" is a RATE, and a rate is not a bound on how long you
// keep asking. This suite is that lesson applied to the list path.
//
// ⚠ IT DOES NOT END IN GIVING UP, deliberately — a failed workspace list starves presence,
// push, identity and every channel loop at once, so the self-heal must keep trying. It
// must simply stop treating the tenth consecutive failure as urgently as the first.
//
// `listener-heal.js` is dependency-free on purpose, so this suite `require`s the REAL
// module (no source slicing) and drives it with injected timers and a fake clock.
//
// Run: `node --test dopl-desktop-app/test/listener-retry-ceiling.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require_ = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const heal = require_(join(HERE, "..", "main", "listener-heal.js"));

const {
  createReconcileHealer,
  listRetryDelay,
  ENUM_RETRY_RECONCILE_MS,
  LIST_RETRY_MAX_MS,
} = heal;

// ── The ladder as a truth table ─────────────────────────────────────────────

test("the first failure keeps today's 30s — a blip must still recover fast", () => {
  assert.equal(listRetryDelay(1), ENUM_RETRY_RECONCILE_MS);
  // 0 and a garbage input both read as "the first failure", never as a zero delay.
  assert.equal(listRetryDelay(0), ENUM_RETRY_RECONCILE_MS);
  assert.equal(listRetryDelay(undefined), ENUM_RETRY_RECONCILE_MS);
  assert.equal(listRetryDelay(NaN), ENUM_RETRY_RECONCILE_MS);
});

test("it doubles, and it STOPS at the periodic reconcile's own period", () => {
  assert.equal(listRetryDelay(2), 60_000);
  assert.equal(listRetryDelay(3), 120_000);
  assert.equal(listRetryDelay(4), 240_000);
  assert.equal(listRetryDelay(5), LIST_RETRY_MAX_MS, "300s is the ceiling, not a rung");
  assert.equal(listRetryDelay(50), LIST_RETRY_MAX_MS);
  // The exponent is capped before the multiply, so a long outage cannot produce
  // Infinity (or a NaN out of `Infinity * 0`) and wedge the timer.
  assert.equal(listRetryDelay(5000), LIST_RETRY_MAX_MS);
  assert.ok(Number.isFinite(listRetryDelay(5000)));
});

test("the ceiling is at least the 5-minute periodic reconcile — past it this adds nothing", () => {
  assert.ok(LIST_RETRY_MAX_MS >= 5 * 60 * 1000);
  assert.ok(LIST_RETRY_MAX_MS > ENUM_RETRY_RECONCILE_MS, "a ceiling below the base is a no-op");
});

// ── The healer climbs it, and comes back down on success ────────────────────

function harness() {
  const scheduled = [];
  let seq = 0;
  const timers = {
    setTimeout: (fn, ms) => {
      const t = { id: ++seq, fn, ms };
      scheduled.push(t);
      return t;
    },
    clearTimeout: (t) => {
      const i = scheduled.indexOf(t);
      if (i >= 0) scheduled.splice(i, 1);
    },
  };
  const runs = [];
  const healer = createReconcileHealer({
    run: () => runs.push(1),
    log: () => {},
    now: () => 0,
    timers,
  });
  // Fire the one pending timer, the way the event loop would.
  const fire = () => {
    const t = scheduled.shift();
    if (t) t.fn();
    return t ? t.ms : null;
  };
  return { healer, fire, scheduled, runs };
}

test("consecutive list failures climb the ladder instead of re-arming at 30s forever", () => {
  const { healer, fire } = harness();
  const delays = [];
  for (let i = 0; i < 6; i += 1) {
    healer.onWorkspaceListFailure();
    delays.push(fire());
  }
  assert.deepEqual(delays, [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
});

test("a list that ANSWERS resets the ladder — a backoff that only climbs is a give-up", () => {
  const { healer, fire } = harness();
  healer.onWorkspaceListFailure();
  fire();
  healer.onWorkspaceListFailure();
  assert.equal(fire(), 60_000, "second failure in a row");
  healer.noteWorkspaceListOk();
  healer.onWorkspaceListFailure();
  assert.equal(fire(), 30_000, "the next failure starts from the bottom rung again");
});

test("stop() forgets the ladder, so a restart is the operator's reset", () => {
  const { healer, fire } = harness();
  healer.onWorkspaceListFailure();
  fire();
  healer.onWorkspaceListFailure();
  fire();
  healer.stop();
  healer.onWorkspaceListFailure();
  assert.equal(fire(), 30_000);
});

test("the shared single-flight timer still holds — two paths cannot stack two storms", () => {
  const { healer, scheduled } = harness();
  assert.equal(healer.onWorkspaceListFailure(), true);
  assert.equal(healer.onWorkspaceListFailure(), false, "a second ask while one is pending is refused");
  assert.equal(healer.onEnumerationFailure(3), false, "…including from the OTHER re-ask path");
  assert.equal(scheduled.length, 1);
  assert.equal(healer.pendingRetry(), true);
});

test("the per-workspace enumeration retry is untouched — it was already bounded", () => {
  const { healer, fire } = harness();
  assert.equal(healer.onEnumerationFailure(0), false, "nothing failed, nothing scheduled");
  healer.onEnumerationFailure(2);
  assert.equal(fire(), ENUM_RETRY_RECONCILE_MS, "still the flat base delay");
});

// ── The caller resets it on the one event that proves recovery ──────────────

test("channel-listener calls noteWorkspaceListOk on the path where the list ANSWERED", () => {
  const src = require_("node:fs").readFileSync(
    join(HERE, "..", "main", "channel-listener.js"),
    "utf8"
  );
  const fail = src.indexOf("healer.onWorkspaceListFailure()");
  const ok = src.indexOf("healer.noteWorkspaceListOk()");
  assert.ok(fail > 0 && ok > 0, "both halves must exist — a ladder with no reset never comes down");
  assert.ok(
    fail < ok,
    "the reset must sit AFTER the null-check's early return, or a failure would reset itself"
  );
});
