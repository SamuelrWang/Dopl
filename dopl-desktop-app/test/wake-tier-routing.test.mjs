// TIERED AGENT WAKE — the ROUTING truth table (2026-08-28, Samuel's ruling).
//
// ⚠ SPLIT FROM `test/session-dispatch.test.mjs` AT THE 500-LINE §2 CAP, and the seam is the same
// one the ruling drew: that file is the FAN-OUT table (ruling 4, 2026-08-21 — who HEARS a message
// on a thread), this one is the WAKE table (who STARTS a turn because of it). Both drive the SAME
// sliced route through the SAME shared harness (`_wake-dispatch-harness.mjs`), so there is one
// route under two tables rather than two harnesses drifting apart.
//
// ⚠ AND THE TWO TABLES ARE ABOUT DIFFERENT SESSION CLASSES ON PURPOSE. Every fixture in the
// fan-out table is a RUNNING agent, which no tier governs; every fixture here is DORMANT
// (spawn-idle or idle-parked), which is the only class a wake decision applies to.
//
// The tier TABLE itself (the fence, the three tiers, the parse, the tie-break) is
// `test/wake-tiers.test.mjs`; the model CALL is `test/wake-triage-call.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  harness, agent, idle, parked, authHeld, entry, peerMsg, ME, PEER, A1, A2, A3,
} from "./_wake-dispatch-harness.mjs";

// ── TIERED AGENT WAKE (2026-08-28, Samuel's ruling — AMENDS the 2026-08-22 rule) ────────────
//
// ⚠ THE ONE HOLD-BACK IN THE FAN-OUT, AND IT NOW GOVERNS A WIDER CLASS ON A NARROWER KEY. The
// 2026-08-22 rule fenced SPAWN-IDLE shells and opened on ONE key, the @-mention, from ANY author.
// This build fences every DORMANT session (spawn-idle OR idle-parked) and opens on THREE keys —
// @-mention, a solo-agent room, a triage claim — all of them behind a LOOP FENCE that only
// human-authored `message` rows pass.
//
// ⚠ THE FIXTURE ABOVE IS STILL WHAT MAKES THE CASES ABOVE HONEST: `agent()` carries neither
// `awaitingDirective` nor a parked `state`, so every case ABOVE this block drives the
// not-dormant path and pins that ruling 4's fan-out is untouched. A RUNNING agent hears
// everything on its thread, tier or no tier.

// ── TIER 1: the @-mention, kept ─────────────────────────────────────────────

test("wake T1: an @-mention of ITS OWN id wakes a dormant agent — spawn-idle or parked", async () => {
  for (const make of [idle, parked]) {
    for (const author of [ME, PEER, "third-party"]) {
      const h = harness({ agents: [make(A1)] });
      assert.equal(await h.feedLiveSession(entry, peerMsg({ authorUserId: author, body: `@${A1} take this` }), ME), true, author);
      assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1]);
      assert.deepEqual(h.calls.feedInbound[0].addressing, { me: true, ids: [A1] });
      assert.equal(h.calls.feedInbound[0].wake, true, "the VERDICT rides to the belt");
      assert.equal(h.calls.triage.length, 0, "…and an @-message buys no triage");
    }
  }
});

test("wake T1: a message addressed to a SIBLING wakes nobody else, and buys no triage", async () => {
  // Naming one agent is the clearest possible statement that the message is not for the others,
  // so it SUPPRESSES tiers 2 and 3 outright rather than falling through to them.
  const h = harness({ agents: [agent(A2), idle(A1)] });
  assert.equal(await h.feedLiveSession(entry, peerMsg({ body: `@${A2} you take it` }), ME), true);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A2], "only the addressee");
  assert.equal(h.calls.triage.length, 0);
});

// ── THE LOOP FENCE — the part to not soften ─────────────────────────────────

test("wake FENCE: an AGENT-authored message wakes NOTHING, @-mention included", async () => {
  // ⚠ THIS IS A DELIBERATE REVERSAL of 2026-08-22's "FROM ANY AUTHOR, operator, peer or PEER'S
  // AGENT". Tiers 2 and 3 wake on traffic nobody addressed, so two agents that can wake each
  // other on unaddressed prose is a loop with no operator in it. The @-mention lane is narrowed
  // with them rather than left as the one door a loop could still use.
  for (const make of [idle, parked]) {
    const named = harness({ agents: [make(A1)] });
    assert.equal(await named.feedLiveSession(entry, peerMsg({ authorKind: "agent", body: `@${A1} go` }), ME), false);
    assert.equal(named.calls.feedInbound.length, 0);
    const solo = harness({ agents: [make(A1)] });
    assert.equal(await solo.feedLiveSession(entry, peerMsg({ authorKind: "agent" }), ME), false);
    assert.equal(solo.calls.triage.length, 0, "and it does not even buy a router call");
  }
});

