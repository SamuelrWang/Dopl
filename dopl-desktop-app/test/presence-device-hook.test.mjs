// presence-core's optional device hooks: `onBeat(status)` on each signed-in beat, `onAway(reason)`
// on sleep()/stop(). Fire-and-forget — absent, throwing or hanging hooks change nothing.

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
    assert.equal(await h.presence.stop(), "ok");
    assert.deepEqual(h.posts.map((p) => p.status).slice(-1), ["away"]);
  }
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
