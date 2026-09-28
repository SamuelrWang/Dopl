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

test("THROTTLE: same status inside the interval is skipped; at the interval it sends again", async () => {
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

test("MIN_INTERVAL is ~50s so a 30s±3s cadence sends every other beat", async () => {
  assert.equal(MIN_INTERVAL_MS, 50_000);
  const h = harness();
  await h.reg.beat("active");
  // Worst-case short jitter: two beats at 27s each = 54s ≥ 50s.
  h.advance(27_000);
  assert.equal(await h.reg.beat("active"), "throttled");
  h.advance(27_000);
  assert.equal(await h.reg.beat("active"), "ok");
});

test("a beat in flight is not stacked; the LATEST requested status is sent after it settles", async () => {
  const releases = [];
  const h = harness(() => new Promise((r) => { releases.push(() => r(res(200, {}))); }));
  const first = h.reg.beat("active");
  assert.equal(await h.reg.beat("active"), "queued");
  assert.equal(await h.reg.beat("away"), "queued", "latest wins");
  assert.equal(h.calls.length, 1, "no stacking");
  releases[0]();
  assert.equal(await first, "ok");
  assert.equal(h.calls.length, 2, "queued status drained");
  assert.deepEqual(h.statuses(), ["active", "away"], "a lock-screen away is not lost");
  releases[1]();
});

test("a queued status equal to the one just sent is throttled, not re-posted", async () => {
  let release;
  const h = harness((n) => (n === 1 ? new Promise((r) => { release = () => r(res(200, {})); }) : res(200, {})));
  const first = h.reg.beat("active");
  assert.equal(await h.reg.beat("active"), "queued");
  release();
  await first;
  assert.equal(h.calls.length, 1);
});

test("offline() drops a queued status so nothing lands after it", async () => {
  let release;
  const h = harness((n) => (n === 1 ? new Promise((r) => { release = () => r(res(200, {})); }) : res(200, {})));
  const first = h.reg.beat("active");
  assert.equal(await h.reg.beat("away"), "queued");
  assert.equal(await h.reg.offline("quit"), "ok");
  release();
  await first;
  assert.deepEqual(h.statuses(), ["active", "offline"]);
});

// ── token link: sent once, then never ─────────────────────────────────────

const TID = "3f2c1a9e-8b7d-4c6e-9f1a-2b3c4d5e6f70";

test("tokenId rides only the first landed send after setLink, then is dropped", async () => {
  const h = harness();
  h.reg.setLink({ tokenId: TID });
  await h.reg.beat("active");
  h.advance(MIN_INTERVAL_MS);
  await h.reg.beat("active");
  assert.equal(h.calls[0].body.tokenId, TID);
  assert.equal("tokenLabel" in h.calls[0].body, false);
  assert.equal("tokenId" in h.calls[1].body, false, "not re-sent");
});

test("a failed send keeps the link for the next beat", async () => {
  const h = harness((n) => (n === 1 ? res(500) : res(200, {})));
  h.reg.setLink({ tokenId: TID });
  assert.equal(await h.reg.beat("active"), "error");
  assert.equal(await h.reg.beat("active"), "ok");
  assert.equal(h.calls[1].body.tokenId, TID);
  assert.equal(h.reg._link(), null);
});

test("legacy record: tokenLabel is sent once instead (clamped to 120)", async () => {
  const h = harness();
  h.reg.setLink({ tokenLabel: "L".repeat(200) });
  await h.reg.beat("active");
  await h.reg.beat("away");
  assert.equal(h.calls[0].body.tokenLabel.length, 120);
  assert.equal("tokenId" in h.calls[0].body, false);
  assert.equal("tokenLabel" in h.calls[1].body, false);
});

test("a re-mint mid-session re-arms the link; null/junk clears it", async () => {
  const h = harness();
  h.reg.setLink({ tokenId: TID });
  await h.reg.beat("active");
  const T2 = "11111111-2222-4333-8444-555555555555";
  h.reg.setLink({ tokenId: T2 });
  await h.reg.beat("away");
  assert.equal(h.calls[1].body.tokenId, T2);
  h.reg.setLink(null);
  assert.equal(h.reg._link(), null);
  h.reg.setLink({ nope: 1 });
  assert.equal(h.reg._link(), null);
});

test("the token store is never read on the beat path", () => {
  const W = M("device-registry.js");
  const beatLine = W.slice(W.indexOf("module.exports"));
  assert.equal(/mcp-config/.test(beatLine), false);
  assert.equal(/mcp-config/.test(M("device-registry-core.js")), false);
  assert.equal(/mcp-config/.test(M("device-identity.js")), false);
  const arm = W.slice(W.indexOf("function arm()"), W.indexOf("module.exports"));
  assert.match(arm, /identity\.refresh\(\)/, "name/OS read once at arm, async");
  assert.match(arm, /loadLink\(\)/, "link read once at arm");
  assert.match(arm, /onDeviceTokenMinted\(\(l\) => registry\.setLink\(l\)\)/, "re-mint notifier");
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
  assert.match(W, /user = state\.userId;\s*registry\.reset\(\);\s*loadLink\(\);/, "a new sign-in clears the latch and re-reads the link");
});
