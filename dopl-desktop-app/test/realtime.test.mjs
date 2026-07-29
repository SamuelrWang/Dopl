// Tests for the push-transport core in realtime.js — the circuit breaker state
// machine and the wake coalescer. Both are correctness-critical:
//   • the breaker is the F-072 reconnect-storm guard: it decides when the loops
//     may trust pushes (cheap path) vs must revert to the held long-poll, and it
//     must reopen on a half-open failure so a flapping WS never spins;
//   • the coalescer guarantees a BURST of INSERTs is at most one cheap catch-up
//     per channel, not one fetch per row.
//
// Run: `node --test dopl-desktop-app/test/realtime.test.mjs`
//
// WHY SOURCE EXTRACTION: realtime.js is CommonJS and pulls in
// @supabase/realtime-js + ws + electron (config/diag), so it cannot be imported
// under `node --test`. Both cores are deliberately fenced by BEGIN/END sentinel
// comments as PURE factories (no ws/electron/network refs; clock + timers are
// injected), so this test slices each fenced block and evaluates it verbatim —
// the test stays honest to what ships.
//
// `.mjs` (ESM) to stay clean under the repo's shared eslint config.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "realtime.js"), "utf8");

function slice(beginTag, endTag) {
  const from = SRC.indexOf(beginTag);
  const to = SRC.indexOf(endTag);
  assert.notEqual(from, -1, `${beginTag} sentinel missing`);
  assert.notEqual(to, -1, `${endTag} sentinel missing`);
  assert.ok(to > from, `${beginTag} sentinels out of order`);
  return SRC.slice(from, to);
}

const { createBreaker } = new Function(
  `${slice("// ─── BEGIN BREAKER", "// ─── END BREAKER")}\n return { createBreaker };`
)();
const { createWakeCoalescer } = new Function(
  `${slice("// ─── BEGIN WAKE-COALESCE", "// ─── END WAKE-COALESCE")}\n return { createWakeCoalescer };`
)();
const { wsHealthy } = new Function(
  `${slice("// ─── BEGIN WS-HEALTH", "// ─── END WS-HEALTH")}\n return { wsHealthy };`
)();

// ── Breaker: fail → open → cooldown → half-open → close ──────────────────────

test("breaker starts CLOSED (healthy)", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  assert.equal(b.getState(), "closed");
  assert.equal(b.isClosed(), true);
});

test("fewer than threshold failures stays CLOSED", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "closed");
});

test("threshold consecutive failures OPENs the breaker", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  b.onFailure();
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "open");
  assert.equal(b.isClosed(), false);
});

test("a success before threshold resets the failure count", () => {
  const b = createBreaker({ threshold: 3, cooldownMs: 1000, now: () => 0 });
  b.onFailure();
  b.onFailure();
  b.onSuccess(); // resets
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "closed", "must take a FULL threshold again to open");
  b.onFailure();
  assert.equal(b.getState(), "open");
});

test("OPEN stays open until the cooldown elapses, then goes HALF-OPEN", () => {
  let t = 0;
  const b = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  b.onFailure();
  b.onFailure();
  assert.equal(b.getState(), "open");
  // Before cooldown: no probe.
  t = 999;
  assert.equal(b.maybeHalfOpen(), false);
  assert.equal(b.getState(), "open");
  // After cooldown: a single probe is allowed.
  t = 1000;
  assert.equal(b.maybeHalfOpen(), true);
  assert.equal(b.getState(), "half-open");
  // Idempotent while half-open.
  assert.equal(b.maybeHalfOpen(), true);
});

test("HALF-OPEN success CLOSEs the breaker", () => {
  let t = 0;
  const b = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  b.onFailure();
  b.onFailure();
  t = 2000;
  b.maybeHalfOpen();
  b.onSuccess();
  assert.equal(b.getState(), "closed");
  assert.equal(b.isClosed(), true);
});

