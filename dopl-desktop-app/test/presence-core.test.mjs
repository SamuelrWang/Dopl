// PRESENCE — the loop that decides whether Samuel's own dot is lit.
//
// ⚠ THIS FILE EXISTS BECAUSE `main/presence.js` HAD NO TEST AND COULD NOT HAVE ONE. It required
// `./api` → `./auth` → `electron`, so the module that carried the operator's online state was
// the one module `node --test` could not import. The loop is now `main/presence-core.js`, a pure
// injectable factory, and every clock in it is injected — so these cases drive real time-outs,
// real aborts and a real 30-minute idle in microseconds.
//
// THE FOUR FAILURE POINTS SAMUEL'S REPORT BOUGHT (2026-09-08 — "sometimes i see myself go
// offline, even though my computer is on and dopl is open"), one describe apiece:
//   1. N serial posts per tick        → ONE user-scoped post per tick
//   2. a skipped tick while in flight → ABORT the predecessor, never skip
//   3. a 401 dropping the whole cycle → a 401 costs its own beat and nothing else
//   4. no idle/sleep/lock semantics   → posture computed per tick + immediate `away`

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MODULE_PATH = join(HERE, "..", "main", "presence-core.js");
const {
  createPresence,
  HEARTBEAT_MS,
  JITTER_MS,
  IDLE_AWAY_MS,
  UNAVAILABLE_BACKOFF_MS,
  RETRY_AFTER_MS,
  ALL_PATH,
  ONE_PATH,
} = require(MODULE_PATH);

const WS = ["ws-a", "ws-b", "ws-c"];

