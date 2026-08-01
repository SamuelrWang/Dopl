// THE BREAKOUT ROOM — two agents in a thread can actually reach each other
// (main/channel-threads.js + the thread lane of main/channel-agents.js).
//
// THE DEFECT THIS FILE EXISTS FOR. THE LAW says "Inside a thread everyone in it hears
// everything: no tagging between participants", and on the desktop that sentence was false.
// A team session's slot is (channel, AGENT), so session-dispatch.feedLiveSession — which looks
// up (channel, thread) and then fences on the bound counterparty — could never match one. And
// routeAddressedAgent had no thread branch at all: an untagged post fell to the engagement
// lane, which refuses agent authors, and then to classify, which returns 'fyi' for an
// unaddressed agent-authored message. So the instant two agents opened a room to work in, they
// went deaf to each other inside it.
//
// WHAT IS PINNED HERE:
//   THE LANE        an agent-authored, UNADDRESSED, thread-tagged post reaches every one of my
//                   agents the thread's participant set names.
//   THE BRAKE       the SAME post without a thread tag reaches nobody. The main room is
//                   unchanged, and that is the half that must not regress.
//   THE FENCE       participation is read over an authenticated call, ownership still comes off
//                   the roster, and an unknown set routes nobody.
//   THE SELF-ECHO   a post is never delivered back into the agent that wrote it.
//   THE GATE        agent-authored traffic is NOT flagged self-authored, so it stays gated.
//   F-072           the read is cached, single-flight, backed off on failure and capped.
//
// METHOD: test/helpers/channel-agents.mjs wires the REAL channel-threads, channel-roster,
// channel-engagement and channel-agents blocks to each other, so what is driven below is the
// shipped policy with a fake standing in for HTTP alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THREADS, BANNED, ME, PEER, CH, MINE, MINE2, THEIRS, THREAD,
  agent, msg, harness, entry,
} from "./helpers/channel-agents.mjs";

test("the sliced block is host-free: no require, no electron, no fs", () => {
  for (const banned of BANNED) {
    assert.ok(!THREADS.block.includes(banned), `CHANNEL-THREADS-PURE must not reference ${banned}`);
  }
});

// ── fixtures ───────────────────────────────────────────────────────────────────

const asAgent = (id) => ({ kind: "agent", agentId: id, userId: null });
const asUser = (id) => ({ kind: "user", userId: id, agentId: null });

/** A post INSIDE the thread, authored by a peer's AGENT — the shape of every handshake turn. */
const inThread = (over = {}) => msg({
  authorKind: "agent",
  body: "picking up the schema half",
  metadata: { taskId: THREAD, author_agent_id: THEIRS, ...(over.metadata || {}) },
  ...over,
});

/** Seed the roster the router reads, then forget the reads that did it. */
async function room(cfg = {}) {
  const h = harness(cfg);
  const e = entry();
  await h.reconcileChannel(e, ME);
  h.calls.summon.length = 0;
  h.calls.wake.length = 0;
  h.calls.feed.length = 0;
  h.calls.fetch.length = 0;
  return { h, e };
}

const threadReads = (h) => h.calls.fetch.filter((f) => f.pathname.includes("/tasks/")).length;

// ── 1. the lane, and the brake it must not weaken ──────────────────────────────

test("a PEER'S AGENT posting in a thread reaches MY agent, with no tagging at all", async () => {
  const { h, e } = await room({
    roster: [agent({ status: "active" })],
    participants: [asUser(ME), asUser(PEER), asAgent(MINE), asAgent(THEIRS)],
    live: [`${CH}:${MINE}`],
  });
  assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "fed", "the route CLAIMS it");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
  assert.equal(h.calls.feed[0].message, "picking up the schema half");
});

test("THE BRAKE HOLDS: the SAME post with NO thread tag reaches nobody", async () => {
  // The half that must not regress. Outside a thread there is no participant set to fence the
  // delivery, so an unaddressed agent-authored post is the loop the main-room brake refuses —
  // whatever the roster says and whatever is engaged.
  const { h, e } = await room({
    roster: [agent({ status: "active", engagedAt: new Date().toISOString(), engagedBy: PEER })],
    participants: [asUser(ME), asAgent(MINE)],
    live: [`${CH}:${MINE}`],
  });
  const untagged = inThread({ metadata: { author_agent_id: THEIRS } }); // no taskId
  assert.equal(await h.routeAddressedAgent(e, untagged, ME), "", "not this lane, and never will be");
  assert.equal(h.calls.feed.length, 0);
  assert.equal(h.calls.wake.length, 0);
  assert.equal(threadReads(h), 0, "…and it does not even ask who is in a thread");
});

test("a LEGACY task id selects no lane: it resolves to no thread and no participant set", async () => {
  // `task-<channel>-<seq>` is caller-settable with no participation check (F-083), so if it
  // could select this lane a peer could route into my agent by inventing one.
  const { h, e } = await room({
    roster: [agent({ status: "active" })],
    participants: [asUser(ME), asAgent(MINE)],
    live: [`${CH}:${MINE}`],
  });
  const legacy = inThread({ metadata: { taskId: `task-${CH}-9`, author_agent_id: THEIRS } });
  assert.equal(await h.routeAddressedAgent(e, legacy, ME), "");
  assert.equal(h.calls.feed.length, 0);
  assert.equal(threadReads(h), 0);
});

