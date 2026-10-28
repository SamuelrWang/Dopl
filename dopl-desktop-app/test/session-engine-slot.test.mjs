// LAUNCH'S SLOT ARITHMETIC — main/session-engine.js › launch.
//
// ⚠ THIS FILE WAS "FIX N1" AND THE LAW IT PINNED IS DELETED (2026-08-21, Samuel's multiplayer
// ruling 2). N1 was about `launch` asking its BUSY question about the same slot its key named:
// the key read `agentId` when there was one and collapsed to (channel, thread) when there was
// not, while the busy checks rebuilt `{channelId, threadId}` by hand and stripped the agent — so a
// team-shaped call could report a free slot for an agent that was already running. Two things
// about that are now historical:
//
//   • THE KEY BLENDS ALL THREE PARTS (`session-store.js › slotKey`). `agentId` no longer
//     REPLACES `threadId`; it joins it. So the class of bug N1 was about is not expressible.
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
// ⚠ SPLIT AT THE §2 CAP (2026-10-11). This file crossed the hard 500-line `max-lines` cap that
// `test/**/*.mjs` is linted under, so `npm run lint` was red. Two things moved and NOTHING was
// dropped:
//
//   • THE HARNESS that sat here is now `test/_session-launch-funnel-harness.mjs` — ONE copy, so
//     the REAL predicates it injects (`windowlessFloorRefusal`, `axisBOpScopedWarning`,
//     `muteRefusal`, `liveCount`, `MAX_CONCURRENT_SESSIONS`, `liveOnThread`, `slotKey`) cannot
//     drift into a second, laxer spelling. The METHOD paragraph that used to sit here — how an
//     electron-bound `launch` is brace-matched out and run over the REAL ceiling — is its header.
//   • THE CAPABILITY WAVES (D1's launch-blocking windowless tool floor, D3's Axis-B collapse
//     warning) are `test/session-engine-slot-capability.test.mjs`, in whole. They are about what
//     an ADAPTER DECLARES rather than about slots, and two of their cases drive
//     `main/runtime/capability.js` directly without the funnel at all.
//
// What is left here is the SLOT ARITHMETIC and its refusals, which is what the header above is
// about: minting, the three-part key, multiplayer, the auth hold, the cost ceiling, the
// rollbacks, and the runtime the funnel forwards.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT, CH, LAUNCH_CODE, THREAD, call, harness, live, sessionWindowless, slotKey,
} from "./_session-launch-funnel-harness.mjs";

test("MINT: launch creates an instance id, keys on it, and hands it back", async () => {
  const h = harness();
  const res = await h.launch(call({ channelId: CH, threadId: THREAD, side: "responder" }));
  assert.equal(res.agentId, "mint0000", "the ADDRESS is part of the answer");
  assert.equal(res.sessionId, "sess-1");
  assert.equal(h.calls.started[0].agentId, "mint0000", "…and it rides the spec");
  assert.equal(h.calls.started[0].key, slotKey({ channelId: CH, threadId: THREAD, agentId: "mint0000" }));
  assert.equal(h.calls.started[0].key, `${CH}:${THREAD}:mint0000`, "three parts, in that order");
});

// ⚠ THIS IS THE RULING, AND IT REPLACES "the same call is busy once that thread's session
// exists". The busy refusal WAS the one-agent-per-thread law.
test("MULTIPLAYER: a second launch on a busy thread makes a SECOND agent, never a refusal", async () => {
  const h = harness();
  const first = await h.launch(call({ channelId: CH, threadId: THREAD, side: "responder" }));
  const second = await h.launch(call({ channelId: CH, threadId: THREAD, side: "responder" }));
  assert.notEqual(second.agentId, first.agentId);
  assert.equal(h.sessions.size, 2, "two live sessions on ONE thread");
  assert.deepEqual(
    [...h.sessions.keys()],
    [`${CH}:${THREAD}:${first.agentId}`, `${CH}:${THREAD}:${second.agentId}`],
    "distinct slots — neither overwrites the other"
  );
});

