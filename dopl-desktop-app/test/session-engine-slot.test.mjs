// LAUNCH'S SLOT ARITHMETIC — main/session-engine.js › launch.
//
// ⚠ THIS FILE WAS "FIX N1" AND THE LAW IT PINNED IS DELETED (2026-08-21, Samuel's multiplayer
// ruling 2). N1 was about `launch` asking its BUSY question about the same slot its key named:
// the key read `agentId` when there was one and collapsed to (channel, thread) when there was
// not, while the busy checks rebuilt `{channelId, taskId}` by hand and stripped the agent — so a
// team-shaped call could report a free slot for an agent that was already running. Two things
// about that are now historical:
//
//   • THE KEY BLENDS ALL THREE PARTS (`session-store.js › slotKey`). `agentId` no longer
//     REPLACES `taskId`; it joins it. So the class of bug N1 was about is not expressible.
//   • THERE IS NO BUSY REFUSAL. `launch` mints a FRESH instance id at the one spawn funnel, so
//     the slot it is about to take cannot already be occupied, and putting a SECOND agent on a
//     thread that already has one is the feature rather than the collision. `{skipped:'busy'}`
//     survives in the code only as the post-await FIX #7 re-check, which an id collision would
//     have to trip and cannot.
//
// The cases below are rewritten around what launch actually promises now: it MINTS AND RETURNS
// an address, it refuses at the COST ceiling and nowhere else, it reports startSession's two
// rollbacks honestly, and it passes the SPAWN-IDLE flag through.
//
// ⚠ THE SPAWN SHAPES COLLAPSED TO ONE — 2026-08-20, F-228. `launch` opens with
// `if (!a.windowless) return { skipped: 'disabled' }`, so every call below carries the flag.
// Three refusals this file used to drive are deleted outright and are named at their old sites:
// the window-mode switch, the injected window FACTORY, and `sessionPark.atCapAfterEvict` — a
// WINDOW budget that freed an untouched parked shell before refusing. The ceiling left is
// `session-windowless.js › MAX_CONCURRENT_SESSIONS`, a plain refusal with nothing to reclaim,
// and it is a COST ceiling as much as a concurrency one (INVARIANTS §11: every per-session bound
// multiplies against it).
//
// METHOD: session-engine.js is electron-bound and has no extractable pure block, so the
// functions this involves are brace-matched out and evaluated together with fakes for the
// module bindings they close over. That runs the REAL control flow — including the FIX #7
// re-check after the acquireRuntime await — and the ceiling is the REAL `liveCount` + the REAL
// constant, sliced the same way, so the cap case cannot pass against a number this test made up.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
// ⚠ `launch` MOVED TO `main/session-launch.js` ON 2026-08-21 — the spawn FUNNEL split out of
// session-engine.js at the hard 500-line §2 cap when the multiplayer wave pushed that file over.
// Same function, same control flow, same refusal shapes; only the file changed.
const ENGINE = readFileSync(join(MAIN, "session-launch.js"), "utf8");
const REGISTRY_SRC = readFileSync(join(MAIN, "session-registry.js"), "utf8");
const STORE_SRC = readFileSync(join(MAIN, "session-store.js"), "utf8");
const WINDOWLESS_SRC = readFileSync(join(MAIN, "session-windowless.js"), "utf8");
// ⚠ THE REAL `session-profiles.js`, REQUIRED not sliced (2026-09-01, D1). It is the electron-free
// module, so a plain require works, and the funnel's one launch-blocking question
// (`windowlessFloorRefusal`) is therefore asked of the SHIPPED descriptors in every case below.
const REAL_PROFILES = createRequire(import.meta.url)(join(MAIN, "session-profiles.js"));