test("wake FENCE: an agent-authored message still FEEDS a RUNNING sibling — ruling 4 survives", async () => {
  // The fence is on WAKING a dormant agent, which is the only place a turn is conjured out of
  // nothing. Two of my RUNNING agents coordinating in the open ("I'll take this one") is the
  // 2026-08-21 fan-out and is untouched.
  const h = harness({ agents: [agent(A1)] });
  assert.equal(await h.feedLiveSession(entry, peerMsg({ authorKind: "agent" }), ME), true);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1]);
  assert.equal(h.calls.feedInbound[0].wake, false, "fed, but not a wake");
});

test("wake FENCE: a session is never woken by its OWN post", async () => {
  const h = harness({ agents: [idle(A1, ["agent-a1b2c3d4-3"])], channelAgents: [A1] });
  assert.equal(
    await h.feedLiveSession(entry, peerMsg({ authorUserId: ME, clientMsgId: "agent-a1b2c3d4-3", body: `@${A1} go` }), ME),
    false
  );
  assert.equal(h.calls.feedInbound.length, 0);
});

test("wake FENCE: a non-`message` kind and an authorless row wake nothing", async () => {
  for (const kind of ["task_started", "task_progress", "task_finished", "task_failed"]) {
    const h = harness({ agents: [idle(A1)] });
    assert.equal(await h.feedLiveSession(entry, peerMsg({ kind, body: `@${A1} go` }), ME), false, kind);
  }
  const anon = harness({ agents: [idle(A1)] });
  assert.equal(await anon.feedLiveSession(entry, peerMsg({ authorUserId: null }), ME), false);
});

// ── TIER 2: the SOLO room ───────────────────────────────────────────────────

test("wake T2: in a SOLO-agent channel EVERY human message wakes it — no @ needed", async () => {
  // The guest UX gap this ruling exists for: a guest cannot learn an agent id, so under the
  // @-only rule they could never reach the one agent sitting in the room with them.
  for (const make of [idle, parked]) {
    for (const author of [ME, PEER, "a-guest"]) {
      const h = harness({ agents: [make(A1)], channelAgents: [A1] });
      assert.equal(await h.feedLiveSession(entry, peerMsg({ authorUserId: author }), ME), true, author);
      assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1]);
      assert.equal(h.calls.feedInbound[0].wake, true);
      assert.equal(h.calls.feedInbound[0].addressing, null, "woken WITHOUT being addressed");
      assert.equal(h.calls.triage.length, 0, "⚠ AND A SOLO ROOM BUYS NO MODEL CALL AT ALL");
    }
  }
});

test("wake T2: the roster is the CHANNEL's, not the thread's", async () => {
  // A channel holding a second agent on another thread is NOT a solo room, even though only one
  // of them is live on the thread this message landed in. `agentIdsInChannel` is the source.
  const h = harness({ agents: [idle(A1)], channelAgents: [A1, A2], triageClaim: "" });
  assert.equal(await h.feedLiveSession(entry, peerMsg(), ME), false, "triage ran and nobody claimed");
  assert.equal(h.calls.triage.length, 1, "…which means it took the TRIAGE tier, not the solo one");
});

test("wake T2: an empty/unreadable channel roster wakes nobody", async () => {
  const h = harness({ agents: [idle(A1)], channelAgents: [] });
  assert.equal(await h.feedLiveSession(entry, peerMsg(), ME), false);
  assert.equal(h.calls.triage.length, 0);
});

// ── TIER 3: the triage claim ────────────────────────────────────────────────