test("AUTH-HOLD: a held agent on the thread is answered honestly, never as busy", async () => {
  // A machine with no Claude credential holds its session on the sign-in action. Answering
  // `busy` would tell the peer to resend against a machine that will never run it.
  const h = harness();
  const key = slotKey({ channelId: CH, threadId: THREAD, agentId: AGENT });
  h.sessions.set(...live(key, { agentId: AGENT, state: { authHeld: true } }));
  const res = await h.launch(call({ channelId: CH, threadId: THREAD, side: "responder" }));
  assert.deepEqual(res, { skipped: "auth-hold" }, "the caller can post the truth, not a busy lie");
  assert.deepEqual(h.calls.started, []);
});

test("AUTH-HOLD is scoped to the launch runtime, and any held agent on the thread counts (P4-22)", async () => {
  const other = harness({ rtId: "claude" });
  other.sessions.set(...live(slotKey({ channelId: CH, threadId: THREAD, agentId: AGENT }), { agentId: AGENT, runtimeId: "codex", state: { authHeld: true } }));
  const res = await other.launch(call({ channelId: CH, threadId: THREAD, side: "responder" }));
  assert.ok(res.sessionId, "a held Codex agent does not refuse a Claude launch");
  const second = harness({ rtId: "claude" });
  second.sessions.set(...live(slotKey({ channelId: CH, threadId: THREAD, agentId: "b2c3d4e5" }), { agentId: "b2c3d4e5", runtimeId: "claude", state: {} }));
  second.sessions.set(...live(slotKey({ channelId: CH, threadId: THREAD, agentId: AGENT }), { agentId: AGENT, runtimeId: "claude", state: { authHeld: true } }));
  assert.deepEqual(await second.launch(call({ channelId: CH, threadId: THREAD })), { skipped: "auth-hold" },
    "a held SECOND agent on the thread is not missed");
  assert.deepEqual(second.calls.signIn, ["claude"], "the refusal raises the launch runtime's sign-in prompt");
});

test("SIGNED OUT: refused before anything registers, and the prompt is raised unless the caller shows a sign-in", async () => {
  const h = harness({ rtId: "codex", signedOut: true });
  const refused = { skipped: "auth-hold" };
  assert.deepEqual(await h.launch(call({ channelId: CH, threadId: THREAD, showsSignIn: true })), refused);
  assert.deepEqual(h.calls.signIn, [], "the New Agent dialog offers its own sign-in beside the refusal");
  assert.deepEqual(await h.launch(call({ channelId: CH, threadId: THREAD, side: "responder" })), refused);
  assert.deepEqual(h.calls.started, [], "nothing registered");
  assert.deepEqual(h.calls.signIn, ["codex"]);
});

test("CHANNEL-LEVEL: a launch with no thread keys on an EMPTY middle segment", async () => {
  // Samuel's channel-agent ruling: `threadId: ''` attaches the agent to the CHANNEL. It is the
  // same three-part key, so nothing about the slot is special-cased — and it must not collide
  // with a thread-scoped agent in the same channel.
  const h = harness();
  const room = await h.launch(call({ channelId: CH, threadId: "", side: "responder" }));
  const thread = await h.launch(call({ channelId: CH, threadId: THREAD, side: "responder" }));
  assert.equal(h.calls.started[0].key, `${CH}::${room.agentId}`);
  assert.equal(h.calls.started[1].key, `${CH}:${THREAD}:${thread.agentId}`);
  assert.equal(h.sessions.size, 2);
});

test("IDLE: the spawn-idle flag reaches startSession as `parkedShell`", async () => {
  const h = harness();
  await h.launch(call({ channelId: CH, threadId: THREAD, idle: true, operatorArmed: true }));
  assert.equal(h.calls.started[0].parkedShell, true, "registered, no query");
  assert.equal(h.calls.started[0].operatorArmed, true, "…and the click IS the human decision");
  const plain = harness();
  await plain.launch(call({ channelId: CH, threadId: THREAD }));
  assert.equal(plain.calls.started[0].parkedShell, false, "the responder lane still spawns WITH a turn");
  assert.equal(plain.calls.started[0].operatorArmed, false);
});

