// A STALE OPERATOR ID ACROSS A SIGN-OUT OR AN ACCOUNT SWITCH (2026-09-23, follow-up to DMP-005).
//
// `session-launch.js` reads the signed-in operator's id from the ENGINE (`setSelfIdentity`, set by
// `channel-listener.js › reconcileInner`) for the room roster's self-exclusion, and `startSession`
// stamps it on every session (`s.operatorUserId`, the direct lane's cross-account fence). The
// listener cleared its OWN cached id on a sign-out and on an identity mismatch, but not the
// engine's — so a launch in the gap before the next resolve ran under the PREVIOUS account's id.
//
// Driven end to end: the REAL listener's reconcile (its auth / transport / presence / realtime
// edges faked), the REAL engine, and a real launch through `launchResponderSession`. Asserted on
// what the runtime was handed (the roster) and on the session's own stamp.
//
// Run: `node --test dopl-desktop-app/test/listener-operator-forget.test.mjs`

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { engine, rt, settle, registryReads, MAIN, CHANNEL, WORKSPACE } from "./_engine-harness.mjs";

const require_ = createRequire(import.meta.url);
const M = (p) => join(MAIN, p);

const ACCOUNT_A = "aaaaaaaa-1111-4222-8333-444444444444";
const PEER = "99999999-8888-4777-8666-555555555555";

// ── The listener's edges, faked on the module objects it calls through at call time ──
const world = { signedIn: true, mismatch: false, resolve: async () => ACCOUNT_A, resolves: 0 };

const auth = require_(M("auth.js"));
Object.assign(auth, {
  ensureSignedIn: async () => world.signedIn,
  isSignedIn: () => world.signedIn,
  identityMismatch: () => world.mismatch,
});
const io = require_(M("listener-io.js"));
const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
Object.assign(io, {
  listWorkspaces: async () => [], // no channels to loop over: the identity half is the subject
  resolveOperatorUserId: (ws) => { world.resolves += 1; return world.resolve(ws); },
  isFeatureAvailable: () => true,
  // The roster's two reads: account A is a member, alongside a peer.
  apiFetch: async (path) => {
    if (path.endsWith("/members")) {
      return json({ members: [{ userId: ACCOUNT_A, displayName: "Alex Before" }, { userId: PEER, displayName: "Pat Peer" }] });
    }
    if (path.endsWith("/sessions")) return json({ sessions: [] });
    return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
  },
  displayNameFor: (id) => (id === PEER ? "Pat Peer" : id === ACCOUNT_A ? "Alex Before" : "A teammate"),
});
const noop = () => {};
Object.assign(require_(M("presence.js")), { start: noop, stop: noop, wake: noop, setWorkspaces: noop });
Object.assign(require_(M("realtime.js")), {
  start: noop, stop: noop, setWorkspaces: noop, refreshAuth: noop, desiredCount: () => 0, isWorkspaceHealthy: () => false,
});
Object.assign(require_(M("claude-runtime.js")), { checkRuntimeAtStart: async () => {} });
Object.assign(require_(M("channel-seed-watch.js")), { observeChannels: noop });
Object.assign(require_(M("session-park-on-claim.js")), { noteWorkspaces: noop });

const listener = require_(M("channel-listener.js"));
after(() => { try { listener.stop(); } catch (_) { /* best-effort */ } });

let seq = 0;
async function launch() {
  const taskId = `44444444-5555-4666-8777-${String(++seq).padStart(12, "0")}`;
  const before = rt.handles.length;
  const res = await engine.launchResponderSession({
    windowless: true, channelId: CHANNEL, taskId, workspaceId: WORKSPACE,
    runtime: "claude", message: "hi", counterpartyId: PEER, direct: false,
    context: { channelName: "Ops", channelId: CHANNEL, workspaceId: WORKSPACE, taskId },
    toolProfile: "channel_agent", mode: "autonomous", startModes: { tools: "manual", messages: "ask" },
  });
  assert.ok(res && res.sessionId, JSON.stringify(res));
  await settle();
  const s = registryReads.sessionOn({ channelId: CHANNEL, taskId });
  const m = rt.handles[before] && rt.handles[before].pushed[0];
  const c = m && m.message && m.message.content;
  const turn = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b && b.text) || "").join("") : "";
  const from = turn.indexOf("IN THIS ROOM as of launch");
  assert.ok(from !== -1, "the roster block is rendered");
  return { stamp: s && s.operatorUserId, roster: turn.slice(from) };
}

/** One reconcile pass (the listener exposes no handle on it; `restart` runs one). */
async function reconcile() { listener.restart(); await settle(40); }

test("signed in as A: the launch excludes A from the roster and stamps A (the baseline)", async () => {
  listener.start(() => {});
  await settle(40);
  assert.equal(world.resolves, 1, "the operator was resolved once");
  const { stamp, roster } = await launch();
  assert.equal(stamp, ACCOUNT_A);
  assert.doesNotMatch(roster, /@alex-before/, "the operator is not listed among the people");
});

test("SIGN-OUT, then a launch before any resolve: neither the roster nor the stamp uses A's id", async () => {
  world.signedIn = false;
  await reconcile();
  const { stamp, roster } = await launch();
  assert.equal(stamp, null, "the session must not be stamped with the signed-out account");
  // Unresolved fails OPEN, exactly as before DMP-005: nobody is excluded as "self", so A is listed.
  assert.match(roster, /@alex-before/, "A is not treated as this machine's operator any more");
});

test("ACCOUNT SWITCH (identity mismatch), launch while the re-resolve is still pending: A's id is gone", async () => {
  // Signed back in as A: resolved, held by the listener AND the engine (the baseline again).
  world.signedIn = true;
  await reconcile();
  assert.equal((await launch()).stamp, ACCOUNT_A, "precondition: A is resolved again");
  // The switch: jar and blob now name different users, and the re-resolve has not answered (the gap).
  world.mismatch = true;
  world.resolve = () => new Promise(() => {});
  await reconcile();
  const { stamp, roster } = await launch();
  assert.equal(stamp, null, "the session must not be stamped with the previous account");
  assert.match(roster, /@alex-before/, "A is not excluded as self while the identity is unresolved");
});
