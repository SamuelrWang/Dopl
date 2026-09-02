// THE LISTENER'S ONE PRE-CLASSIFY ROUTE — main/session-dispatch.js, route (1)
// `feedLiveSession`, plus the `authorLabel` resolver it feeds through.
//
// ⚠ THIS FILE HELD FIVE ROUTES' WORTH OF TABLE AND NOW HOLDS ONE (2026-08-20, F-228). The
// excision block at the foot names what stood here. F-228 says these truth tables must SURVIVE
// as "the record that the guards still hold", so the file is rewritten down to the guards that
// are still there rather than removed — INVARIANTS §14.
//
// SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-DISPATCH-PURE block holds
// `authorLabel`, the @agent-id parser and `feedLiveSession`. Every dependency (targeting,
// sessionEngine, io, diag) is a module-scope binding, so we slice the block, prove it is
// electron/fs/require-free (§H-8), and inject fakes to pin the routing TRUTH TABLE without an
// electron require.
//
// ⚠ THE TABLE CHANGED SHAPE ON 2026-08-21 (Samuel's fan-out ruling), AND THREE CASES THAT USED
// TO PIN A FENCE NOW PIN ITS OPPOSITE. That is a RULING, not a regression, so the old
// assertions are rewritten rather than deleted — the record of what the fence was lives in
// each case's comment. What went:
//   • "a THIRD party never injects a turn (FIX L1)" — the feed was fenced on
//     `author === counterpartyFor(...)`. The fence is the THREAD now: every message in a
//     thread reaches every live agent on it. `counterpartyFor` is no longer consulted here.
//   • "my OWN message fails closed" — the operator steering their own agents in the open is
//     the product. Own posts are fed.
//   • "a session with NO stored counterparty feeds nobody" — there is no binding to be missing.
// What REPLACES them is the exclusion that is actually load-bearing: a session is never fed
// its own post back, recognised by the per-instance `client_msg_id` it stamped.
//
// ⚠ AND THAT THE ROUTE IS UNGATED. Route (1) never had the window-mode guard the other four
// opened with, and now that the switch itself is gone the absence is asserted against the
// SOURCE rather than by driving a setting that no longer exists.

import { test } from "node:test";
import assert from "node:assert/strict";

// ⚠ THE HARNESS, THE SLICED BLOCK AND ITS PURITY PROOF ALL MOVED TO `_wake-dispatch-harness.mjs`
// ON 2026-08-28 (the §2 500-line cap), because there are TWO truth tables over this ONE route
// now: this one (the FAN-OUT — who HEARS a message) and `wake-tier-routing.test.mjs` (the WAKE —
// who STARTS a turn because of it). A copy of the harness in each is two harnesses to keep in
// step, and the day they drift one table is measuring a route the app does not run.
//
// ⚠ THE FIXTURES BELOW ARE ALL RUNNING AGENTS, and that is what keeps this table honest about the
// fan-out: `agent()` carries neither `awaitingDirective` nor a parked `state`, so every case here
// drives the NOT-DORMANT path — the one no wake tier governs.
import {
  BLOCK, CODE, harness, agent, entry, peerMsg, ME, PEER, TASK, A1, A2,
} from "./_wake-dispatch-harness.mjs";

// Referenced by the pins at the foot of this file; the slice + purity proof happen in the harness.
assert.ok(BLOCK.length > 0, "the SESSION-DISPATCH-PURE block is sliceable");

// ── (1) feedLiveSession — THE FAN-OUT TABLE ──────────────────────────────────

test("feed: EVERY live agent on the thread is fed, and each is told which it is", async () => {
  const h = harness({ agents: [agent(A1), agent(A2)] });
  assert.equal(await h.feedLiveSession(entry, peerMsg(), ME), true);
  assert.equal(h.calls.feedInbound.length, 2, "a thread is a GROUP of my agents, not one");
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A1, A2]);
  assert.deepEqual(h.calls.feedInbound[0], {
    channelId: "c1", taskId: TASK, agentId: A1, message: "reply body",
    seq: 7, // the turn's seq — the windowless outbound bridge's thread join
    authorName: `name:${PEER}`,
    addressing: null, // nobody was @-mentioned
    // ⚠ THE WAKE VERDICT RIDES WITH EVERY FEED SINCE 2026-08-28, and `false` is the ordinary
    // answer: these two agents are RUNNING, so the fan-out delivered the message without any
    // wake being involved. `session-gate.js › feedInbound` reads this rather than re-deriving it.
    wake: false,
  });
});