test("an unreadable participant set routes NOBODY (it is unknown, not empty)", async () => {
  for (const cfg of [{ participants: undefined }, { threadStatus: 500 }, { participants: [] }]) {
    const { h, e } = await room({
      roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`], ...cfg,
    });
    assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "", JSON.stringify(cfg));
    assert.equal(h.calls.feed.length, 0);
  }
});

// ── 2. the fence: who is actually in the room, and whose agent it is ───────────

test("a peer's agent in the thread is NOT run here, however the participant row reads", async () => {
  // Ownership is the authenticated ROSTER's answer. A participant row names an agent id and
  // nothing else, so a thread full of somebody else's agents starts nothing on this machine.
  const { h, e } = await room({
    roster: [agent({ id: THEIRS, ownerUserId: PEER, name: "slate", status: "active" })],
    participants: [asUser(PEER), asAgent(THEIRS)],
    live: [`${CH}:${THEIRS}`],
  });
  assert.equal(await h.routeAddressedAgent(e, inThread({ metadata: { taskId: THREAD, author_agent_id: "other" } }), ME), "");
  assert.equal(h.calls.feed.length, 0);
});

test("a `kind: user` row does not put that person's agents in the room", async () => {
  // The join table's discriminator is exclusive, and only the agent rows name agents. A thread
  // I am a HUMAN participant of does not silently enlist every agent I own.
  const { h, e } = await room({
    roster: [agent({ status: "active" })],
    participants: [asUser(ME), asUser(PEER)],
    live: [`${CH}:${MINE}`],
  });
  assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "");
  assert.equal(h.calls.feed.length, 0);
});

test("a DISMISSED row is in no room, whatever the participant set still says", async () => {
  const { h, e } = await room({
    roster: [agent({ status: "dismissed" })],
    participants: [asUser(ME), asAgent(MINE)],
  });
  assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "");
  assert.equal(h.calls.feed.length, 0);
  assert.equal(threadReads(h), 0, "no live agent of mine here, so the read is skipped entirely");
});

test("EVERY one of my agents in the room hears it, and the AUTHOR never hears itself", async () => {
  // The self-echo filter is the bound that matters even with ONE agent in the thread: without
  // it a single agent answers its own post, which is an infinite loop needing no second party.
  const { h, e } = await room({
    roster: [
      agent({ status: "active" }),
      agent({ id: MINE2, name: "onyx", status: "active" }),
      agent({ id: THEIRS, ownerUserId: PEER, name: "slate", status: "active" }),
    ],
    participants: [asAgent(MINE), asAgent(MINE2), asAgent(THEIRS)],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  });
  // …authored by MY OWN `onyx`, so onyx must be skipped and quartz must be fed.
  const fromOnyx = msg({
    authorUserId: ME, authorKind: "agent",
    metadata: { taskId: THREAD, author_agent_id: MINE2 },
  });
  assert.equal(await h.routeAddressedAgent(e, fromOnyx, ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE], "quartz only: onyx wrote it");
});

test("TWO OF MY OWN agents reach each other in a thread, and NOT in the main room", async () => {
  // The asymmetry, stated as a test. `myOwnAgentSpoke` is the main-room brake and it is
  // deliberately NOT applied to the thread lane: a breakout room's participant set is a
  // bounded, human-curated fence, and two of my agents collaborating in one is the feature.
  const cfg = {
    roster: [agent({ status: "active" }), agent({ id: MINE2, name: "onyx", status: "active" })],
    participants: [asAgent(MINE), asAgent(MINE2)],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  };
  const fromMine = (metadata) => msg({ authorUserId: ME, authorKind: "agent", metadata });

  const room1 = await room(cfg);
  assert.equal(
    await room1.h.routeAddressedAgent(room1.e, fromMine({ taskId: THREAD, author_agent_id: MINE }), ME),
    "fed", "inside the room they hear each other"
  );
  assert.deepEqual(room1.h.calls.feed.map((f) => f.agentId), [MINE2]);

  const room2 = await room(cfg);
  assert.equal(
    await room2.h.routeAddressedAgent(room2.e, fromMine({ author_agent_id: MINE }), ME),
    "", "outside it, my agent still cannot wake my other agent"
  );
  assert.equal(room2.h.calls.feed.length, 0);
  // …and not even by NAMING it, which is the addressed lane's own copy of the brake.
  const named = fromMine({ author_agent_id: MINE, to_agent_ids: [MINE2] });
  assert.equal(await room2.h.routeAddressedAgent(room2.e, named, ME), "");
  assert.equal(room2.h.calls.feed.length, 0);
});

// ── 3. the gate is what bounds an unattended exchange ──────────────────────────

test("agent-authored thread traffic is NOT self-authored, so the inbound gate still holds it", async () => {
  // `selfAuthored` bypasses the gate, and my own AGENT's posts carry my user id. Identity alone
  // would therefore hand every agent-to-agent hop a free pass through the one control that
  // keeps two of my agents from running at each other unattended.
  const { h, e } = await room({
    roster: [agent({ status: "active" }), agent({ id: MINE2, name: "onyx", status: "active" })],
    participants: [asAgent(MINE), asAgent(MINE2)],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  });
  const fromOnyx = msg({ authorUserId: ME, authorKind: "agent", metadata: { taskId: THREAD, author_agent_id: MINE2 } });
  assert.equal(await h.routeAddressedAgent(e, fromOnyx, ME), "fed");
  assert.equal(h.calls.feed[0].selfAuthored, false, "an agent wrote it, so a human decides");
  // …while the operator's OWN TYPED line in the same thread does bypass, as it always has.
  h.calls.feed.length = 0;
  const typed = msg({ authorUserId: ME, metadata: { taskId: THREAD } });
  assert.equal(await h.routeAddressedAgent(e, typed, ME), "fed");
  assert.equal(h.calls.feed[0].selfAuthored, true);
});

test("a thread post WAKES a participating agent that has nothing running", async () => {
  const { h, e } = await room({
    roster: [agent({ status: "active" })],
    participants: [asAgent(MINE)],
  });
  assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "fed");
  assert.equal(h.calls.wake.length, 1, "the same lazy wake addressing uses");
  assert.equal(h.calls.summon.length, 0, "and it does NOT re-greet the room to do it");
});

test("a refusal in the thread lane falls through and starts nothing", async () => {
  for (const cfg of [{ wakeSkip: "cap" }, { accepts: false }, { fed: false }]) {
    const { h, e } = await room({
      roster: [agent({ status: "active" })],
      participants: [asAgent(MINE)],
      live: cfg.wakeSkip ? [] : [`${CH}:${MINE}`],
      ...cfg,
    });
    assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "", JSON.stringify(cfg));
  }
});

// ── 4. F-072: the read sits on the message path, so it is bounded ──────────────

test("the participant set is READ ONCE and reused: a busy thread is not a read storm", async () => {
  const { h, e } = await room({
    roster: [agent({ status: "active" })],
    participants: [asAgent(MINE)],
    live: [`${CH}:${MINE}`],
  });
  for (let seq = 1; seq <= 6; seq++) {
    assert.equal(await h.routeAddressedAgent(e, inThread({ seq }), ME), "fed");
  }
  assert.equal(threadReads(h), 1, "six messages, one read");
  assert.equal(h.calls.feed.length, 6, "…and all six were delivered");
});

test("concurrent messages JOIN one read rather than starting six", async () => {
  const { h, e } = await room({
    roster: [agent({ status: "active" })],
    participants: [asAgent(MINE)],
    live: [`${CH}:${MINE}`],
  });
  const all = await Promise.all([1, 2, 3, 4, 5, 6].map((seq) => h.routeAddressedAgent(e, inThread({ seq }), ME)));
  assert.deepEqual(all, ["fed", "fed", "fed", "fed", "fed", "fed"]);
  assert.equal(threadReads(h), 1, "single-flight per thread");
});

test("a FAILED read is remembered too, so a broken thread cannot be retried per message", async () => {
  const { h, e } = await room({
    roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`], threadStatus: 500,
  });
  for (let seq = 1; seq <= 5; seq++) {
    assert.equal(await h.routeAddressedAgent(e, inThread({ seq }), ME), "");
  }
  assert.equal(threadReads(h), 1, "one failure, one request");
});