test("RACE: the post-await FIX #7 re-check still reads the slot the key names", async () => {
  // Unreachable in practice — a freshly minted id cannot collide — but the guard is what stops
  // startSession overwriting a racing creator's registry entry, and its slot spelling has been
  // wrong before (that was N1). Driven by claiming the exact slot launch is about to take.
  const h = harness({ duringSdk: (sessions) => sessions.set(...live(`${CH}:${THREAD}:mint0000`, { agentId: "mint0000" })) });
  const res = await h.launch(call({ channelId: CH, threadId: THREAD, side: "responder" }));
  assert.deepEqual(res, { skipped: "busy" });
  assert.deepEqual(h.calls.started, []);
});

test("a HANDED-IN agent id is honoured only when it is a real one", async () => {
  const good = harness();
  const res = await good.launch(call({ channelId: CH, threadId: THREAD, agentId: AGENT }));
  assert.equal(res.agentId, AGENT, "a resume re-uses its own id, or it comes back a stranger");
  for (const bad of ["AGENT", "agent-quartz", "a1b2c3", "", null, 42]) {
    const h = harness();
    const r = await h.launch(call({ channelId: CH, threadId: THREAD, agentId: bad }));
    assert.equal(r.agentId, "mint0000", `${JSON.stringify(bad)} is not an id — mint a real one`);
  }
});

// ── the refusals, rewritten around the ONE spawn shape ───────────────────────────

test("a NON-windowless call is refused outright, and constructs nothing", async () => {
  // ⚠ THIS REPLACES TWO OLD CASES: `windowMode: false` (the settings switch) and
  // `factory: false` (no injected window factory). Both named a window lane that is deleted;
  // the early return is the ONE thing left that answers `disabled`, and it now answers it for
  // every caller that has not been moved onto the windowless shape.
  // ⚠ `detail` RIDES BESIDE `skipped`, and the sentence is the point: the word alone rendered
  // as "The agent could not be started", which tells the operator nothing. `detail` is an
  // existing wire field the renderer already PREFERS over the copy map, so the honest sentence
  // cost no new plumbing.
  const h = harness();
  assert.deepEqual(await h.launch({ channelId: CH, threadId: THREAD }),
    { skipped: "disabled", detail: "Dopl only starts windowless agents." });
  assert.deepEqual(await h.launch({ channelId: CH, threadId: THREAD, windowless: false }),
    { skipped: "disabled", detail: "Dopl only starts windowless agents." });
  assert.deepEqual(h.calls.started, [], "nothing is keyed, nothing is registered, no SDK is asked for");
});

test("the CONCURRENCY CEILING refuses at MAX_CONCURRENT_SESSIONS, and reclaims nothing", async () => {
  const h = harness();
  for (let i = 0; i < sessionWindowless.MAX_CONCURRENT_SESSIONS; i++) h.sessions.set(...live(`other-${i}:t`));
  assert.deepEqual(await h.launch(call({ channelId: CH, threadId: THREAD })), { skipped: "cap" });
  assert.deepEqual(h.calls.started, []);
  assert.equal(h.sessions.size, sessionWindowless.MAX_CONCURRENT_SESSIONS,
    "⚠ NOTHING IS EVICTED TO MAKE ROOM — the LRU relief went with the window budget it served");
  // …and one settled session is enough to let the next launch through, because `liveCount`
  // counts live children rather than map entries.
  h.sessions.get("other-0:t").settled = true;
  assert.equal((await h.launch(call({ channelId: CH, threadId: THREAD }))).sessionId, "sess-1");
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
  // ⚠ THREE, AND THE THIRD IS NOT A THIRD CEILING — it is the SAME concurrency ceiling asked a
  // SECOND time, immediately before `startSession`. The first ask is followed by ~8 awaits
  // (acquireRuntime, the two refusals, the delivery pre-flight's network work, the runtime
  // default, the dimensions, the reach and the roster) and nothing re-asked it, so two Allow
  // clicks — `trigger.js` fires `void launchResponderSession(...)` — both passed the gate and
  // the machine went to MAX+1. `session-park.js › startResume` already re-checked after ITS one
  // await for exactly this reason. Both asks now go through a named `atCap()` per module.
  assert.equal((LAUNCH_CODE.match(/skipped: 'cap'/g) || []).length, 3,
    "the concurrency ceiling asked twice (before the awaits and again before startSession), plus the chained-launch budget");
  assert.match(LAUNCH_CODE, /a\.launchChain === true && !launchBudget\.spend\(a\.channelId\)/,
    "the second cap is CONDITIONED on the chained lane: the operator's own button is never bounded by it");
});

