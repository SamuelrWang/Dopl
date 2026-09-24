// P4-06 — an auth-held session is released by ITS OWN runtime's credential, never another's.
//
// A runtime with no in-app sign-in (Cursor) re-probes on the next message and resumes when the probe
// no longer says signed out. A runtime Dopl signs in (Claude, Codex) holds only Dopl's own credential, so
// only that sign-in releases it (`runtime-credentials.js › signIn`); a message never re-probes it.
//
// Drives the REAL `session-auth.js` and the REAL `session-reopen.js › messageByTask`, with the
// REAL reducer behind a fake dispatch; only the credential probe is stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";

const require = createRequire(import.meta.url);
const sessionAuth = require("../main/session-auth.js");
const sessionReopen = require("../main/session-reopen.js");
const cursorCredential = require("../main/runtime/cursor/credential.js");
const runtimeRegistry = require("../main/runtime/index.js");
const { initialSessionState, sessionReducer } = loadReducer();

const AGENT = "a1b2c3d4";
const task = { channelId: "chan-1", taskId: "task-9", agentId: AGENT };

function world(runtimeId) {
  const dispatched = [];
  const sessions = new Map();
  const dispatch = (s, ev) => {
    dispatched.push(ev);
    const next = sessionReducer(s.state, ev);
    s.state = next.state;
  };
  sessionAuth.bind({
    sessions, dispatch, denyPending: () => {}, teardown: () => {},
    acquireRuntime: async () => ({}), startQuery: async () => {},
  });
  sessionReopen.bind({ sessions, dispatch, refreshTray: () => {} });
  const s = {
    key: `chan-1:task-9:${AGENT}`, channelId: "chan-1", taskId: "task-9", agentId: AGENT,
    sessionId: "s-1", runtimeId, settled: false, context: {}, nonce: "n0nce1", operatorUserId: "op-1",
    state: initialSessionState({ mode: "interactive", side: "responder" }),
    abortController: { abort() {} }, pushIterator: { close() {} },
  };
  sessions.set(s.key, s);
  assert.equal(sessionAuth.holdIfAuthFailure(s, "Not logged in"), true);
  assert.equal(s.state.authHeld, true);
  return { s, dispatched };
}

// Every runtime's probe, counted: a message must re-ask only the one that has no in-app sign-in.
function withProbe(answer, fn) {
  const probed = [];
  const reals = new Map();
  for (const id of runtimeRegistry.ids()) {
    const rt = id === "cursor" ? cursorCredential : runtimeRegistry.resolve(id).runtime;
    reals.set(rt, rt.credentialState);
    rt.credentialState = async () => { probed.push(id); return answer(); };
  }
  // The hold's own status push (`runtime-credentials.js`) settles first; only the message's probes count.
  return new Promise((r) => setImmediate(r)).then(() => { probed.length = 0; return fn(() => probed); })
    .finally(() => { for (const [rt, real] of reals) rt.credentialState = real; });
}

test("Cursor: still signed out → the message is refused and the agent stays held", async () => {
  const { s } = world("cursor");
  await withProbe(() => ({ usable: false, source: "status-nonzero" }), async (probed) => {
    const res = await sessionReopen.messageByTask({ ...task, text: "are you there?" });
    assert.deepEqual(res, { ok: false, reason: "auth-hold" });
    assert.deepEqual(probed(), ["cursor"], "its own credential WAS re-asked");
    assert.equal(s.state.authHeld, true);
  });
});

test("Cursor: signed back in → the next message releases the hold and is delivered", async () => {
  const { s, dispatched } = world("cursor");
  await withProbe(() => ({ usable: true, source: "cli-status" }), async () => {
    const res = await sessionReopen.messageByTask({ ...task, text: "carry on" });
    assert.deepEqual(res, { ok: true });
    assert.equal(s.state.authHeld, false, "released");
    assert.equal(s.authHold, null);
    const types = dispatched.map((e) => e.type);
    assert.deepEqual(types.slice(types.indexOf("auth_release")), ["auth_release", "steer", "steer"],
      "release, the runtime's own resume nudge, then the operator's message");
    assert.equal(dispatched[dispatched.length - 1].rawText, "carry on");
  });
});

for (const runtimeId of ["claude", "codex"]) {
  test(`${runtimeId}: a held session is NOT re-probed by a message — only Dopl's own sign-in releases it`, async () => {
    const { s } = world(runtimeId);
    await withProbe(() => ({ usable: true }), async (probed) => {
      assert.equal(sessionAuth.reprobesOnWake(s), false);
      const res = sessionReopen.messageByTask({ ...task, text: "hello" });
      assert.deepEqual(res, { ok: false, reason: "auth-hold" }, "synchronous, as before");
      assert.equal(await sessionAuth.reprobeHeld(s), false);
      assert.deepEqual(probed(), []);
      assert.equal(s.state.authHeld, true);
    });
  });
}
