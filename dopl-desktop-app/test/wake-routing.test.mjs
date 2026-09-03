// AGENT WAKE — the ROUTING truth table (2026-08-28, Samuel's tiered ruling; NARROWED 2026-09-02,
// ruling B1).
//
// ⚠ SPLIT FROM `test/session-dispatch.test.mjs` AT THE 500-LINE §2 CAP, and the seam is the same
// one the rulings draw: that file is the DELIVERY table (who HEARS a message), this one is the
// WAKE table (who STARTS a turn because of it). Both drive the SAME sliced route through the SAME
// shared harness (`_wake-dispatch-harness.mjs`), so there is one route under two tables rather
// than two harnesses drifting apart.
//
// ⚠ AND THE TWO TABLES ARE ABOUT DIFFERENT SESSION CLASSES ON PURPOSE. Every fixture in the
// delivery table is a RUNNING agent; every fixture here is DORMANT (spawn-idle or idle-parked),
// which is the only class a wake decision applies to.
//
// ── ⚠ THREE TIERS BECAME ONE DOOR AND ONE PREDICATE (2026-09-02, rulings B1 + B6) ──────────
//
// The 2026-08-28 build answered "which of my agents did this unaddressed message mean?" LOCALLY,
// in three tiers: an @-mention, a SOLO-agent room, and a per-candidate claim/pass model call. The
// server answers it now, once, at write time (RR3 — `service-wake-verdict-resilience.ts`), so:
//
//   • TIER 1 SURVIVES AS THE `agent` VERDICT. An address still wakes exactly who it names; what
//     changed is who resolves the handle, and that the sibling is no longer fed at all.
//   • TIER 2 (the solo room) IS RR3 ARM 2, computed server-side for free — and the cases below
//     that used to pin a local solo wake now pin its ABSENCE, because a machine that still had
//     the heuristic would be a second answer to a question the row already carries.
//   • TIER 3 (LLM TRIAGE) IS DELETED WHOLE. No model call, no held cursor, no budget.
//
// ⚠ WHAT DID NOT MOVE IS THE LOOP FENCE, and it is the half to not soften. It is one predicate
// now (`mayWake` — the 2026-08-31 SAME-ACCOUNT CARVE) instead of a three-string enum plus a tier
// table, because the server's own resolution is own-scoped and cannot name a peer's agent. The
// predicate is what fences the BODY-PARSE FALLBACK, which has no such structure.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  harness, agent, idle, parked, entry, peerMsg, verdictMsg, ME, PEER, A1, A2,
} from "./_wake-dispatch-harness.mjs";

// ── THE ADDRESS — the one door that wakes ───────────────────────────────────

test("wake: the verdict's named agent is woken, spawn-idle or parked, whoever wrote it", () => {
  for (const make of [idle, parked]) {
    for (const author of [ME, PEER, "third-party"]) {
      const h = harness({ agents: [make(A1)] });
      const m = verdictMsg("agent", { authorUserId: author, recipientAgentIds: [A1], body: `@${A1} take this` });
      assert.equal(h.feedLiveSession(entry, m, ME), true, author);
      assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1]);
      assert.deepEqual(h.calls.feedInbound[0].addressing, { me: true, ids: [A1] });
      assert.equal(h.calls.feedInbound[0].wake, true, "the VERDICT rides to the belt");
    }
  }
});

test("wake: an address to a SIBLING wakes nobody else — and now feeds nobody else either", () => {
  // ⚠ THE SECOND HALF IS THE NARROWING (2026-09-02). Naming one agent was always the clearest
  // statement that the message is not for the others; until B1 the others were still FED it and
  // paid a stand-down paragraph to be told so.
  const h = harness({ agents: [agent(A2), idle(A1)] });
  const m = verdictMsg("agent", { recipientAgentIds: [A2], body: `@${A2} you take it` });
  assert.equal(h.feedLiveSession(entry, m, ME), true);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A2], "only the addressee");
});

test("wake: the FALLBACK lane wakes on the machine's own parse, exactly as it did", () => {
  // A row with no stored verdict is an older server's. Tier 1 is unchanged there.
  for (const make of [idle, parked]) {
    const h = harness({ agents: [make(A1)] });
    assert.equal(h.feedLiveSession(entry, peerMsg({ body: `@agent-${A1} go` }), ME), true);
    assert.equal(h.calls.feedInbound[0].wake, true);
  }
});

// ── THE LOOP FENCE — the part to not soften ─────────────────────────────────