// The REAL key function, so the slot arithmetic under test is the shipped one.
const { sessionKey, slotKey, threadKeyPrefix } = new Function(
  `${fnOf(STORE_SRC, "sessionKey")}\n${fnOf(STORE_SRC, "slotKey")}\n${fnOf(STORE_SRC, "threadKeyPrefix")}\n` +
    ` return { sessionKey, slotKey, threadKeyPrefix };`
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
  assert.notEqual(at, -1, `async function ${name} not found in session-launch.js`);
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
const AGENT = "a1b2c3d4";
const TASK = "11111111-2222-3333-4444-555555555555";

function harness(cfg = {}) {
  const calls = { started: [], diag: [], acquired: [] };
  const sessions = new Map();
  // ⚠ `liveOnThread` IS SLICED IN, NOT FAKED (2026-08-21): it is how `launch` finds the agents
  // already on a thread for the auth-hold read, and a fake would let this file be green over a
  // scan that does not match the key format the same test builds keys with.
  // ⚠ `newAgentId` IS INJECTED DETERMINISTIC. The real one is a CSPRNG, which cannot be
  // asserted against; what these cases are about is that launch MINTS one and threads it into
  // the key, the spec and the answer — not about the entropy, which `agent-id` owns.
  let minted = 0;
  const store = { sessionKey, slotKey, threadKeyPrefix };
  // ⚠ THE REAL `liveOnThread`, sliced from `main/session-registry.js` (2026-08-21) rather than
  // faked. It is what the auth-hold read and the framing's sibling list resolve through, and a
  // fake would let this file be green over a registry scan that does not match the key format
  // the same test builds keys with.
  const registry = new Function(
    "deps", "store",
    `${fnOf(REGISTRY_SRC, "liveOnThread")}\n${fnOf(REGISTRY_SRC, "sessionOn")}\n return { liveOnThread, sessionOn };`
  )({ sessions }, store);
  const deps = {
    sessions,
    // ⚠ 2026-08-31 (runtime-adapter port): `getSdk` became `acquireRuntime` — the same question
    // ("can this machine load the agent runtime at all?"), the same throw-on-no, in the same
    // place. The await this file races against did not move.
    // ⚠ AND IT TAKES THE SESSION'S RUNTIME ID SINCE 2026-08-31 (port wave D). The funnel
    // FORWARDS `a.runtime` and never invents one, so every lane that passes nothing lands on the
    // DEFAULT adapter and its launch is byte-identical to what shipped. Recorded so a case can
    // assert WHICH id the funnel asked for, which is the whole of the selection contract here.
    acquireRuntime: async (runtimeId) => {
      calls.acquired.push(runtimeId);
      if (cfg.sdkThrows) throw new Error("no agent runtime on this machine");
      if (cfg.duringSdk) cfg.duringSdk(sessions);
      return {};
    },
    startSession: async (spec) => {
      calls.started.push(spec);
      if (cfg.startSessionReturns !== undefined) return cfg.startSessionReturns;
      const s = { ...spec, sessionId: "sess-1", settled: false };
      sessions.set(spec.key, s); // the real startSession sets the Map before its first await
      return s;
    },
    liveOnThread: registry.liveOnThread,
    sessionOn: registry.sessionOn,
  };
  const api = new Function(
    "deps", "store", "sessionWindowless", "diag", "newAgentId", "isAgentId", "profiles",
    `${LAUNCH_SRC}\n${fnOf(ENGINE, "hasLiveSession")}\n${fnOf(ENGINE, "isAuthHeldSession")}\n` +
      ` return { launch, hasLiveSession, isAuthHeldSession };`
  )(
    deps,
    store,
    sessionWindowless,
    (...a) => calls.diag.push(a.join(" ")),
    () => `mint${String(minted++).padStart(4, "0")}`,
    (v) => typeof v === "string" && /^[a-z][a-z0-9]{7}$/.test(v),
    // ⚠ 2026-09-01 (D1): the WINDOWLESS TOOL FLOOR refusal, injected REAL by default so the
    // happy path is measured against the shipped predicate over the shipped descriptors — a
    // fake `() => null` here would make every other case in this file green over a check that
    // does not exist. `cfg.floorRefusal` overrides it for the refusal case, which is the only
    // way to reach a null floor without editing a shipped adapter.
    {
      windowlessFloorRefusal: (id) => (cfg.floorRefusal !== undefined ? cfg.floorRefusal : REAL_PROFILES.windowlessFloorRefusal(id)),
      // ⚠ 2026-09-01 (D3): Axis B's collapse WARNING, also injected REAL. Codex declares
      // `opScoped: 'unverified'`, so this really does fire on the shipped tree — which is the
      // point: the predicate had no consumer at all before this.
      axisBOpScopedWarning: (id) => REAL_PROFILES.axisBOpScopedWarning(id),
    }
  );
  return { ...api, sessions, calls };
}

// A live session occupying a slot, as the registry holds it.
const live = (key, over = {}) => [key, { key, settled: false, state: {}, ...over }];

// ⚠ EVERY CALL CARRIES `windowless: true`. It is not ceremony: it is the ONLY spawn shape left,
// and the early return in front of it is pinned on its own in the refusals test at the bottom.
const call = (a) => ({ windowless: true, ...a });

test("MINT: launch creates an instance id, keys on it, and hands it back", async () => {
  const h = harness();
  const res = await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }));
  assert.equal(res.agentId, "mint0000", "the ADDRESS is part of the answer");
  assert.equal(res.sessionId, "sess-1");
  assert.equal(h.calls.started[0].agentId, "mint0000", "…and it rides the spec");
  assert.equal(h.calls.started[0].key, slotKey({ channelId: CH, taskId: TASK, agentId: "mint0000" }));
  assert.equal(h.calls.started[0].key, `${CH}:${TASK}:mint0000`, "three parts, in that order");
});