test("the two TTLs differ on purpose, and the cache is capped", () => {
  const h = harness();
  assert.ok(h.FAIL_BACKOFF_MS < h.CACHE_TTL_MS, "a failure is retried sooner than a good set is refreshed");
  assert.equal(h.CACHE_TTL_MS, 5 * 60 * 1000);
  assert.equal(h.CACHE_CAP, 100);
});

// ── 5. the pure predicate, directly ────────────────────────────────────────────

test("myAgentParticipants: agent rows only, mine only, in roster order", () => {
  const h = harness();
  const rows = [
    agent({ status: "active" }),
    agent({ id: MINE2, name: "onyx", status: "active" }),
    agent({ id: THEIRS, ownerUserId: PEER, name: "slate", status: "active" }),
  ];
  const pick = (participants) => h.myAgentParticipants(participants, rows, ME).map((r) => r.id);
  assert.deepEqual(pick([asAgent(MINE2), asAgent(MINE)]), [MINE, MINE2], "roster order, not thread order");
  assert.deepEqual(pick([asAgent(THEIRS)]), [], "somebody else's agent");
  assert.deepEqual(pick([asUser(ME)]), [], "a human row names no agent");
  assert.deepEqual(pick([{ kind: "agent", agentId: "  " }, { kind: "agent" }, null]), []);
  assert.deepEqual(pick([]), []);
  assert.deepEqual(pick(undefined), []);
  assert.deepEqual(h.myAgentParticipants([asAgent(MINE)], rows, null), [], "no identity, no routing");
});
