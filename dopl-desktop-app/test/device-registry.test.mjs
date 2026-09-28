// DEVICE HEARTBEAT — `main/device-registry-core.js`: throttle, revoke, 404 backoff, offline.
// Also pins the wiring: presence drives it (no second timer) and a removal signs this app out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const {
  createDeviceRegistry, PATH, MIN_INTERVAL_MS, UNAVAILABLE_BACKOFF_MS, OFFLINE_TIMEOUT_MS,
} = require("../main/device-registry-core.js");

function res(status, json) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (json instanceof Error) throw json;
      return json;
    },
  };
}

function harness(plan = () => res(200, { device: { id: "d1", revoked: false } })) {
  let clock = 1_000_000;
  const calls = [];
  let revokedCount = 0;
  const reg = createDeviceRegistry({
    apiFetch: async (path, o) => {
      calls.push({ path, ...o });
      const r = plan(calls.length, o);
      if (r instanceof Error) throw r;
      return r;
    },
    descriptor: (status) => ({ installId: "i", name: "Mac", platform: "macos", status }),
    onRevoked: () => { revokedCount += 1; },
    now: () => clock,
  });
  return {
    reg, calls,
    revoked: () => revokedCount,
    advance(ms) { clock += ms; },
    statuses: () => calls.map((c) => c.body.status),
  };
}

test("first beat posts the descriptor to the heartbeat path", async () => {
  const h = harness();
  assert.equal(await h.reg.beat("active"), "ok");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, PATH);
  assert.equal(PATH, "/api/devices/heartbeat");
  assert.equal(h.calls[0].method, "POST");
  assert.deepEqual(h.calls[0].body, { installId: "i", name: "Mac", platform: "macos", status: "active" });
});

test("THROTTLE: same status inside 60s is skipped; at 60s it sends again", async () => {
  const h = harness();
  await h.reg.beat("active");
  h.advance(30_000);
  assert.equal(await h.reg.beat("active"), "throttled");
  h.advance(MIN_INTERVAL_MS - 30_000);
  assert.equal(await h.reg.beat("active"), "ok");
  assert.equal(h.calls.length, 2);
});

test("a status change sends immediately, throttle or not", async () => {
  const h = harness();
  await h.reg.beat("active");
  h.advance(1000);
  assert.equal(await h.reg.beat("away"), "ok");
  assert.deepEqual(h.statuses(), ["active", "away"]);
});

test("a failed send does not count: the next beat retries", async () => {
  const h = harness((n) => (n === 1 ? res(500) : res(200, { device: { id: "d" } })));
  assert.equal(await h.reg.beat("active"), "error");
  assert.equal(await h.reg.beat("active"), "ok");
  assert.equal(h.calls.length, 2);
});

test("REVOKED: onRevoked runs once and beating stops until reset()", async () => {
  const h = harness(() => res(200, { device: { revoked: true } }));
  assert.equal(await h.reg.beat("active"), "revoked");
  assert.equal(h.revoked(), 1);
  h.advance(MIN_INTERVAL_MS * 5);
  assert.equal(await h.reg.beat("away"), "revoked");
  assert.equal(await h.reg.offline("quit"), "revoked");
  assert.equal(h.calls.length, 1, "nothing is posted for a removed computer");
  assert.equal(h.revoked(), 1);
  h.reg.reset();
  await h.reg.beat("active");
  assert.equal(h.calls.length, 2);
  assert.equal(h.revoked(), 2, "a new session that is still removed signs out again");
});

test("concurrent revoked answers call onRevoked once", async () => {
  const h = harness(() => res(200, { device: { revoked: true } }));
  await Promise.all([h.reg.beat("active"), h.reg.offline("x")]);
  assert.equal(h.revoked(), 1);
});