// ⚠ THIS IS THE RULING, AND IT REPLACES "the same call is busy once that thread's session
// exists". The busy refusal WAS the one-agent-per-thread law.
test("MULTIPLAYER: a second launch on a busy thread makes a SECOND agent, never a refusal", async () => {
  const h = harness();
  const first = await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }));
  const second = await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }));
  assert.notEqual(second.agentId, first.agentId);
  assert.equal(h.sessions.size, 2, "two live sessions on ONE thread");
  assert.deepEqual(
    [...h.sessions.keys()],
    [`${CH}:${TASK}:${first.agentId}`, `${CH}:${TASK}:${second.agentId}`],
    "distinct slots — neither overwrites the other"
  );
});

test("AUTH-HOLD: a held agent on the thread is answered honestly, never as busy", async () => {
  // A machine with no Claude credential holds its session on the sign-in action. Answering
  // `busy` would tell the peer to resend against a machine that will never run it.
  const h = harness();
  const key = slotKey({ channelId: CH, taskId: TASK, agentId: AGENT });
  h.sessions.set(...live(key, { agentId: AGENT, state: { authHeld: true } }));
  const res = await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }));
  assert.deepEqual(res, { skipped: "auth-hold" }, "the caller can post the truth, not a busy lie");
  assert.deepEqual(h.calls.started, []);
});

test("CHANNEL-LEVEL: a launch with no thread keys on an EMPTY middle segment", async () => {
  // Samuel's channel-agent ruling: `taskId: ''` attaches the agent to the CHANNEL. It is the
  // same three-part key, so nothing about the slot is special-cased — and it must not collide
  // with a thread-scoped agent in the same channel.
  const h = harness();
  const room = await h.launch(call({ channelId: CH, taskId: "", side: "responder" }));
  const thread = await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }));
  assert.equal(h.calls.started[0].key, `${CH}::${room.agentId}`);
  assert.equal(h.calls.started[1].key, `${CH}:${TASK}:${thread.agentId}`);
  assert.equal(h.sessions.size, 2);
});

test("IDLE: the spawn-idle flag reaches startSession as `parkedShell`", async () => {
  const h = harness();
  await h.launch(call({ channelId: CH, taskId: TASK, idle: true, operatorArmed: true }));
  assert.equal(h.calls.started[0].parkedShell, true, "registered, no query");
  assert.equal(h.calls.started[0].operatorArmed, true, "…and the click IS the human decision");
  const plain = harness();
  await plain.launch(call({ channelId: CH, taskId: TASK }));
  assert.equal(plain.calls.started[0].parkedShell, false, "the responder lane still spawns WITH a turn");
  assert.equal(plain.calls.started[0].operatorArmed, false);
});

test("RACE: the post-await FIX #7 re-check still reads the slot the key names", async () => {
  // Unreachable in practice — a freshly minted id cannot collide — but the guard is what stops
  // startSession overwriting a racing creator's registry entry, and its slot spelling has been
  // wrong before (that was N1). Driven by claiming the exact slot launch is about to take.
  const h = harness({ duringSdk: (sessions) => sessions.set(...live(`${CH}:${TASK}:mint0000`, { agentId: "mint0000" })) });
  const res = await h.launch(call({ channelId: CH, taskId: TASK, side: "responder" }));
  assert.deepEqual(res, { skipped: "busy" });
  assert.deepEqual(h.calls.started, []);
});

