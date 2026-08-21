// FIX N1 — launch() must ask its busy questions about the SAME slot its key names.
//
// `launch` resolves the registry key with `store.slotKey(a)`, which reads `agentId` when
// there is one and collapses to (channel, thread) when there is not. Its two busy checks
// then rebuilt `{ channelId, taskId }` BY HAND, stripping the agent. For a team-shaped call
// (agentId set, taskId '') the key said (channel, agent) while the checks asked about
// (channel, ''), so launch could report a free slot for an agent that is already running and
// then let startSession overwrite the registry entry — orphaning that agent's live session.
// This is the same latent bug D2 already fixed in session-park.startResume, one file over.
//
// ⚠ THE SPAWN SHAPES COLLAPSED TO ONE — 2026-08-20, F-228. `launch` opens with
// `if (!a.windowless) return { skipped: 'disabled' }`, so every call below carries the flag.
// Three of the refusals this file used to drive are deleted outright and are named at their old
// sites: the window-mode switch, the injected window FACTORY, and `sessionPark.atCapAfterEvict`
// — a WINDOW budget that freed an untouched parked shell before refusing, and that an adoptable
// pre-consent card was net-zero against. The ceiling left is
// `session-windowless.js › MAX_CONCURRENT_SESSIONS`, a plain refusal with nothing to reclaim,
// and it is a COST ceiling as much as a concurrency one (INVARIANTS §11: every per-session bound
// multiplies against it). ⚠ THE SLOT ARITHMETIC N1 IS ABOUT DID NOT CHANGE AT ALL, which is why
// every one of its cases below still runs.
//
// METHOD: session-engine.js is electron-bound and has no extractable pure block, so the three
// functions this involves are brace-matched out and evaluated together with fakes for the
// module bindings they close over. That runs the REAL control flow — including the FIX #7
// re-check after the getSdk await, which is the other place the two spellings had to agree —
// and the ceiling is the REAL `liveCount` + the REAL constant, sliced the same way, so the cap
// case cannot pass against a number this test made up.

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
const WINDOWLESS_SRC = readFileSync(join(MAIN, "session-windowless.js"), "utf8");

// The REAL key function, so the slot arithmetic under test is the shipped one.
const { sessionKey, slotKey } = new Function(
  `${fnOf(STORE_SRC, "sessionKey")}\n${fnOf(STORE_SRC, "slotKey")}\n return { sessionKey, slotKey };`
)();