test("a throwing or rejecting onRevoked never escapes", async () => {
  for (const onRevoked of [() => { throw new Error("x"); }, () => Promise.reject(new Error("y"))]) {
    const reg = createDeviceRegistry({
      apiFetch: async () => res(200, { device: { revoked: true } }),
      descriptor: (s) => ({ status: s }),
      onRevoked,
    });
    assert.equal(await reg.beat("active"), "revoked");
  }
});

test("404 backs off five minutes, then tries again", async () => {
  const h = harness((n) => (n === 1 ? res(404) : res(200, { device: { id: "d" } })));
  assert.equal(await h.reg.beat("active"), "unavailable");
  h.advance(UNAVAILABLE_BACKOFF_MS - 1);
  assert.equal(await h.reg.beat("away"), "unavailable");
  assert.equal(await h.reg.offline("quit"), "unavailable");
  assert.equal(h.calls.length, 1);
  h.advance(1);
  assert.equal(await h.reg.beat("active"), "ok");
  assert.equal(h.calls.length, 2);
});

test("401 is ignored (not signed in) and never latches", async () => {
  const h = harness((n) => (n === 1 ? res(401) : res(200, {})));
  assert.equal(await h.reg.beat("active"), "auth");
  assert.equal(await h.reg.beat("active"), "ok");
});

test("offline() bypasses the throttle with a short timeout, and the next active sends", async () => {
  const h = harness();
  await h.reg.beat("active");
  assert.equal(await h.reg.offline("quit"), "ok");
  assert.equal(h.calls[1].body.status, "offline");
  assert.equal(h.calls[1].timeoutMs, OFFLINE_TIMEOUT_MS);
  assert.ok(OFFLINE_TIMEOUT_MS <= 3000);
  assert.equal(await h.reg.beat("active"), "ok", "offline → active is a status change");
});

test("errors never throw: transport, bad JSON, descriptor", async () => {
  const h = harness(() => new Error("ECONNRESET"));
  assert.equal(await h.reg.beat("active"), "error");
  assert.equal(await h.reg.offline("quit"), "error");
  const bad = harness(() => res(200, new SyntaxError("not json")));
  assert.equal(await bad.reg.beat("active"), "ok");
  const reg = createDeviceRegistry({
    apiFetch: async () => res(200, {}),
    descriptor: () => { throw new Error("boom"); },
    onRevoked: () => {},
  });
  assert.equal(await reg.beat("active"), "error");
  assert.equal(await reg.offline("quit"), "error");
});

test("a beat in flight is not stacked", async () => {
  let release;
  const h = harness(() => new Promise((r) => { release = () => r(res(200, {})); }));
  const first = h.reg.beat("active");
  assert.equal(await h.reg.beat("away"), "busy");
  release();
  assert.equal(await first, "ok");
  assert.equal(h.calls.length, 1);
});

// ── the wiring ──────────────────────────────────────────────────────────────

test("presence drives the device heartbeat; there is no second timer", () => {
  const P = M("presence.js");
  assert.match(P, /onBeat: \(status\) => device\.beat\(status\)/);
  assert.match(P, /onAway: \(reason\) => \(reason === 'lock-screen' \? device\.beat\('away'\) : device\.offline\(reason\)\)/);
  assert.match(P, /device\.arm\(\); presence\.start\(\);/);
  for (const f of ["device-registry.js", "device-registry-core.js"]) {
    assert.equal(/setInterval|setTimeout/.test(M(f)), false, `${f} arms no timer`);
  }
});

test("a removal rotates the install id and runs the sign-out sequence", () => {
  const W = M("device-registry.js");
  const body = W.slice(W.indexOf("async function onRevoked"), W.indexOf("const registry"));
  const order = [
    "identity.rotateInstallId()",
    "require('./auth').signOut()",
    "require('./auth-tokens').onSignOut()",
    "require('./channel-listener').restart()",
  ].map((s) => body.indexOf(s));
  assert.ok(order.every((i) => i >= 0), "every step present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in ui-bridge's order");
  assert.match(W, /status === 'signed-in'\) registry\.reset\(\)/, "a new sign-in clears the latch");
});