test("a HANDED-IN agent id is honoured only when it is a real one", async () => {
  const good = harness();
  const res = await good.launch(call({ channelId: CH, taskId: TASK, agentId: AGENT }));
  assert.equal(res.agentId, AGENT, "a resume re-uses its own id, or it comes back a stranger");
  for (const bad of ["AGENT", "agent-quartz", "a1b2c3", "", null, 42]) {
    const h = harness();
    const r = await h.launch(call({ channelId: CH, taskId: TASK, agentId: bad }));
    assert.equal(r.agentId, "mint0000", `${JSON.stringify(bad)} is not an id — mint a real one`);
  }
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
  // ⚠ TWO SINCE 2026-08-31, AND THE SECOND ONE IS NOT THE SHAPE THIS CASE FORBIDS. Samuel's
  // agent-chaining ruling lifted the one-generation launch bound behind a channel setting, and
  // with it ON there is no generation bound left — so a SECOND ceiling was added for the chained
  // lane alone: `launch-budget.js`, a rolling per-channel budget, spent only when
  // `a.launchChain === true`. It shares the `cap` WORD deliberately (the seven-word directive
  // vocabulary is closed and `cap`'s sentence — the machine is full, go look at what is running
  // — is true of both), and it is NOT a window budget, an eviction or a consent adopt, which is
  // what the source read above actually guards. ⚠ A THIRD would need its own argument here.
  assert.equal((LAUNCH_CODE.match(/skipped: 'cap'/g) || []).length, 2,
    "the concurrency ceiling and the chained-launch budget — no third");
  assert.match(LAUNCH_CODE, /a\.launchChain === true && !launchBudget\.spend\(a\.channelId\)/,
    "the second cap is CONDITIONED on the chained lane: the operator's own button is never bounded by it");
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
  // ⚠ SPAWN-IDLE TOO, AND THAT IS THE HALF THAT WAS BROKEN (2026-08-22). "New Agent" is the one
  // lane an operator reaches by CLICKING, and `startSession`'s `parkedShell` early return used to
  // sit in FRONT of the credential preflight — so a signed-out machine answered `{sessionId,
  // agentId}` and this refusal shape was unreachable on it. The ordering is pinned behaviourally
  // in test/spawn-idle-auth-hold.test.mjs; this is the shape the caller sees.
  const heldIdle = harness({ startSessionReturns: { authHold: true } });
  assert.deepEqual(
    await heldIdle.launch(call({ channelId: CH, taskId: TASK, idle: true })),
    { skipped: "auth-hold" }
  );
  assert.equal(heldIdle.calls.started[0].parkedShell, true, "…on a real spawn-idle spec");
});

// ── ⚠ THE RUNTIME SELECTION, AT THE FUNNEL (2026-08-31, the runtime-adapter port, wave D) ─────
//
// The funnel's job here is exactly one thing and it is the thing that makes "existing sessions
// behave identically" a PROPERTY rather than a hope: it FORWARDS what it was handed and INVENTS
// nothing. Every lane except the operator's own Launch button (and the two that read the
// channel's durable pick — `trigger.js`, `launch-directives.js`) passes no runtime at all, and
// `main/runtime/index.js › resolve` reads absent as the DEFAULT adapter — the runtime every
// pre-port session really ran on.
//
// ⚠ IT IS NOT A CONTAINMENT INPUT, which is why it may ride the caller's args where the TOOL
// PROFILE may not. `main/channel-runtime.js`'s header carries the argument: every adapter
// re-derives its own deny lists and Axis-A vocabulary, `contract.js › sealAdapter` refuses to
// register one that cannot, and the four gate steps before Axis A are core's on all of them.

test("RUNTIME: the funnel forwards the caller's pick to the registry, unchanged", async () => {
  const h = harness();
  await h.launch(call({ channelId: CH, taskId: TASK, runtime: "codex" }));
  assert.deepEqual(h.calls.acquired, ["codex"], "the id the caller chose is the id acquired");
});

test("RUNTIME: a lane that passes nothing acquires the DEFAULT — the shipped behaviour", async () => {
  const h = harness();
  await h.launch(call({ channelId: CH, taskId: TASK }));
  assert.deepEqual(h.calls.acquired, [undefined],
    "absent, not a literal: `resolve` is the one place 'no pick' becomes a runtime");
  assert.equal(h.calls.started.length, 1, "…and the launch still happens");
});