/** A recording transport. `plan` maps a path to a status (or a function of the call). */
function harness(plan = {}, opts = {}) {
  const calls = [];
  const timers = [];
  let clock = opts.startAt ?? 1_000_000;
  const state = {
    signedIn: opts.signedIn ?? true,
    idle: opts.idle ?? 0, // seconds
  };

  const apiFetch = async (path, o) => {
    const call = {
      path,
      status: o.body && o.body.status,
      workspaceId: o.workspaceId,
      timeoutMs: o.timeoutMs,
      signal: o.signal,
      aborted: false,
    };
    calls.push(call);
    const entry = plan[path];
    const resolved = typeof entry === "function" ? entry(call, calls) : entry;
    if (resolved && typeof resolved.then === "function") return resolved;
    if (resolved instanceof Error) throw resolved;
    if (resolved && resolved.hang) {
      // Stay pending until the caller's signal aborts — the real slow-network shape.
      return new Promise((_resolve, reject) => {
        if (!o.signal) return; // hangs forever; the test must not await it
        o.signal.addEventListener("abort", () => {
          call.aborted = true;
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    const status = resolved ?? 200;
    return { status, ok: status >= 200 && status < 300, body: null, bodyUsed: true };
  };

  const presence = createPresence({
    apiFetch,
    discardBody: (r) => r,
    isSignedIn: () => state.signedIn,
    idleSeconds: () => state.idle,
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, at: clock + ms, cancelled: false, unref() { return this; } };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => { if (t) t.cancelled = true; },
    diag: () => {},
    random: opts.random ?? (() => 0.5), // 0.5 → zero jitter, so cadence is assertable
  });

  return {
    presence,
    calls,
    state,
    paths: () => calls.map((c) => c.path),
    statuses: () => calls.map((c) => c.status),
    advance(ms) {
      clock += ms;
      for (const t of [...timers]) {
        if (!t.cancelled && t.at <= clock) { t.cancelled = true; t.fn(); }
      }
    },
    pendingDelays: () =>
      timers.filter((t) => !t.cancelled).map((t) => t.at - clock),
  };
}

// ── (1) ONE POST PER TICK ────────────────────────────────────────────────────

test("ONE POST PER TICK: 13 containers, one request — not one per container", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.presence.setWorkspaces(Array.from({ length: 13 }, (_, i) => `ws-${i}`));
  await h.presence._beat();
  assert.deepEqual(h.paths(), [ALL_PATH]);
  // ⚠ THE WHOLE BUG IN ONE ASSERTION: the old loop made 13 serial calls here, each with a 12s
  // timeout, on a 30s interval — so the cycle could not finish inside its own period.
  assert.equal(h.calls.length, 1);
});

test("the user-scoped post carries NO workspace header — it is not a workspace operation", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.presence.setWorkspaces(WS);
  await h.presence._beat();
  assert.equal(h.calls[0].workspaceId, undefined);
});

test("404 on the user-scoped arm falls back to the per-workspace loop IN PARALLEL", async () => {
  const seen = [];
  const h = harness({
    [ALL_PATH]: 404,
    [ONE_PATH]: (call) => { seen.push(call.workspaceId); return 200; },
  });
  h.presence.setWorkspaces(WS);
  await h.presence._beat();
  assert.deepEqual(seen, WS);
  // ⚠ PARALLEL IS THE POINT, and it is provable from the transport alone: `Promise.allSettled`
  // dispatches every call before any resolves, so all three are recorded before the first
  // await settles. A serial walk could not have three entries here.
  assert.equal(h.calls.filter((c) => c.path === ONE_PATH).length, 3);
});

test("the /all 404 is BACKED OFF, not latched — it is retried after the backoff", async () => {
  let allStatus = 404;
  const h = harness({
    [ALL_PATH]: () => allStatus,
    [ONE_PATH]: 200,
  });
  h.presence.setWorkspaces(WS);
  await h.presence._beat();
  h.calls.length = 0;
  await h.presence._beat();
  assert.deepEqual(h.paths(), [ONE_PATH, ONE_PATH, ONE_PATH], "still on the fallback");

  allStatus = 200;
  h.advance(UNAVAILABLE_BACKOFF_MS + 1);
  h.calls.length = 0;
  await h.presence._beat();
  assert.deepEqual(h.paths(), [ALL_PATH], "the applied migration is picked up without a restart");
});

test("ONE 404 among many per-workspace posts does NOT back the feature off", async () => {
  const h = harness({
    [ALL_PATH]: 404,
    [ONE_PATH]: (call) => (call.workspaceId === "ws-b" ? 404 : 200),
  });
  h.presence.setWorkspaces(WS);
  await h.presence._beat();
  h.calls.length = 0;
  await h.presence._beat();
  assert.ok(h.paths().includes(ONE_PATH), "a per-container 404 is not a per-feature answer");
});

// ── (2) ABORT, NEVER SKIP ────────────────────────────────────────────────────

test("ABORT-NOT-SKIP: a tick while one is in flight supersedes it and still sends", async () => {
  const h = harness({ [ALL_PATH]: (call, calls) => (calls.length === 1 ? { hang: true } : 200) });
  h.presence.setWorkspaces(WS);
  const first = h.presence._beat();
  assert.equal(h.calls.length, 1, "the first beat is in flight");

  const second = await h.presence._beat();
  // ⚠ THE OLD CODE RETURNED HERE WITHOUT SENDING (`if (beating) return`), so a slow beat
  // guaranteed the NEXT one never happened either and rows aged out exactly when the network
  // was already unhappy. A skipped beat is the failure; a duplicated one never was.
  assert.equal(second, "ok");
  assert.equal(h.calls.length, 2, "the successor SENT rather than skipping");
  assert.equal(h.calls[0].aborted, true, "the predecessor was aborted, not awaited");
  assert.equal(await first, "aborted");
});

test("the caller's abort signal is FORWARDED to the transport on every beat", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  await h.presence._beat();
  assert.ok(h.calls[0].signal, "no signal means abort-not-skip cannot work at all");
  assert.equal(h.calls[0].signal.aborted, false);
});

test("an aborted beat schedules NO retry — the cancellation was deliberate", async () => {
  const h = harness({ [ALL_PATH]: (call, calls) => (calls.length === 1 ? { hang: true } : 200) });
  const first = h.presence._beat();
  await h.presence._beat();
  await first;
  h.calls.length = 0;
  h.advance(RETRY_AFTER_MS * 3);
  assert.equal(h.calls.length, 0);
});

test("a NETWORK failure retries exactly once, 5s later, and no more", async () => {
  const h = harness({ [ALL_PATH]: () => new Error("ECONNRESET") });
  await h.presence._beat();
  assert.equal(h.calls.length, 1);
  h.advance(RETRY_AFTER_MS + 1);
  await Promise.resolve();
  assert.equal(h.calls.length, 2, "one retry");
  h.advance(RETRY_AFTER_MS * 5);
  await Promise.resolve();
  assert.equal(h.calls.length, 2, "⚠ BOUNDED — the retry does not retry itself");
});

test("the cadence is 30s with a ±3s jitter, re-rolled per tick", () => {
  const h = harness({ [ALL_PATH]: 200 }, { random: () => 1 }); // 1 → +JITTER_MS
  h.presence.start();
  assert.deepEqual(h.pendingDelays(), [HEARTBEAT_MS + JITTER_MS]);
  assert.ok(HEARTBEAT_MS + JITTER_MS < 2 * HEARTBEAT_MS, "jitter never doubles a period");
});

// ── (3) A 401 COSTS ONE BEAT ─────────────────────────────────────────────────

test("401: the beat reports auth and the loop keeps going — nothing is skipped", async () => {
  let status = 401;
  const h = harness({ [ALL_PATH]: () => status });
  assert.equal(await h.presence._beat(), "auth");
  status = 200;
  assert.equal(await h.presence._beat(), "ok", "the next tick is unaffected");
});

test("401 on ONE container does not abandon the others (the old `return` bug)", async () => {
  const h = harness({
    [ALL_PATH]: 404,
    [ONE_PATH]: (call) => (call.workspaceId === "ws-a" ? 401 : 200),
  });
  h.presence.setWorkspaces(WS);
  await h.presence._beat();
  const posted = h.calls.filter((c) => c.path === ONE_PATH).map((c) => c.workspaceId);
  // ⚠ THE OLD LOOP `return`ed on the first 401, so `ws-b` and `ws-c` went a whole period without
  // a beat because `ws-a` happened to sort first. Ordering must not decide who looks offline.
  assert.deepEqual(posted, WS);
});

test("the repair is NOT re-run here — a 401 that reaches this module is a real answer", () => {
  const src = require("node:fs").readFileSync(MODULE_PATH, "utf8");
  // `api-repair.js › fetchWithAuthRepair` already forced one single-flighted rotation and
  // retried once. A third divergent copy of that rule is the 1.8.x Channels outage.
  assert.ok(!/forceRefresh|writeSessionCookies|noteSessionRejected/.test(src));
});

// ── (4) THE POSTURE ──────────────────────────────────────────────────────────

test("IDLE → away at 30 minutes, active below it", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.state.idle = IDLE_AWAY_MS / 1000 - 1;
  await h.presence._beat();
  assert.equal(h.statuses()[0], "active");

  h.state.idle = IDLE_AWAY_MS / 1000;
  await h.presence._beat();
  assert.equal(h.statuses()[1], "away", "the threshold is inclusive");
});