test("wake FENCE: a PEER'S AGENT wakes NOTHING, address included", () => {
  // ⚠ A DELIBERATE REVERSAL of 2026-08-22's "FROM ANY AUTHOR, operator, peer or PEER'S AGENT",
  // taken on 2026-08-28 and unchanged since. Another member's machine starts nothing here.
  // ⚠ ON THE STORED LANE THIS IS STRUCTURAL — the server resolves an agent recipient against the
  // AUTHOR'S OWN sessions, so no verdict can name my agent for a peer's agent. On the FALLBACK
  // lane, driven here, `mayWake` is the only fence there is.
  for (const make of [idle, parked]) {
    const named = harness({ agents: [make(A1)] });
    assert.equal(named.feedLiveSession(entry, peerMsg({ authorKind: "agent", body: `@${A1} go` }), ME), false);
    assert.equal(named.calls.feedInbound.length, 0);
    const quiet = harness({ agents: [make(A1)] });
    assert.equal(quiet.feedLiveSession(entry, peerMsg({ authorKind: "agent" }), ME), false);
  }
});

// ── ⚠ THE SAME-ACCOUNT CARVE (2026-08-31, Samuel's ruling) ──────────────────
//
// An agent-authored message posted under THIS OPERATOR'S OWN user id may wake this operator's
// dormant agents. That is what makes `launch_agent` over MCP usable: the caller holds its
// operator's credential, so its posts are authored by that account, and before the carve the
// agent id it was handed could never be spent by the one caller that had it.

test("wake CARVE: MY OWN account's agent-authored address WAKES a dormant agent", () => {
  for (const make of [idle, parked]) {
    for (const body of [`@${A1} go`, `@agent-${A1} go`]) {
      // Both doors, one carve: `@agent-<id>` is what the picker inserts and what `read_sessions`
      // and `launch_agent` publish, so the carve would be decorative if only the bare form reached.
      const h = harness({ agents: [make(A1)] });
      const m = peerMsg({ authorKind: "agent", authorUserId: ME, body });
      assert.equal(h.feedLiveSession(entry, m, ME), true, body);
      assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1]);
      assert.equal(h.calls.feedInbound[0].wake, true, "and it is a WAKE, not merely a feed");
    }
  }
});

test("wake CARVE: MY OWN account's UNADDRESSED agent post still starts NOBODY", () => {
  // ⚠ THE LOOP BRAKE'S CORE, AND THE MUTATION TO WATCH. RR2 answers an unaddressed agent post
  // with a MEMBER recipient, never an agent one — so even the arm that repairs this shape cannot
  // start a turn. Driven on both lanes: the fallback (no verdict) and the stored one.
  const fallback = harness({ agents: [idle(A1)] });
  assert.equal(fallback.feedLiveSession(entry, peerMsg({ authorKind: "agent", authorUserId: ME }), ME), false);
  const stored = harness({ agents: [idle(A1)] });
  const m = verdictMsg("reciprocal", { authorKind: "agent", authorUserId: ME, recipientUserIds: [PEER] });
  assert.equal(stored.feedLiveSession(entry, m, ME), false);
});

test("wake FENCE: an agent-authored message still FEEDS a RUNNING sibling of mine", () => {
  // The fence is on WAKING a dormant agent, the only place a turn is conjured out of nothing. Two
  // of my RUNNING agents coordinating in the open ("I'll take this one") is untouched — on the
  // stored lane it is the `member`-to-me verdict, and on the fallback lane it is ruling 4.
  const h = harness({ agents: [agent(A1)] });
  assert.equal(h.feedLiveSession(entry, peerMsg({ authorKind: "agent" }), ME), true);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1]);
  assert.equal(h.calls.feedInbound[0].wake, false, "fed, but not a wake");
});

test("wake FENCE: a session is never woken by its OWN post", () => {
  const h = harness({ agents: [idle(A1, ["agent-a1b2c3d4-3"])] });
  const m = verdictMsg("agent", {
    authorUserId: ME, clientMsgId: "agent-a1b2c3d4-3", recipientAgentIds: [A1], body: `@${A1} go`,
  });
  assert.equal(h.feedLiveSession(entry, m, ME), false);
  assert.equal(h.calls.feedInbound.length, 0);
});

test("wake FENCE: a non-`message` kind and an authorless row wake nothing", () => {
  for (const kind of ["task_started", "task_progress", "task_finished", "task_failed"]) {
    const h = harness({ agents: [idle(A1)] });
    assert.equal(h.feedLiveSession(entry, verdictMsg("agent", { kind, recipientAgentIds: [A1] }), ME), false, kind);
  }
  const anon = harness({ agents: [idle(A1)] });
  assert.equal(anon.feedLiveSession(entry, verdictMsg("agent", { authorUserId: null, recipientAgentIds: [A1] }), ME), false);
});