test("RUNTIME: an unusable runtime is still `no-sdk` — the wire vocabulary did not widen", async () => {
  // ⚠ THE SKIP CODE IS THE WIRE AND MUST NOT CHANGE. `trigger.js` and the directive lane both
  // branch on it, and it means "this machine has no agent runtime" on EVERY runtime — renaming
  // it for a second adapter would be a vocabulary change dressed as a cleanup.
  const h = harness({ sdkThrows: true });
  assert.deepEqual(await h.launch(call({ channelId: CH, taskId: TASK, runtime: "codex" })), { skipped: "no-sdk" });
  assert.equal(h.calls.started.length, 0, "nothing is constructed when the runtime is unusable");
});

// ── ⚠ D1: THE WINDOWLESS TOOL FLOOR IS LAUNCH-BLOCKING (2026-09-01) ──────────────────────────
//
// `contract.js › LAUNCH_BLOCKING[3]`. `capability.js › floorWindowlessTool`'s header stated the
// refusal from the day it was written — "`windowlessFloor: null` REFUSES THE WINDOWLESS LAUNCH
// rather than picking a mode" — and NOTHING refused it. The predicate returned the session's own
// stored mode instead, which starts at the NARROWEST member and resets to it on park, on a session
// with no gate surface: every tool call silently denied, including the reads the prompt orders.
//
// ⚠ THE REFUSAL IS PINNED IN TWO HALVES BECAUSE ONE HALF ALONE IS PASSABLE BY THE BUG. "The
// funnel refuses when handed a reason" would pass over a `windowlessFloorRefusal` that never
// answers one; "the shipped adapters launch" would pass over a funnel that never asks. Together
// they pin the wire.

test("D1: a runtime with NO orderable windowless floor is REFUSED before anything is constructed", async () => {
  const h = harness({ floorRefusal: "Test Runtime declares no windowless tool floor, and a session with no gate surface would silently deny every tool call it makes" });
  const res = await h.launch(call({ channelId: CH, taskId: TASK, runtime: "codex" }));
  // ⚠ `'disabled'`, NOT AN EIGHTH WIRE WORD. `REFUSAL_REASONS` is backed by a deployed column
  // CHECK, so a new word here would be a refusal the database refuses to record. `'disabled'` is
  // the existing local-only code for "this build will not run this spawn shape"; the SPECIFIC
  // reason rides the diag, which is the only surface allowed to name a runtime.
  assert.deepEqual(res, { skipped: "disabled" });
  // ⚠ NOTHING IS SPENT. The check sits after acquireRuntime and BEFORE startSession, so there is
  // no session in the registry, no slot held and no rollback to get wrong.
  assert.equal(h.calls.started.length, 0, "no session is constructed");
  assert.equal(h.sessions.size, 0, "and none is registered");
  assert.deepEqual(h.calls.acquired, ["codex"], "…but the runtime WAS acquired first: the question is about a known runtime");
  assert.ok(h.calls.diag.some((l) => /windowless launch refused/.test(l)),
    "the operator-readable sentence lands in the diag, the one surface that may name a runtime");
});

test("D1: every SHIPPED adapter declares an orderable floor, so none of them is refused", async () => {
  // The other half. Driven through the REAL predicate over the REAL descriptors — a fake would
  // make this file green over a check that does not exist.
  for (const runtime of ["claude", "codex", "cursor", undefined]) {
    const h = harness();
    const res = await h.launch(call({ channelId: CH, taskId: TASK, runtime }));
    assert.equal(res.skipped, undefined, `${runtime || "(default)"} must launch`);
    assert.equal(h.calls.started.length, 1, `${runtime || "(default)"} constructs its session`);
  }
});

test("D1: the predicate itself answers a SENTENCE for a null floor and for an unorderable one", () => {
  // ⚠ THE MUTATION, RUN HERE RATHER THAN DESCRIBED. `floorWindowlessTool` must answer `null`
  // (refuse) and NOT the session's own mode, for BOTH causes — an absent floor and a floor that
  // is not one of the runtime's declared modes. Before the fix both returned a mode, and the
  // narrowest one at that.
  const capability = createRequire(import.meta.url)(join(MAIN, "runtime", "capability.js"));
  const base = {
    label: "Test Runtime",
    toolMode: { options: [{ value: "narrow" }, { value: "wide" }], windowlessFloor: "wide" },
  };
  assert.equal(capability.windowlessFloorRefusal(base), null, "a declared, orderable floor is fine");
  assert.equal(capability.floorWindowlessTool(base, "narrow"), "wide", "…and it raises");

  const noFloor = { ...base, toolMode: { ...base.toolMode, windowlessFloor: null } };
  assert.match(capability.windowlessFloorRefusal(noFloor), /declares no windowless tool floor/);
  assert.equal(capability.floorWindowlessTool(noFloor, "narrow"), null,
    "REFUSE, never the session's own mode — which here is the NARROWEST, i.e. deny-everything");
  assert.equal(capability.floorWindowlessTool(noFloor, "wide"), null, "…and not the wide one either");

  const badFloor = { ...base, toolMode: { ...base.toolMode, windowlessFloor: "nonesuch" } };
  assert.match(capability.windowlessFloorRefusal(badFloor), /not one of the modes it declares/);
  assert.equal(capability.floorWindowlessTool(badFloor, "narrow"), null);
  // ⚠ NAMES THE RUNTIME'S OWN LABEL AND NO VENDOR.
  assert.match(capability.windowlessFloorRefusal(noFloor), /^Test Runtime /);
});