// ⚠ THIS REPLACES "a THIRD party in the same channel never injects a turn (FIX L1)". That
// fence read `author === counterpartyFor(...)`; the fan-out ruling replaced it with the
// THREAD, so a third member posting INTO the thread does reach my live agents. The fences that
// remain are the ones that still matter: nothing here mints a session, and the body is fenced
// as DATA downstream.
test("feed: the fence is the THREAD, not the counterparty — a third party's post feeds too", async () => {
  const h = harness({ agents: [agent(A1)] });
  assert.equal(await h.feedLiveSession(entry, peerMsg({ authorUserId: "third-party" }), ME), true);
  assert.equal(h.calls.feedInbound.length, 1);
  assert.equal(h.calls.feedInbound[0].authorName, "name:third-party");
});

// ⚠ AND THIS REPLACES "my OWN message fails closed". The operator posting into the thread is
// how they steer their agents in the open, so their own words are fed like anybody's.
test("feed: MY OWN post feeds my agents — that is the product, not a leak", async () => {
  const h = harness({ agents: [agent(A1), agent(A2)] });
  assert.equal(await h.feedLiveSession(entry, peerMsg({ authorUserId: ME }), ME), true);
  assert.equal(h.calls.feedInbound.length, 2);
});

test("feed: a session is NEVER fed its own post back", async () => {
  // Every agent posts under the operator's own account with authorKind 'agent', so authorship
  // cannot tell three of my agents apart. The per-instance `client_msg_id` can.
  const h = harness({ agents: [agent(A1, ["agent-a1b2c3d4-3"]), agent(A2)] });
  assert.equal(await h.feedLiveSession(entry, peerMsg({ authorUserId: ME, clientMsgId: "agent-a1b2c3d4-3" }), ME), true);
  assert.deepEqual(h.calls.feedInbound.map((c) => c.agentId), [A2], "the author is excluded, the sibling is not");
});

test("feed: an unstamped post is fed to everyone — a duplicate turn, never a lost one", async () => {
  const h = harness({ agents: [agent(A1, ["agent-a1b2c3d4-3"])] });
  for (const clientMsgId of [null, undefined, ""]) {
    const one = harness({ agents: [agent(A1, ["agent-a1b2c3d4-3"])] });
    assert.equal(await one.feedLiveSession(entry, peerMsg({ clientMsgId }), ME), true, String(clientMsgId));
  }
  assert.equal(await h.feedLiveSession(entry, peerMsg({ clientMsgId: "agent-somebody-else-1" }), ME), true);
});

test("feed: @agent-id addressing is parsed HERE, and every sibling still receives the message", async () => {
  const h = harness({ agents: [agent(A1), agent(A2)] });
  assert.equal(await h.feedLiveSession(entry, peerMsg({ body: `@${A2} can you take this one` }), ME), true);
  assert.equal(h.calls.feedInbound.length, 2, "an addressed message is DELIVERED to all of them");
  const byAgent = Object.fromEntries(h.calls.feedInbound.map((c) => [c.agentId, c.addressing]));
  assert.deepEqual(byAgent[A2], { me: true, ids: [A2] }, "the addressee is told it is for them");
  assert.deepEqual(byAgent[A1], { me: false, ids: [A2] }, "and the sibling is told it is not");
});

test("feed: an @-mention that is not one of MY live agents resolves to nobody", async () => {
  const h = harness({ agents: [agent(A1)] });
  // A peer cannot address an agent that is not mine: ids are minted per machine and known to
  // no server, and the parse is INTERSECTED with this thread's live roster.
  await h.feedLiveSession(entry, peerMsg({ body: `@deadbeef please do the thing` }), ME);
  assert.equal(h.calls.feedInbound[0].addressing, null);
  // …and prose that merely contains an at-sign is not an address either.
  const h2 = harness({ agents: [agent(A1)] });
  await h2.feedLiveSession(entry, peerMsg({ body: `mail me at sam@example.com` }), ME);
  assert.equal(h2.calls.feedInbound[0].addressing, null);
});