// ── THE SOLO HEURISTIC IS GONE, AND ITS ABSENCE IS THE ASSERTION ────────────

test("wake: a SOLO room no longer wakes on its own — RR3 does, or nobody does", () => {
  // ⚠ THESE CASES USED TO PIN THE OPPOSITE (tier 2, 2026-08-28): the one agent in a channel woke
  // on EVERY human message, with no address, decided from a roster count on this machine. The
  // guest UX that motivated it is unchanged — a guest still cannot learn an agent id — but the
  // answer is `wake_verdict: "responder"` on the row now, so the machine has no roster question
  // left to ask and does not ask one.
  const solo = harness({ agents: [idle(A1)] });
  assert.equal(solo.feedLiveSession(entry, verdictMsg("thread"), ME), false, "no local solo wake");
  assert.equal(solo.calls.feedInbound.length, 0);

  const repaired = harness({ agents: [idle(A1)] });
  assert.equal(repaired.feedLiveSession(entry, verdictMsg("responder", { recipientAgentIds: [A1] }), ME), true);
  assert.equal(repaired.calls.feedInbound[0].wake, true, "the SERVER's repair is what wakes it");
  // ⚠ THE FRAMING SAYS "ADDRESSED TO YOU", AND IT MAY NOT SAY "@-MENTIONED" (2026-09-02). A
  // repaired address is a real address, and the body it arrived in names nobody — which is why
  // `session-seed.js › addressingLines` states the FACT rather than the mechanism.
  assert.deepEqual(repaired.calls.feedInbound[0].addressing, { me: true, ids: [A1] });
});

// ── the predicates ──────────────────────────────────────────────────────────

test("wake: `dormant` is `=== true` on both shapes, and fails toward FEEDING", () => {
  // ⚠ A session object that carries neither flag — an older shape, a harness, anything the engine
  // did not build — is NOT dormant and keeps the plain feed, because the failure this guards is a
  // wasted launch, not a leak. The failure that has NO bound (an agent loop) is `mayWake`, which
  // fails CLOSED on its one axis.
  for (const junk of [undefined, null, false, "true", 1, {}]) {
    assert.equal(h0.dormant({ awaitingDirective: junk }), false, JSON.stringify(junk));
    assert.equal(h0.dormant({ state: { parked: junk } }), false, JSON.stringify(junk));
  }
  assert.equal(h0.dormant(null), false, "no session at all is not dormant");
  assert.equal(h0.dormant({ awaitingDirective: true }), true);
  assert.equal(h0.dormant({ state: { parked: true } }), true);
});

test("wake: `mayFeed` reads the VERDICT and nothing else", () => {
  // ⚠ IT NEVER DERIVES A RULE. Until 2026-08-28 it took `addressing` and answered the whole wake
  // question from it; it takes the answer now, so a change to who wakes cannot leave it behind.
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

test("wake: `planFor` is the ONE place the seven verdicts become a delivery", () => {
  // The routing predicate, driven directly: `ids` is who wakes, `context` is who merely hears.
  const ids = [A1, A2];
  const p = (m) => h0.planFor(m, ids, ME);
  assert.deepEqual(p({ wakeVerdict: "agent", recipientAgentIds: [A1] }), { ids: [A1], context: false });
  assert.deepEqual(p({ wakeVerdict: "responder", recipientAgentIds: [A2] }), { ids: [A2], context: false });
  assert.deepEqual(p({ wakeVerdict: "thread", recipientAgentIds: [] }), { ids: [], context: true });
  assert.deepEqual(p({ wakeVerdict: "none", recipientAgentIds: [] }), { ids: [], context: false });
  for (const v of ["member", "thread_peer", "reciprocal"]) {
    assert.deepEqual(p({ wakeVerdict: v, recipientAgentIds: [], recipientUserIds: [ME] }),
      { ids: [], context: true }, `${v} -> me`);
    assert.deepEqual(p({ wakeVerdict: v, recipientAgentIds: [], recipientUserIds: [PEER] }),
      { ids: [], context: false }, `${v} -> a peer`);
  }
  // No verdict at all is the OLD SERVER, and the old server's answer is the fan-out.
  assert.deepEqual(p({ body: "hi" }), { ids: [], context: true });
});

const h0 = harness();