// ...and the REAL ceiling. `session-windowless.js` requires consent / targeting / channel-post at
// its top, so it cannot simply be imported into a plain node test; the two members `launch`
// touches are sliced instead.
const CAP_DECL = (WINDOWLESS_SRC.match(/^const MAX_CONCURRENT_SESSIONS = \d+;$/m) || [])[0];
assert.ok(CAP_DECL, "MAX_CONCURRENT_SESSIONS moved or changed shape in session-windowless.js");
const sessionWindowless = new Function(
  `${CAP_DECL}\n${fnOf(WINDOWLESS_SRC, "liveCount")}\n return { liveCount, MAX_CONCURRENT_SESSIONS };`
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

const LAUNCH_SRC = asyncFnOf(ENGINE, "launch");
// ⚠ CODE ONLY. `launch`'s comments NAME the branches that were deleted — that is the house rule
// (nothing is removed silently) — so a negative grep over the raw source would fail on the very
// annotation that documents the removal. Line comments blanked; `launch` carries no string
// literal containing `//`.
const LAUNCH_CODE = LAUNCH_SRC.replace(/\/\/[^\n]*/g, "");

const CH = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const AGENT = "agent-quartz";
const TASK = "11111111-2222-3333-4444-555555555555";

function harness(cfg = {}) {
  const calls = { started: [], diag: [] };
  const sessions = new Map();
  const api = new Function(
    "sessions", "store", "sessionWindowless", "getSdk", "startSession", "diag",
    `${LAUNCH_SRC}\n${fnOf(ENGINE, "hasLiveSession")}\n${fnOf(ENGINE, "isAuthHeldSession")}\n` +
      ` return { launch, hasLiveSession, isAuthHeldSession };`
  )(
    sessions,
    { sessionKey, slotKey },
    sessionWindowless,
    async () => {
      if (cfg.sdkThrows) throw new Error("no sdk on this machine");
      if (cfg.duringSdk) cfg.duringSdk(sessions);
      return {};
    },
    async (spec) => {
      calls.started.push(spec);
      if (cfg.startSessionReturns !== undefined) return cfg.startSessionReturns;
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

// ⚠ EVERY CALL CARRIES `windowless: true`. It is not ceremony: it is the ONLY spawn shape left,
// and the early return in front of it is pinned on its own in the refusals test at the bottom.
const call = (a) => ({ windowless: true, ...a });

test("N1: a TEAM-shaped launch sees the AGENT's live session, not the empty thread slot", async () => {
  const h = harness();
  h.sessions.set(...live(slotKey({ channelId: CH, agentId: AGENT })));
  const res = await h.launch(call({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" }));
  assert.deepEqual(res, { skipped: "busy" }, "the agent is already running here");
  assert.deepEqual(h.calls.started, [], "…so nothing overwrites its registry entry");
});

test("N1: the AUTH-HOLD check reads the same slot (its copy was stripped too)", async () => {
  const h = harness();
  h.sessions.set(...live(slotKey({ channelId: CH, agentId: AGENT }), { state: { authHeld: true } }));
  const res = await h.launch(call({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" }));
  assert.deepEqual(res, { skipped: "auth-hold" }, "the caller can post the truth, not a busy lie");
});

test("N1: the post-await FIX #7 re-check reads the same slot as well", async () => {
  // A racing creator claims the agent's slot while getSdk is in flight. With the stripped
  // spelling the re-check looked at `CH + ':'`, found nothing, and startSession clobbered the
  // racer's session.
  const key = slotKey({ channelId: CH, agentId: AGENT });
  const h = harness({ duringSdk: (sessions) => sessions.set(...live(key)) });
  const res = await h.launch(call({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" }));
  assert.deepEqual(res, { skipped: "busy" });
  assert.deepEqual(h.calls.started, []);
});

test("N1: an agent slot and the channel's TASKLESS thread slot stay independent", async () => {
  const h = harness();
  h.sessions.set(...live(sessionKey(CH, ""))); // a pair session with no thread, in the same channel
  const res = await h.launch(call({ channelId: CH, taskId: "", agentId: AGENT, side: "responder" }));
  assert.equal(res.sessionId, "sess-1", "a pair session must not make an agent read as busy");
  assert.equal(h.calls.started[0].key, slotKey({ channelId: CH, agentId: AGENT }));
});

test("every PAIR caller is unchanged: no agentId means the key IS the thread key", async () => {
  const h = harness();
  const res = await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }));
  assert.equal(res.sessionId, "sess-1");
  assert.equal(h.calls.started[0].key, sessionKey(CH, TASK));
  // …and the same call is busy once that thread's session exists.
  assert.deepEqual(await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" })), { skipped: "busy" });
  // A SETTLED session in the slot is not a session — and does not count against the ceiling.
  h.sessions.get(sessionKey(CH, TASK)).settled = true;
  assert.equal((await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }))).sessionId, "sess-1");
});

// ── the refusals, rewritten around the ONE spawn shape ───────────────────────────

test("a NON-windowless call is refused outright, and constructs nothing", async () => {
  // ⚠ THIS REPLACES TWO OLD CASES: `windowMode: false` (the settings switch) and
  // `factory: false` (no injected window factory). Both named a window lane that is deleted;
  // the early return is the ONE thing left that answers `disabled`, and it now answers it for
  // every caller that has not been moved onto the windowless shape.
  const h = harness();
  assert.deepEqual(await h.launch({ channelId: CH, taskId: TASK }), { skipped: "disabled" });
  assert.deepEqual(await h.launch({ channelId: CH, taskId: TASK, windowless: false }), { skipped: "disabled" });
  assert.deepEqual(h.calls.started, [], "nothing is keyed, nothing is registered, no SDK is asked for");
});

test("the CONCURRENCY CEILING refuses at MAX_CONCURRENT_SESSIONS, and reclaims nothing", async () => {
  const h = harness();
  for (let i = 0; i < sessionWindowless.MAX_CONCURRENT_SESSIONS; i++) h.sessions.set(...live(`other-${i}:t`));
  assert.deepEqual(await h.launch(call({ channelId: CH, taskId: TASK })), { skipped: "cap" });
  assert.deepEqual(h.calls.started, []);
  assert.equal(h.sessions.size, sessionWindowless.MAX_CONCURRENT_SESSIONS,
    "⚠ NOTHING IS EVICTED TO MAKE ROOM — the LRU relief went with the window budget it served");
  // …and one settled session is enough to let the next launch through, because `liveCount`
  // counts live children rather than map entries.
  h.sessions.get("other-0:t").settled = true;
  assert.equal((await h.launch(call({ channelId: CH, taskId: TASK }))).sessionId, "sess-1");
});

test("the cap is ONE branch: no eviction, no adopt, no second budget in launch", () => {
  // The old shape was two ceilings — a WINDOW budget an adoptable pre-consent card was net-zero
  // against (AUDIT D4), and this one. A source read rather than a behavioural case because the
  // failure is a branch REAPPEARING, which no input can provoke.
  assert.ok(!/atCapAfterEvict|evictIdleShell|MAX_SESSION_WINDOWS|adoptsConsent/.test(LAUNCH_CODE),
    "launch has grown back a window budget, an eviction or the consent adopt");
  assert.equal((LAUNCH_CODE.match(/skipped: 'cap'/g) || []).length, 1, "exactly one cap refusal");
});

test("an unavailable SDK refuses with its own reason rather than a busy lie", async () => {
  const h = harness({ sdkThrows: true });
  assert.deepEqual(await h.launch(call({ channelId: CH, taskId: TASK })), { skipped: "no-sdk" });
  assert.deepEqual(h.calls.started, []);
  assert.equal(h.calls.diag.length, 1, "and it is diagnosable");
});

test("startSession's two rollbacks are reported, not swallowed", async () => {
  // A surface that could not be attached un-registers the session and returns null; a windowless
  // spawn that held on a missing credential returns `{authHold:true}`. Both must reach the
  // caller as a refusal — a launch that answers with no sessionId and no `skipped` is a caller
  // posting "started" for nothing.
  const nulled = harness({ startSessionReturns: null });
  assert.deepEqual(await nulled.launch(call({ channelId: CH, taskId: TASK })), { skipped: "disabled" });
  const held = harness({ startSessionReturns: { authHold: true } });
  assert.deepEqual(await held.launch(call({ channelId: CH, taskId: TASK })), { skipped: "auth-hold" });
});