test("feed: the parser takes the closed agent-id charset and nothing near it", () => {
  const h = harness();
  assert.deepEqual(h.mentionedAgentIds(`@${A1}`, [A1]), [A1]);
  assert.deepEqual(h.mentionedAgentIds(`@${A1}, @${A2}`, [A1, A2]), [A1, A2]);
  assert.deepEqual(h.mentionedAgentIds(`@${A1} @${A1}`, [A1]), [A1], "de-duped");
  assert.deepEqual(h.mentionedAgentIds("@1a2b3c4d", ["1a2b3c4d"]), [], "must start with a letter");
  // ── THE `@agent-<id>` FORM (2026-08-27, Samuel's handle-convention ruling) ──────────────────
  //
  // ⚠ THE WEB TREE WRITES AND TINTS THIS SHAPE NOW (`src/features/channels/lib/agent-mentions.ts`
  // › `agentIdHandle`), so a parser that only knew the bare id would render a blue token that
  // addressed nobody — the tint-says-tagged / stamp-says-nobody split F-266 cost a wave to fix
  // once. BOTH forms resolve: every message written before the ruling carries the bare one.
  assert.deepEqual(h.mentionedAgentIds(`@agent-${A1}`, [A1]), [A1], "the prefixed form addresses");
  assert.deepEqual(h.mentionedAgentIds(`@agent-${A1}`, [A1]).length, 1, "and resolves ONCE");
  // ⚠ THE FENCE IS UNCHANGED — the result is still INTERSECTED with the ids live on this thread,
  // so spelling `agent-` in front of a guess grants nothing.
  assert.deepEqual(h.mentionedAgentIds(`@agent-deadbeef @deadbeef`, [A1]), []);
  // ⚠ AND THE PREFIX DOES NOT TURN PROSE INTO AN ADDRESS.
  assert.deepEqual(h.mentionedAgentIds("@agent-team meets at noon", [A1]), []);
  assert.deepEqual(h.mentionedAgentIds(`@agent-${A1}x`, [A1]), [], "an id-shaped PREFIX is not an id");
  assert.deepEqual(h.mentionedAgentIds(`mail me at me@${A1}`, [A1]), [], "not after a word character");
  assert.deepEqual(h.mentionedAgentIds("@a1b2c3d", ["a1b2c3d"]), [], "exactly eight characters");
  assert.deepEqual(h.mentionedAgentIds(`@${A1}extra`, [A1]), [], "and a word boundary is required");
  assert.deepEqual(h.mentionedAgentIds(`@${A1}`, []), [], "an empty roster addresses nobody");
});

// ⚠ THE TIERED-WAKE TRUTH TABLE LIVES IN `test/wake-tier-routing.test.mjs` (2026-08-28, the §2
// 500-line cap). It drives THIS route, through the SHARED harness above, for the one session
// class this file's fixtures deliberately never build: a DORMANT agent. Everything below stays
// here because it is about the fan-out, which no tier governs.

test("feed: no live session -> false (falls through to classify)", async () => {
  const h = harness({ agents: [] });
  assert.equal(await h.feedLiveSession(entry, peerMsg(), ME), false);
  assert.equal(h.calls.feedInbound.length, 0);
});

test("feed: a non-message kind and a NULL identity still fail closed", async () => {
  const h = harness({ agents: [agent(A1)] });
  // ⚠ THE kind FILTER IS THE LAST WORD ON THIS MACHINE — a non-'message' post reaches no
  // session at all, so the lifecycle markers and `task_progress` milestones on the wire cannot
  // spend a peer turn each. classify states the same rule for the same reason.
  for (const kind of ["task_started", "task_failed", "task_finished", "task_progress"]) {
    assert.equal(await h.feedLiveSession(entry, peerMsg({ kind }), ME), false, kind);
  }
  // The listener owns identity resolution and passes it in. It no longer EXCLUDES my own posts
  // (that is the fan-out), but a machine that cannot say who it is decides nothing.
  for (const me of [null, undefined, ""]) {
    assert.equal(await h.feedLiveSession(entry, peerMsg(), me), false, `myUserId ${JSON.stringify(me)}`);
  }
  assert.equal(await h.feedLiveSession(entry, null, ME), false, "and no message at all");
  assert.equal(h.calls.feedInbound.length, 0);
});

test("feed: the answer is TRUE only when a session really took it", async () => {
  const h = harness({ agents: [agent(A1)], feedInboundReturn: false });
  assert.equal(await h.feedLiveSession(entry, peerMsg(), ME), false, "a full queue is not a claim");
});

// ── authorLabel — the wrapper a fed turn is titled with ──────────────────────
// Sliced with the route on purpose (see the source comment): it is the one helper route (1)
// calls, so a table that drove the route without it would be driving a different function.

test("feed: the wrapper names the AUTHOR, not the account that posted", async () => {
  // A peer's AGENT posts from the peer's account, so `displayNameFor` alone credits a person
  // for a machine's words. `author_kind` is derived server-side from the caller's credential
  // and is never claimed on the wire.
  const agent = harness({ agents: [{ agentId: A1, ownPostIds: new Set() }] });
  await agent.feedLiveSession(entry, peerMsg({ authorKind: "agent" }), ME);
  assert.equal(agent.calls.feedInbound[0].authorName, `name:${PEER}'s agent`);

  const person = harness({ agents: [{ agentId: A1, ownPostIds: new Set() }] });
  await person.feedLiveSession(entry, peerMsg({ authorKind: "user" }), ME);
  assert.equal(person.calls.feedInbound[0].authorName, `name:${PEER}`);

  // …and an account this machine cannot name still says WHAT wrote it rather than nothing.
  const anon = harness({ displayName: () => "" });
  assert.equal(anon.authorLabel({ authorUserId: PEER, authorKind: "agent" }), "an agent");
  assert.equal(anon.authorLabel({ authorUserId: PEER, authorKind: "user" }), "");
  assert.equal(anon.authorLabel(null), "", "and a missing message resolves nothing");
});