test("HALF-OPEN failure RE-OPENs with a fresh cooldown", () => {
  let t = 0;
  const b = createBreaker({ threshold: 2, cooldownMs: 1000, now: () => t });
  b.onFailure();
  b.onFailure();
  t = 1000;
  b.maybeHalfOpen();
  assert.equal(b.getState(), "half-open");
  b.onFailure(); // probe failed
  assert.equal(b.getState(), "open");
  // Cooldown restarts from t=1000: still open at t=1500, half-open at t=2000.
  t = 1500;
  assert.equal(b.maybeHalfOpen(), false);
  t = 2000;
  assert.equal(b.maybeHalfOpen(), true);
});

// ── Wake coalescing ──────────────────────────────────────────────────────────

// A fake timer store: capture the single armed flush callback so the test drives
// the flush deterministically (no real time).
function fakeTimers() {
  let scheduled = null;
  return {
    setTimeout: (fn) => { scheduled = fn; return 42; },
    clearTimeout: () => { scheduled = null; },
    run: () => { const fn = scheduled; scheduled = null; if (fn) fn(); },
    armed: () => scheduled !== null,
  };
}

test("a burst of INSERTs for one channel coalesces to a SINGLE wake", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => woke.push(id), T);
  c.mark("chan-a");
  c.mark("chan-a");
  c.mark("chan-a");
  assert.equal(c.size(), 1, "duplicate ids collapse in the Set");
  assert.equal(T.armed(), true, "one flush is armed for the whole burst");
  T.run();
  assert.deepEqual(woke, ["chan-a"], "exactly one wake for the channel");
  assert.equal(c.size(), 0);
});

test("distinct channels each wake once per window", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => woke.push(id), T);
  c.mark("a");
  c.mark("b");
  c.mark("a");
  T.run();
  assert.deepEqual(woke.sort(), ["a", "b"]);
});

test("null / undefined ids are ignored (never arm a wake)", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => woke.push(id), T);
  c.mark(null);
  c.mark(undefined);
  assert.equal(c.size(), 0);
  assert.equal(T.armed(), false);
});

test("a throwing onFlush does not drop the rest of the batch", () => {
  const T = fakeTimers();
  const woke = [];
  const c = createWakeCoalescer(200, (id) => {
    if (id === "boom") throw new Error("nope");
    woke.push(id);
  }, T);
  c.mark("boom");
  c.mark("ok");
  T.run();
  assert.deepEqual(woke, ["ok"], "the good id still fired");
});

// ── Per-workspace health (the ~3-min-to-consent root cause) ───────────────────
// isWorkspaceHealthy(ws) wires module state (started, breaker.isClosed(), the
// sub for that ws) into this pure predicate. These lock the behavior that fixes
// the bug: a loop trusts push for its ws ONLY when its OWN sub is subscribed.

test("a SUBSCRIBED ws is healthy", () => {
  assert.equal(wsHealthy(true, true, { subscribed: true }), true);
});

test("an ERRORED ws is UNhealthy even though another ws is subscribed", () => {
  // The live bug: ws A up (global health green) while ws B (the DM's) errored.
  // A per-ws Map: B must read UNhealthy so B's loops fall back to the long-poll.
  const subs = new Map([
    ["wsA", { subscribed: true }],
    ["wsB", { subscribed: false }], // CHANNEL_ERROR / TIMED_OUT / CLOSED
  ]);
  const isWsHealthy = (id) => wsHealthy(true, true, subs.get(id));
  assert.equal(isWsHealthy("wsA"), true, "the up ws stays healthy");
  assert.equal(isWsHealthy("wsB"), false, "the errored ws is NOT masked green by wsA");
});

test("an unknown ws (no sub in the map) is UNhealthy", () => {
  assert.equal(wsHealthy(true, true, undefined), false);
});

test("not started → UNhealthy regardless of the sub", () => {
  assert.equal(wsHealthy(false, true, { subscribed: true }), false);
});

test("breaker OPEN → UNhealthy regardless of the sub", () => {
  assert.equal(wsHealthy(true, false, { subscribed: true }), false);
});
