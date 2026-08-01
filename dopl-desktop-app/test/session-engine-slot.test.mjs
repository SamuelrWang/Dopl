// FIX N1 — launch() must ask its busy questions about the SAME slot its key names.
//
// `launch` resolves the registry key with `store.slotKey(a)`, which reads `agentId` when
// there is one and collapses to (channel, thread) when there is not. Its two busy checks
// then rebuilt `{ channelId, taskId }` BY HAND, stripping the agent. For a team-shaped call
// (agentId set, taskId '') the key said (channel, agent) while the checks asked about
// (channel, ''), so launch could report a free slot for an agent that is already running and
// then let startSession overwrite the registry entry — orphaning that agent's live window.
// This is the same latent bug D2 already fixed in session-park.startResume, one file over.
//
// METHOD: session-engine.js is electron-bound and has no extractable pure block, so the three
// functions this involves are brace-matched out and evaluated together with fakes for the
// module bindings they close over. That runs the REAL control flow — including the FIX #7
// re-check after the getSdk await, which is the other place the two spellings had to agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const ENGINE = readFileSync(join(MAIN, "session-engine.js"), "utf8");
const STORE_SRC = readFileSync(join(MAIN, "session-store.js"), "utf8");

// The REAL key function, so the slot arithmetic under test is the shipped one.
const { sessionKey, slotKey } = new Function(
  `${fnOf(STORE_SRC, "sessionKey")}\n${fnOf(STORE_SRC, "slotKey")}\n return { sessionKey, slotKey };`
)();

// `launch` is an `async function`; the keyword has to come with it or its awaits are a
// syntax error in the evaluated scope.
function asyncFnOf(src, name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.notEqual(at, -1, `async function ${name} not found in session-engine.js`);
  let depth = 0;
  let i = src.indexOf("{", at);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(at, i);
}

const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AGENT = "agent-quartz";
const TASK = "11111111-2222-3333-4444-555555555555";

function harness(cfg = {}) {
  const calls = { started: [], diag: [] };
  const sessions = new Map();
  const api = new Function(
    "sessions", "store", "windowModeEnabled", "windowFactory", "sessionConsent", "sessionPark",
    "getSdk", "startSession", "diag",
    `${asyncFnOf(ENGINE, "launch")}\n${fnOf(ENGINE, "hasLiveSession")}\n${fnOf(ENGINE, "isAuthHeldSession")}\n` +
      ` return { launch, hasLiveSession, isAuthHeldSession };`
  )(
    sessions,
    { sessionKey, slotKey },
    () => cfg.windowMode !== false,
    cfg.factory === false ? null : function () { return {}; },
    { has: () => false, count: () => 0 },
    { atCapAfterEvict: () => cfg.atCap === true },
    async () => {
      if (cfg.duringSdk) cfg.duringSdk(sessions);
      return {};
    },
    async (spec) => {
      calls.started.push(spec);
      const s = { ...spec, sessionId: "sess-1", settled: false };
      sessions.set(spec.key, s); // the real startSession sets the Map before its first await
      return s;
    },
    (...a) => calls.diag.push(a.join(" "))
  );
  return { ...api, sessions, calls };
}

// A live session occupying a slot, as the registry holds it.
const live = (key, over = {}) => [key, { key, settled: false, state: {}, ...over }];

test("N1: a TEAM-shaped launch sees the AGENT's live session, not the empty thread slot", async () => {
  const h = harness();
  h.sessions.set(...live(slotKey({ channelId: CH, agentId: AGENT })));
  const res = await h.launch({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" });
  assert.deepEqual(res, { skipped: "busy" }, "the agent is already running here");
  assert.deepEqual(h.calls.started, [], "…so nothing overwrites its registry entry");
});

test("N1: the AUTH-HOLD check reads the same slot (its copy was stripped too)", async () => {
  const h = harness();
  h.sessions.set(...live(slotKey({ channelId: CH, agentId: AGENT }), { state: { authHeld: true } }));
  const res = await h.launch({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" });
  assert.deepEqual(res, { skipped: "auth-hold" }, "the caller can post the truth, not a busy lie");
});

test("N1: the post-await FIX #7 re-check reads the same slot as well", async () => {
  // A racing creator claims the agent's slot while getSdk is in flight. With the stripped
  // spelling the re-check looked at `CH + ':'`, found nothing, and startSession clobbered the
  // racer's window.
  const key = slotKey({ channelId: CH, agentId: AGENT });
  const h = harness({ duringSdk: (sessions) => sessions.set(...live(key)) });
  const res = await h.launch({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" });
  assert.deepEqual(res, { skipped: "busy" });
  assert.deepEqual(h.calls.started, []);
});

test("N1: an agent slot and the channel's TASKLESS thread slot stay independent", async () => {
  const h = harness();
  h.sessions.set(...live(sessionKey(CH, ""))); // a pair session with no thread, in the same channel
  const res = await h.launch({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" });
  assert.equal(res.sessionId, "sess-1", "a pair session must not make an agent read as busy");
  assert.equal(h.calls.started[0].key, slotKey({ channelId: CH, agentId: AGENT }));
});

test("every PAIR caller is unchanged: no agentId means the key IS the thread key", async () => {
  const h = harness();
  const res = await h.launch({ channelId: CH, taskId: TASK, side: "responder" });
  assert.equal(res.sessionId, "sess-1");
  assert.equal(h.calls.started[0].key, sessionKey(CH, TASK));
  // …and the same call is busy once that thread's session exists.
  assert.deepEqual(await h.launch({ channelId: CH, taskId: TASK, side: "responder" }), { skipped: "busy" });
  // A SETTLED session in the slot is not a session.
  h.sessions.get(sessionKey(CH, TASK)).settled = true;
  assert.equal((await h.launch({ channelId: CH, taskId: TASK, side: "responder" })).sessionId, "sess-1");
});

test("the existing refusals still fire, and still construct nothing", async () => {
  assert.deepEqual(await harness({ windowMode: false }).launch({ channelId: CH, taskId: TASK }), { skipped: "disabled" });
  assert.deepEqual(await harness({ factory: false }).launch({ channelId: CH, taskId: TASK }), { skipped: "disabled" });
  const capped = harness({ atCap: true });
  assert.deepEqual(await capped.launch({ channelId: CH, taskId: TASK }), { skipped: "cap" });
  assert.deepEqual(capped.calls.started, []);
});