// ── ⚠ D3: AXIS B'S COLLAPSE WARNING HAS A CONSUMER (2026-09-01) ──────────────────────────────
//
// `capability.js › axisBOpScoped` was declared with a documented severe consequence — "`false`
// COLLAPSES AXIS B FROM OP-SCOPED TO WHOLE-TOOL — every channel call gates, READS INCLUDED — and a
// held inbound on a windowless session is held forever" — and grepping `main/` and `src/` for it
// returned exactly one hit, a COMMENT. So the operator got no warning and the launch was not
// refused: a declaration that could not do its job.
//
// ⚠ WARNING, NOT REFUSAL, AND THIS FILE PINS THAT TOO. The direction of failure is CLOSED
// (unreadable input -> `postFieldsOk` fails -> `gate` -> a windowless gate DENIES), so the agent
// is broken and the boundary is not. A refusal here would take a registered adapter off the only
// spawn shape this tree has, which is a release decision and not this function's.

test("D3: a runtime whose Axis B is not op-scoped LAUNCHES, and says so", async () => {
  // Codex declares `axisB.opScoped: 'unverified'` (§5 item C1, unmeasured), so this fires against
  // the SHIPPED descriptor — no fake, no hypothetical fourth adapter.
  const h = harness();
  const res = await h.launch(call({ channelId: CH, taskId: TASK, runtime: "codex" }));
  assert.equal(res.skipped, undefined, "it is a WARNING — the launch proceeds");
  assert.equal(h.calls.started.length, 1, "…and the session is really constructed");
  const warned = h.calls.diag.filter((l) => /Axis B is not op-scoped/.test(l));
  assert.equal(warned.length, 1, "exactly one line, at the launch");
  assert.match(warned[0], /READS INCLUDED/, "it names the consequence, not just the field");
  assert.match(warned[0], /not been measured/, "…and that this one is UNVERIFIED rather than false");
});

test("D3: an op-scoped runtime says NOTHING — a warning on every launch is a warning nobody reads", async () => {
  for (const runtime of ["claude", "cursor"]) {
    const h = harness();
    await h.launch(call({ channelId: CH, taskId: TASK, runtime }));
    assert.deepEqual(h.calls.diag.filter((l) => /Axis B is not op-scoped/.test(l)), [], runtime);
  }
});

test("D3: the predicate distinguishes false from unverified, and names no vendor", () => {
  const capability = createRequire(import.meta.url)(join(MAIN, "runtime", "capability.js"));
  const at = (opScoped) => ({ label: "Test Runtime", axisB: { opScoped } });
  assert.equal(capability.axisBOpScopedWarning(at(true)), null, "op-scoped: no warning at all");
  assert.match(capability.axisBOpScopedWarning(at(false)), /^Test Runtime cannot show the gate/);
  assert.match(capability.axisBOpScopedWarning(at("unverified")), /^Test Runtime has not been measured/);
  // ⚠ ABSENT IS NOT `true`. A descriptor that omits the field has not declared op-scoping, and
  // reading absent as capable is exactly the fail-OPEN this predicate exists to refuse.
  assert.match(capability.axisBOpScopedWarning(at(undefined)), /cannot show the gate/);
  assert.match(capability.axisBOpScopedWarning({ label: "Test Runtime" }), /cannot show the gate/);
  for (const v of [true, false, "unverified", undefined]) {
    const w = capability.axisBOpScopedWarning(at(v));
    if (w) assert.ok(!/claude|codex|cursor|anthropic|openai/i.test(w), `names a vendor: ${w}`);
  }
});