// ── the route is UNGATED, and that is a decision ─────────────────────────────

test("route (1) is gated on nothing but a live session's own existence", () => {
  // ⚠ REPOINTED (2026-08-20). This used to be driven — `harness({ windowMode: false })` still
  // fed — which measured the absence of the guard through a setting the module read. The
  // setting is deleted along with the four routes that opened on it, so the absence is
  // asserted where it now lives: in the source. Route (1) claims nothing into existence, so a
  // master switch over it would only ever strand a running session mid-turn.
  assert.ok(!CODE.includes("getWindowMode"), "no window-mode gate survives in session-dispatch");
  assert.ok(!CODE.includes("require('./settings')"), "…and the module does not reach the setting");
  assert.ok(!CODE.includes("settings."), "…nor read one inside the routing block");
});

test("the module exports ONE route, and nothing that was deleted comes back", () => {
  // The dead-tissue pin. Deleting a route while leaving its export is how a caller keeps
  // finding it, and this module's export list IS the listener's menu.
  // ⚠ `mayFeed` JOINED THE LIST ON 2026-08-22 (Samuel's SPAWN-IDLE WAKE RULE): the fan-out's one
  // hold-back, exported so its truth table can be driven directly rather than only through the
  // route. It is a ROUTING predicate like the two beside it, not a new route.
  // ⚠ `dormant` AND `wakeCandidates` JOINED THE LIST ON 2026-08-28 (Samuel's TIERED WAKE ruling),
  // beside `mayFeed`, and for the same reason it joined in 2026-08-22: they are ROUTING
  // predicates whose truth table has to be drivable directly, not new routes.
  // ⚠ `serverAddressed` JOINED THE LIST ON 2026-09-02 (A9, the delivery keystone): the reader
  // of the server's own recipient resolution, exported beside `mentionedAgentIds` because the
  // two are one decision with a fallback and their truth table has to drive both halves.
  assert.match(CODE, /module\.exports = \{ feedLiveSession, mentionedAgentIds, serverAddressed, addressingFor, mayFeed, dormant, wakeCandidates \};/);
  for (const gone of [
    "maybeOpenRequesterSession", "maybeSurfaceRequesterReply", "noteRequestLifecycle",
    "maybeReopenAddressedThread", "diagRuntimeGateSkip", "REQUEST_MILESTONES",
    "exchangeTag", "reopenableRecord",
    // ⚠ 2026-08-21: the counterparty fence is gone from this module. Its return would silently
    // re-narrow the fan-out to one author, which is the ruling reversed.
    "counterpartyFor", "hasLiveSession",
  ]) {
    assert.ok(!CODE.includes(gone), `${gone} is deleted — no trace of it in the code`);
  }
});

// ⚠ TWELVE TESTS STOOD BELOW AND ARE GONE (2026-08-20, F-228). Four of this module's five
// routes were deleted, and all four opened on `if (!settings.getWindowMode()) return false;` —
// the master switch Samuel's live-test ruling turned permanently off. What each block pinned:
//
//   (2) maybeOpenRequesterSession — seven tests: "my own create_task launches a requester
//       window", "the launch context carries the channel + workspace ids" (prompt-framing's
//       delivery section reads ONLY the context), "H2 — the server's is_direct flag rides the
//       launch, strictly", "an already-live task is deduped (one window per (channel,task))",
//       "a window-cap skip returns false AND posts a passive notice", "not my create_task ->
//       false". The route minted a REQUESTER WINDOW on the operator's OWN thread opener and
//       launched their agent against their own message — the self-trigger bug the retirement
//       was ruled from. There is no requester window to open.
//   (3) maybeSurfaceRequesterReply — five tests: "a settled requester reply is routed to the
//       inbound GATE (no auto-resume)", "the gate refusing -> false", "the route no longer
//       reads the resume map itself", "a still-LIVE session is left to the live path", "a
//       reply where I am NOT the requester never reopens", "window-mode OFF and
//       my-own-message short-circuit". It held a peer's reply at a settled requester window's
//       inbound gate; `session-engine.feedInboundForTask` and `session-park.recreateParkedShell`
//       are deleted under it, so there is no gate and no shell to hold it at.
//
// ⚠ WHAT DID NOT GO WITH THEM. Route (3)'s "a reply where I am NOT the requester never
// reopens" was a REQUESTER/RESPONDER pairing check — `taskCreatedBy === me` AND
// `taskTarget === author` — and that pair is not this module's rule at all: it is
// `targeting.classify`'s task-reply branch, which is untouched and is pinned in
// test/classify.test.mjs and test/legacy-thread-reply.test.mjs. Nothing here was the only
// reader of it.
