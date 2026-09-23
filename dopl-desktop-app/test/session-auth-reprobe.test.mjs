// P4-06 — an auth-held session is released by ITS OWN runtime's credential, never another's.
//
// A runtime whose credential can come back outside Dopl (Codex: `codex login` in a terminal; it
// declares `credential.reprobeOnWake` beside its in-app sign-in since 2026-09-23) re-probes on the
// next message and resumes when the probe no longer says signed out. Claude is released only by its
// in-app sign-in (`claude-signin-recovery.test.mjs`).
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
const codexCredential = require("../main/runtime/codex/credential.js");
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

function withProbe(answer, fn) {
  const real = codexCredential.credentialState;
  let probes = 0;
  codexCredential.credentialState = async () => { probes += 1; return answer(); };
  return Promise.resolve().then(() => fn(() => probes)).finally(() => { codexCredential.credentialState = real; });
}

test("Codex: still signed out → the message is refused and the agent stays held", async () => {
  const { s } = world("codex");
  await withProbe(() => ({ usable: false, source: "login-status-nonzero" }), async (probes) => {
    const res = await sessionReopen.messageByTask({ ...task, text: "are you there?" });
    assert.deepEqual(res, { ok: false, reason: "auth-hold" });
    assert.equal(probes(), 1, "the credential WAS re-asked");
    assert.equal(s.state.authHeld, true);
  });
});

test("Codex: signed back in → the next message releases the hold and is delivered", async () => {
  const { s, dispatched } = world("codex");
  await withProbe(() => ({ usable: true, source: "login-status" }), async () => {
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

test("Claude: a held session is NOT re-probed by a message — its in-app sign-in releases it", async () => {
  const { s } = world("claude");
  await withProbe(() => ({ usable: true }), async (probes) => {
    assert.equal(sessionAuth.reprobesOnWake(s), false);
    const res = sessionReopen.messageByTask({ ...task, text: "hello" });
    assert.deepEqual(res, { ok: false, reason: "auth-hold" }, "synchronous, as before");
    assert.equal(probes(), 0);
    assert.equal(await sessionAuth.reprobeHeld(s), false);
    assert.equal(s.state.authHeld, true);
  });
});