test("an UNMEASURABLE idle time reads ACTIVE, never away", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.state.idle = null;
  await h.presence._beat();
  // ⚠ The app being OPEN is the base fact of the Slack rule. Answering `away` when the machine
  // cannot be measured would put every headless/CI Electron permanently offline.
  assert.equal(h.statuses()[0], "active");
});

test("SUSPEND / LOCK: an immediate `away` on a 3s leash, and the loop stands down", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.presence.start();
  h.calls.length = 0;
  await h.presence.sleep("suspend");
  assert.deepEqual(h.statuses(), ["away"]);
  assert.equal(h.calls[0].timeoutMs, 3000, "not the 12s beat timeout — quit/suspend is watched");
  assert.deepEqual(h.pendingDelays(), [], "no timer survives the suspend");
});

test("a paused loop reports `away` even when the machine is not idle", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.presence.start();
  await h.presence.sleep("lock-screen");
  h.calls.length = 0;
  h.state.idle = 0; // input on a locked screen is still not presence
  assert.equal(h.presence._posture(), "away");
});

test("RESUME: `active` immediately, and the interval is re-armed", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.presence.start();
  await h.presence.sleep("suspend");
  h.calls.length = 0;
  await h.presence.wake();
  assert.deepEqual(h.statuses(), ["active"]);
  assert.equal(h.pendingDelays().length, 1, "the loop is running again");
});

test("QUIT: stop() posts `away` and returns it, so quit-guard can bound it", async () => {
  const h = harness({ [ALL_PATH]: 200 });
  h.presence.start();
  h.calls.length = 0;
  const result = h.presence.stop();
  assert.ok(result && typeof result.then === "function", "quit-guard races this promise");
  await result;
  assert.deepEqual(h.statuses(), ["away"]);
  assert.deepEqual(h.pendingDelays(), []);
});

test("SIGNED OUT: no beat, and no away post on the way out", async () => {
  const h = harness({ [ALL_PATH]: 200 }, { signedIn: false });
  h.presence.start();
  assert.equal(await h.presence._beat(), "signed-out");
  await h.presence.stop();
  assert.deepEqual(h.calls, []);
});