test("wake T3: a multi-agent room does NOT wake on an unaddressed message unless someone claims", async () => {
  const none = harness({ agents: [idle(A1), idle(A2)], channelAgents: [A1, A2], triageClaim: "" });
  assert.equal(await none.feedLiveSession(entry, peerMsg(), ME), false, "nobody claimed, nobody woke");
  assert.equal(none.calls.feedInbound.length, 0);
  assert.equal(none.calls.triage.length, 1, "ONE pass for the message, not one per agent call site");
  assert.deepEqual(none.calls.triage[0].candidates.map((s) => s.agentId), [A1, A2], "in spawn order");

  const claimed = harness({ agents: [idle(A1), idle(A2)], channelAgents: [A1, A2], triageClaim: A2 });
  assert.equal(await claimed.feedLiveSession(entry, peerMsg(), ME), true);
  assert.deepEqual(claimed.calls.feedInbound.map((c) => c.agentId), [A2], "only the claimant");
  assert.equal(claimed.calls.feedInbound[0].wake, true);
});

test("wake T3: the candidate list is DORMANT sessions only, in spawn order", async () => {
  // A running agent needs no wake (it is already fed by the fan-out) and an AUTH-HELD one cannot
  // be resumed at all (`wakeEffects` refuses while `authHeld`), so neither buys a model call.
  const h = harness({ agents: [agent(A1), parked(A2), authHeld(A3)], channelAgents: [A1, A2, A3] });
  await h.feedLiveSession(entry, peerMsg(), ME);
  assert.equal(h.calls.triage.length, 1);
  assert.deepEqual(h.calls.triage[0].candidates.map((s) => s.agentId), [A2],
    "the running one and the auth-held one are not candidates");
  assert.deepEqual(h.calls.triage[0].channelId, entry.channel.id);
});

test("wake T3: a running agent is fed regardless of what triage said", async () => {
  const h = harness({ agents: [agent(A1), idle(A2)], channelAgents: [A1, A2], triageClaim: "" });
  assert.equal(await h.feedLiveSession(entry, peerMsg(), ME), true);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1],
    "the live agent is fed, the undirected one is not");
});

// ── the predicates ──────────────────────────────────────────────────────────

test("wake: `dormant` is `=== true` on both shapes, and fails toward FEEDING", () => {
  // ⚠ A session object that carries neither flag — an older shape, a harness, anything the engine
  // did not build — is NOT dormant and keeps the plain fan-out, because the failure this guards is
  // a wasted launch, not a leak. The failure that has NO bound (an agent loop) is fenced upstream
  // in `wakeTiers.wakeEligible`, which fails CLOSED on every axis.
  for (const junk of [undefined, null, false, "true", 1, {}]) {
    assert.equal(h0.dormant({ awaitingDirective: junk }), false, JSON.stringify(junk));
    assert.equal(h0.dormant({ state: { parked: junk } }), false, JSON.stringify(junk));
  }
  assert.equal(h0.dormant(null), false, "no session at all is not dormant");
  assert.equal(h0.dormant({ awaitingDirective: true }), true);
  assert.equal(h0.dormant({ state: { parked: true } }), true);
});

test("wake: `mayFeed` reads the VERDICT and nothing else", () => {
  // ⚠ IT NO LONGER DERIVES A RULE. Until 2026-08-28 this took `addressing` and answered the whole
  // wake question from it; there are three tiers now and two of them carry no addressing at all,
  // so a `mayFeed` that still read the mention verdict would have refused exactly the wakes the
  // ruling adds.
  for (const junk of [undefined, null, false, "true", 1, {}]) {
    assert.equal(h0.mayFeed({ awaitingDirective: junk }, false), true, JSON.stringify(junk));
  }
  assert.equal(h0.mayFeed(null, false), true, "no session at all is not a hold-back");
  assert.equal(h0.mayFeed({ awaitingDirective: true }, false), false);
  assert.equal(h0.mayFeed({ state: { parked: true } }, false), false);
  assert.equal(h0.mayFeed({ awaitingDirective: true }, true), true);
  assert.equal(h0.mayFeed({ state: { parked: true } }, true), true);
  // And a truthy-but-wrong verdict must not open it either.
  for (const truthy of ["yes", 1, {}]) {
    assert.equal(h0.mayFeed({ awaitingDirective: true }, truthy), false, JSON.stringify(truthy));
  }
});

test("wake: `wakeCandidates` is the one place the three candidate exclusions live", () => {
  const own = { ...idle("aaaaaaaa", ["agent-x-1"]) };
  const list = h0.wakeCandidates(
    [agent(A1), idle(A2), authHeld(A3), own],
    { clientMsgId: "agent-x-1" }
  );
  assert.deepEqual(list.map((s) => s.agentId), [A2],
    "running, auth-held and self-authored are all out");
});
const h0 = harness();