test("an unavailable SDK refuses with its own reason rather than a busy lie", async () => {
  const h = harness({ sdkThrows: true });
  assert.deepEqual(await h.launch(call({ channelId: CH, threadId: THREAD })), { skipped: "no-sdk" });
  assert.deepEqual(h.calls.started, []);
  assert.equal(h.calls.diag.length, 1, "and it is diagnosable");
});

test("startSession's two rollbacks are reported, not swallowed", async () => {
  // A surface that could not be attached un-registers the session and returns null; a windowless
  // spawn that held on a missing credential returns `{authHold:true}`. Both must reach the
  // caller as a refusal — a launch that answers with no sessionId and no `skipped` is a caller
  // posting "started" for nothing.
  // ⚠ THE `null` HALF IS GONE, because production cannot produce it and only this harness could.
  // `deps.startSession` has one binder (`session-engine.js › startSession`), whose only falsy
  // return sat behind `if (!sessionWindowless.attachSurface(s, spec))` — and `attachSurface` is
  // `s.windowless = true; return true;`, unconditional, with no branch in its body at all. So
  // the arm this asserted was dead code, and asserting a refusal for an input the machine cannot
  // make was testing the harness. The INVARIANT it depended on is pinned instead, in
  // `session-launch-refusal-detail.test.mjs` (~:137): `attachSurface` returns true for EVERY
  // input, and its body contains no `if`, `?`, `&&` or `||` at all. The day that stops being
  // true, that case fails and names both halves — which is the pin this line was pretending to
  // be.
  const held = harness({ startSessionReturns: { authHold: true } });
  assert.deepEqual(await held.launch(call({ channelId: CH, threadId: THREAD })), { skipped: "auth-hold" });
  // ⚠ SPAWN-IDLE TOO, AND THAT IS THE HALF THAT WAS BROKEN (2026-08-22). "New Agent" is the one
  // lane an operator reaches by CLICKING, and `startSession`'s `parkedShell` early return used to
  // sit in FRONT of the credential preflight — so a signed-out machine answered `{sessionId,
  // agentId}` and this refusal shape was unreachable on it. The ordering is pinned behaviourally
  // in test/spawn-idle-auth-hold.test.mjs; this is the shape the caller sees.
  const heldIdle = harness({ startSessionReturns: { authHold: true } });
  assert.deepEqual(
    await heldIdle.launch(call({ channelId: CH, threadId: THREAD, idle: true })),
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
  await h.launch(call({ channelId: CH, threadId: THREAD, runtime: "codex" }));
  assert.deepEqual(h.calls.acquired, ["codex"], "the id the caller chose is the id acquired");
});

test("RUNTIME: a lane that passes nothing acquires the DEFAULT — the shipped behaviour", async () => {
  const h = harness();
  await h.launch(call({ channelId: CH, threadId: THREAD }));
  assert.deepEqual(h.calls.acquired, [undefined],
    "absent, not a literal: `resolve` is the one place 'no pick' becomes a runtime");
  assert.equal(h.calls.started.length, 1, "…and the launch still happens");
});

test("RUNTIME: an unusable runtime is still `no-sdk` — the wire vocabulary did not widen", async () => {
  // ⚠ THE SKIP CODE IS THE WIRE AND MUST NOT CHANGE. `trigger.js` and the directive lane both
  // branch on it, and it means "this machine has no agent runtime" on EVERY runtime — renaming
  // it for a second adapter would be a vocabulary change dressed as a cleanup.
  const h = harness({ sdkThrows: true });
  assert.deepEqual(await h.launch(call({ channelId: CH, threadId: THREAD, runtime: "codex" })), { skipped: "no-sdk" });
  assert.equal(h.calls.started.length, 0, "nothing is constructed when the runtime is unusable");
});
