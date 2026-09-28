// presence-core's optional device hooks: `onBeat(status)` on each signed-in beat, `onAway(reason)`
// on sleep()/stop(). Fire-and-forget on beat/sleep; stop() returns the away post joined with the
// onAway('stop') hook (device offline) so quit-guard's one deadline bounds both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createPresence, IDLE_AWAY_MS } = require("../main/presence-core.js");

function make(extra = {}, opts = {}) {
  const posts = [];
  const state = { signedIn: opts.signedIn ?? true, idle: 0 };
  const presence = createPresence({
    apiFetch: async (path, o) => { posts.push({ path, status: o.body.status }); return { status: 200, ok: true }; },
    discardBody: () => {},
    isSignedIn: () => state.signedIn,
    idleSeconds: () => state.idle,
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
    ...extra,
  });
  return { presence, posts, state };
}

test("onBeat receives the posture of every signed-in beat", async () => {
  const seen = [];
  const h = make({ onBeat: (s) => seen.push(s) });
  await h.presence._beat();
  h.state.idle = IDLE_AWAY_MS / 1000;
  await h.presence._beat();
  assert.deepEqual(seen, ["active", "away"]);
  assert.deepEqual(h.posts.map((p) => p.status), ["active", "away"]);
});

test("onBeat is not called while signed out", async () => {
  const seen = [];
  const h = make({ onBeat: (s) => seen.push(s) }, { signedIn: false });
  assert.equal(await h.presence._beat(), "signed-out");
  assert.deepEqual(seen, []);
});

test("absent hooks are fine (backwards compatible)", async () => {
  const h = make();
  assert.equal(await h.presence._beat(), "ok");
  h.presence.start();
  assert.equal(await h.presence.sleep("suspend"), "ok");
  assert.equal(await h.presence.stop(), "ok");
});

test("a throwing, rejecting or hanging hook never changes presence", async () => {
  for (const hook of [
    () => { throw new Error("x"); },
    () => Promise.reject(new Error("y")),
    () => new Promise(() => {}),
  ]) {
    const h = make({ onBeat: hook, onAway: hook });
    assert.equal(await h.presence._beat(), "ok");
    h.presence.start();
    assert.equal(await h.presence.sleep("suspend"), "ok", "sleep never waits on the hook");
    await h.presence.wake();
    const stopped = h.presence.stop();
    assert.deepEqual(h.posts.map((p) => p.status).slice(-1), ["away"], "away still posted");
    // A hanging hook holds stop() open — quit-guard's deadline is what bounds it.
    const out = await Promise.race([stopped, new Promise((r) => setTimeout(() => r("held"), 20))]);
    assert.ok(out === "ok" || out === "held");
  }
});

test("stop() settles only when BOTH the away post and the device offline hook settle", async () => {
  let releaseAway, releaseDevice;
  const order = [];
  const h = make({
    apiFetch: (path, o) => new Promise((r) => {
      releaseAway = () => { order.push("away"); r({ status: 200, ok: true }); };
    }),
    onAway: () => new Promise((r) => { releaseDevice = () => { order.push("device"); r("ok"); }; }),
  });
  h.presence.start();
  // start() fired a beat; release it so the stop path owns releaseAway.
  releaseAway();
  await new Promise((r) => setImmediate(r));
  let settled = false;
  const stopped = h.presence.stop().then((v) => { settled = true; return v; });
  await new Promise((r) => setImmediate(r));
  releaseAway();
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, "device offline still pending");
  releaseDevice();
  assert.equal(await stopped, "ok", "resolves to the away outcome");
  assert.deepEqual(order.slice(-2), ["away", "device"]);
});

test("sleep() never waits on the device hook (suspend stays fire-and-forget)", async () => {
  const h = make({ onAway: () => new Promise(() => {}) });
  h.presence.start();
  assert.equal(await h.presence.sleep("suspend"), "ok");
});

test("quit-guard races listener.stop()'s promise inside FLUSH_DEADLINE_MS (unchanged 1500ms)", () => {
  const { readFileSync } = require("node:fs");
  const Q = readFileSync(new URL("../main/quit-guard.js", import.meta.url), "utf8");
  const L = readFileSync(new URL("../main/channel-listener.js", import.meta.url), "utf8");
  assert.match(Q, /const FLUSH_DEADLINE_MS = 1500;/);
  assert.match(Q, /awayPost = deps\.listener\.stop\(\)/);
  assert.match(Q, /awayPost \|\| Promise\.resolve\(\)/);
  assert.match(L, /const away = presence\.stop\(\);[\s\S]*?return away;/);
});

test("onAway fires on sleep(reason) and on stop()", async () => {
  const seen = [];
  const h = make({ onAway: (r) => seen.push(r) });
  h.presence.start();
  await h.presence.sleep("lock-screen");
  await h.presence.wake();
  await h.presence.stop();
  assert.deepEqual(seen, ["lock-screen", "stop"]);
});

test("onAway is not called when signed out or never started", async () => {
  const seen = [];
  const out = make({ onAway: (r) => seen.push(r) }, { signedIn: false });
  out.presence.start();
  await out.presence.sleep("suspend");
  await out.presence.stop();
  const idle = make({ onAway: (r) => seen.push(r) });
  await idle.presence.stop();
  assert.deepEqual(seen, []);
});
