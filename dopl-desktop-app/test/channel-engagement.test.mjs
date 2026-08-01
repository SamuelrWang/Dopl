// ENGAGEMENT — an agent that acts on UNTAGGED messages, and the brake that bounds it
// (main/channel-engagement.js + the untagged lane of main/channel-agents.js).
//
// WHAT IS PINNED HERE:
//   THE WINDOW    an agent is engaged for ENGAGEMENT_TTL_MS after the server's `engagedAt`,
//                 inclusive of the boundary. Just inside acts; just outside does not.
//   THE FLOOR     only the SERVER can start an engagement. A local act may EXTEND one and may
//                 never create one, so this machine can never act on a widening nobody else
//                 knows about.
//   THE SLIDE     acting refreshes the window locally. No PATCH per message (F-072).
//   THE BRAKE     an AGENT-authored untagged message engages nobody and triggers nobody, even
//                 while one of my agents is fully engaged. This is the property that keeps two
//                 machines from talking to each other forever, and it is absolute.
//   ADDITIVE      an idle agent does NOTHING with the very same message, and a channel with no
//                 engaged agent routes exactly as it did before the feature existed.
//   ADDRESSING    the `to_agent_ids` array wins over the `to_agent_id` scalar mirror.
//
// METHOD: test/helpers/channel-agents.mjs wires the REAL channel-engagement, channel-roster
// and channel-agents blocks to each other, so what is driven below is the shipped policy.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENGAGEMENT, BANNED, TTL_MS, ME, PEER, CH, MINE, MINE2, THEIRS,
  agent, msg, harness, routed, engagedAgo,
} from "./helpers/channel-agents.mjs";

test("the sliced block is host-free: no require, no electron, no fs", () => {
  for (const banned of BANNED) {
    assert.ok(!ENGAGEMENT.block.includes(banned), `CHANNEL-ENGAGEMENT-PURE must not reference ${banned}`);
  }
});

test("the TTL is the server's number, restated with the server's file named as its source", () => {
  assert.equal(TTL_MS, 60 * 60 * 1000, "60 minutes");
  assert.ok(
    ENGAGEMENT.src.includes("src/features/channels/constants.ts"),
    "a restated constant has to say where the original lives, or it drifts silently"
  );
});

// ── 1. the window, as a pure function ──────────────────────────────────────────

test("the TTL boundary is EXCLUSIVE, the same way the web reads it", () => {
  // It used to be inclusive here and exclusive on the web (agent-engagement.ts
  // deriveAgentEngagement: `age < ENGAGEMENT_TTL_MS`) — one millisecond of disagreement about
  // whether a chip reading "Idle" will still take an untagged message. The web is the copy an
  // operator can see, so it wins.
  const h = harness();
  const now = 1_800_000_000_000;
  const row = (at) => ({ id: MINE, ownerUserId: ME, engagedAt: new Date(at).toISOString() });
  assert.equal(h.isEngaged(CH, row(now), now), true, "engaged this instant");
  assert.equal(h.isEngaged(CH, row(now - TTL_MS + 1), now), true, "just inside");
  assert.equal(h.isEngaged(CH, row(now - TTL_MS), now), false, "ON the boundary: idle");
  assert.equal(h.isEngaged(CH, row(now - TTL_MS - 1), now), false, "just outside");
});

test("a FUTURE stamp is clock skew, and it is CLAMPED rather than a longer engagement", () => {
  // Unclamped, a stamp an hour ahead bought the agent skew PLUS a full TTL of engaged time,
  // and the TTL is the only bound the operator's own inactivity controls.
  const h = harness();
  const now = 1_800_000_000_000;
  const row = (at) => ({ id: MINE, ownerUserId: ME, engagedAt: new Date(at).toISOString() });
  assert.equal(h.isEngaged(CH, row(now + 60_000), now), true, "a minute of skew is not staleness");
  assert.equal(h.isEngaged(CH, row(now + TTL_MS), now), true, "one TTL ahead is the far edge of skew");
  assert.equal(h.isEngaged(CH, row(now + TTL_MS + 1), now), false,
    "a clock that wrong is not evidence of an engagement");
  assert.equal(h.isEngaged(CH, row(now + TTL_MS * 50), now), false);
});

test("no `engagedAt` is not engaged, and neither is a junk one", () => {
  const h = harness();
  const now = Date.now();
  for (const at of [undefined, null, "", "not a date", 0, "0000-00-00"]) {
    assert.equal(h.isEngaged(CH, { id: MINE, ownerUserId: ME, engagedAt: at }, now), false, String(at));
  }
  assert.equal(h.isEngaged(CH, null, now), false);
});

const NOW = 1_800_000_000_000;
const staleRow = (id = MINE) => ({ id, ownerUserId: ME, engagedAt: new Date(NOW - TTL_MS * 3).toISOString() });

test("a local act can never CREATE an engagement: the server floor is the only start", () => {
  const h = harness();
  h.noteAgentActed(CH, MINE, NOW);
  const never = { id: MINE, ownerUserId: ME, engagedAt: null };
  assert.equal(h.engagedAtFor(CH, never), 0, "no floor, no engagement, however busy it has been");
  assert.equal(h.isEngaged(CH, never, NOW), false);
});

test("a local act EXTENDS an engagement the server already started", () => {
  const h = harness();
  assert.equal(h.isEngaged(CH, staleRow(), NOW), false, "stale on the server's clock alone");
  h.noteAgentActed(CH, MINE, NOW - 60_000);
  assert.equal(h.isEngaged(CH, staleRow(), NOW), true, "…and live again once it acted a minute ago");
  assert.equal(h.engagedAtFor(CH, staleRow()), NOW - 60_000, "the LATER of the two clocks");
});

test("the local act map is keyed per (channel, agent)", () => {
  const h = harness();
  h.noteAgentActed(CH, MINE, NOW);
  assert.equal(h.isEngaged(CH, staleRow(MINE2), NOW), false, "one agent's act is not another's");
  assert.equal(h.isEngaged("other-channel", staleRow(), NOW), false, "…nor another channel's");
  assert.equal(h.isEngaged(CH, staleRow(), NOW), true, "the pair that DID act is the one that moved");
});

test("the local act map is BOUNDED, oldest first (F-072: nothing here grows without limit)", () => {
  const h = harness();
  h.noteAgentActed(CH, MINE, NOW); // the FIRST key written, so the first evicted
  assert.equal(h.isEngaged(CH, staleRow(), NOW), true);
  for (let i = 0; i < h.ENGAGEMENT_ACT_CAP + 50; i++) h.noteAgentActed(`ch-${i}`, MINE, NOW);
  assert.equal(h.isEngaged(CH, staleRow(), NOW), false, "evicted: its local act no longer rescues a stale floor");
  // …and the newest writes are the ones still held.
  assert.equal(h.isEngaged(`ch-${h.ENGAGEMENT_ACT_CAP + 49}`, staleRow(), NOW), true);
});

// ── 2. what a message addresses ────────────────────────────────────────────────

test("the ARRAY wins, the scalar is the fallback, and neither invents an id", () => {
  const h = harness();
  const ids = (metadata) => h.addressedAgentIds({ metadata });
  assert.deepEqual(ids({ to_agent_ids: [MINE, MINE2], to_agent_id: MINE }), [MINE, MINE2]);
  assert.deepEqual(ids({ to_agent_id: MINE }), [MINE], "no array: the compat mirror is the answer");
  assert.deepEqual(ids({}), []);
  assert.deepEqual(ids(undefined), []);
  assert.deepEqual(ids({ to_agent_ids: [] , to_agent_id: MINE }), [MINE], "an EMPTY array falls back, it does not mean nobody");
  assert.deepEqual(ids({ to_agent_ids: `["${MINE}","${MINE2}"]` }), [MINE, MINE2], "a stringified jsonb array is accepted");
  assert.deepEqual(ids({ to_agent_ids: "[not json" }), [], "…and a broken one addresses nobody rather than throwing");
  assert.deepEqual(ids({ to_agent_ids: [MINE, MINE, " ", 7, null, MINE2] }), [MINE, MINE2], "deduped, trimmed, non-strings dropped");
});

// ── 3. WHO may engage: the loop brake ──────────────────────────────────────────

test("mayEngage: HUMAN authors only, non-CHAT posts only, MY OWN message included", () => {
  const h = harness();
  assert.equal(h.mayEngage(msg(), ME), true);
  assert.equal(h.mayEngage(msg({ authorKind: "agent" }), ME), false, "THE LOOP BRAKE");
  assert.equal(h.mayEngage(msg({ authorKind: "system" }), ME), false);
  assert.equal(h.mayEngage(msg({ authorUserId: ME }), ME), true,
    "my own untagged line is for my own engaged agent — the ASSIST-era exclusion is gone");
  assert.equal(h.mayEngage(msg({ authorUserId: ME, authorKind: "agent" }), ME), false,
    "…but MY OWN AGENT's message still engages nobody: the brake is about authorship, not identity");
  assert.equal(h.mayEngage(msg({ kind: "task_started" }), ME), false);
  assert.equal(h.mayEngage(msg(), null), false, "no identity, no routing");
});

test("humanAuthored mirrors the server's own engagement conjunction", () => {
  // service-writes-agents.recordAgentEngagement refuses on authorKind 'agent' OR a stamped
  // author_agent_id. Two answers to "did a human write this" is one too many.
  const h = harness();
  assert.equal(h.humanAuthored(msg()), true);
  assert.equal(h.humanAuthored(msg({ authorKind: "agent" })), false);
  assert.equal(h.humanAuthored(msg({ metadata: { author_agent_id: THEIRS } })), false,
    "an agent identity on a 'user'-labelled post is still an agent post");
  assert.equal(h.humanAuthored(msg({ authorUserId: "" })), false);
  assert.equal(h.humanAuthored(msg({ kind: "task_started" })), false);
  assert.equal(h.humanAuthored(null), false);
});

test("isChat is the exact string and nothing else (absent intent = today's behaviour)", () => {
  const h = harness();
  assert.equal(h.CHAT_INTENT, "chat");
  assert.equal(h.isChat(msg({ metadata: { intent: "chat" } })), true);
  for (const junk of [undefined, null, "", "request", "CHAT", "chat ", " chat", 0, 1, true, {}, ["chat"]]) {
    assert.equal(h.isChat(msg({ metadata: { intent: junk } })), false, JSON.stringify(junk));
  }
  assert.equal(h.isChat(msg({ metadata: {} })), false, "an ABSENT intent reads as a request");
  assert.equal(h.isChat(msg()), false);
  assert.equal(h.isChat(null), false);
});

// ── 4. the untagged lane, end to end through the real router ───────────────────

const engaged = (over = {}) => agent({ status: "active", engagedAt: engagedAgo(60_000), engagedBy: PEER, ...over });
const untagged = () => msg({ body: "and also check the retry path", metadata: {} });

test("an ENGAGED agent acts on an untagged HUMAN message", async () => {
  const { h, e } = await routed({ roster: [engaged()], live: [`${CH}:${MINE}`] });
  assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "fed", "the route CLAIMS it");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
  assert.equal(h.calls.feed[0].message, "and also check the retry path");
});

test("the SAME message with the agent IDLE does nothing at all", async () => {
  // Byte-for-byte the pre-engagement behaviour: '' falls through to classify, which returns
  // 'fyi' while I have agents in the room. Nothing is woken, nothing is fed.
  const { h, e } = await routed({ roster: [agent({ status: "active" })] });
  assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "");
  assert.equal(h.calls.feed.length, 0);
  assert.equal(h.calls.wake.length, 0);
  // …and the same is true of an agent whose engagement has EXPIRED.
  const stale = await routed({ roster: [engaged({ engagedAt: engagedAgo(TTL_MS + 5_000) })] });
  assert.equal(await stale.h.routeAddressedAgent(stale.e, untagged(), ME), "");
  assert.equal(stale.h.calls.feed.length, 0);
});

test("TTL boundary through the router: just inside acts, just outside does not", async () => {
  const inside = await routed({ roster: [engaged({ engagedAt: engagedAgo(TTL_MS - 5_000) })], live: [`${CH}:${MINE}`] });
  assert.equal(await inside.h.routeAddressedAgent(inside.e, untagged(), ME), "fed");
  const outside = await routed({ roster: [engaged({ engagedAt: engagedAgo(TTL_MS + 5_000) })], live: [`${CH}:${MINE}`] });
  assert.equal(await outside.h.routeAddressedAgent(outside.e, untagged(), ME), "");
  assert.equal(outside.h.calls.feed.length, 0);
});

test("THE BRAKE: an AGENT-authored untagged message triggers NOBODY, engaged or not", async () => {
  // The property that makes engagement safe to ship. Two engaged agents in the room, an
  // agent-authored line with no addressing at all — the shape of every reply either machine
  // posts — and the route must start nothing, whatever the window says.
  const { h, e } = await routed({
    roster: [engaged(), engaged({ id: MINE2, name: "onyx" })],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  });
  const reply = msg({ authorKind: "agent", metadata: { author_agent_id: THEIRS } });
  assert.equal(await h.routeAddressedAgent(e, reply, ME), "", "not this lane, and never will be");
  assert.equal(h.calls.feed.length, 0, "nothing fed");
  assert.equal(h.calls.wake.length, 0, "nothing woken");
  // …while the identical message from a HUMAN reaches both. The ONLY difference is authorKind.
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: {} }), ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE, MINE2]);
});

test("an untagged message reaches EVERY engaged agent of mine, and nobody else's", async () => {
  const { h, e } = await routed({
    roster: [
      engaged(),
      engaged({ id: MINE2, name: "onyx" }),
      engaged({ id: THEIRS, ownerUserId: PEER, name: "slate" }), // engaged, but on THEIR Mac
      agent({ id: "agent-idle", name: "idle", status: "active" }), // mine, but not engaged
    ],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  });
  assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE, MINE2]);
});

test("a DISMISSED row is engaged by nothing, whatever its timestamp says", async () => {
  const { h, e } = await routed({ roster: [engaged({ status: "dismissed" })] });
  assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "", "a retired agent has no window");
  assert.equal(h.calls.feed.length, 0);
});

test("an engaged agent with nothing running is WOKEN by the untagged message", async () => {
  const { h, e } = await routed({ roster: [engaged()] }); // engaged, no live session here
  assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "fed");
  assert.equal(h.calls.wake.length, 1, "the lazy wake is the same one addressing uses");
  assert.equal(h.calls.summon.length, 0, "and it does NOT re-greet the room to do it");
});

test("engagement FAILING falls through: it is additive, so it never makes things worse", async () => {
  // Contrast with the ADDRESSED lane, where a refusal must short-circuit (FIX S2). An
  // untagged message has no owner-bridge trap behind it, so a refusal here simply leaves the
  // operator with the behaviour they already had.
  for (const cfg of [{ wakeSkip: "cap" }, { accepts: false }, { fed: false }]) {
    const { h, e } = await routed({ roster: [engaged()], live: cfg.wakeSkip ? [] : [`${CH}:${MINE}`], ...cfg });
    assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "", JSON.stringify(cfg));
  }
});

test("window-mode OFF short-circuits the engaged lane too", async () => {
  const { e } = await routed({ roster: [engaged()] });
  const off = harness({ roster: [engaged()], windowMode: false });
  assert.equal(await off.routeAddressedAgent(e, untagged(), ME), "");
  assert.equal(off.calls.feed.length, 0);
});

test("MY OWN untagged message reaches MY OWN engaged agent", async () => {
  // The second half of the primary-flow fix: engagement means "listening to this channel", and
  // the person it is most listening to is the operator who summoned it. `engagedBy` is the
  // PEER here on purpose — the owner is always in scope whoever last engaged the row.
  const { h, e } = await routed({ roster: [engaged()], live: [`${CH}:${MINE}`] });
  assert.equal(await h.routeAddressedAgent(e, msg({ authorUserId: ME, metadata: {} }), ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
  assert.equal(h.calls.feed[0].selfAuthored, true);
  // …and with the agent IDLE the very same message does nothing, exactly as before.
  const idle = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  assert.equal(await idle.h.routeAddressedAgent(idle.e, msg({ authorUserId: ME, metadata: {} }), ME), "");
  assert.equal(idle.h.calls.feed.length, 0);
});

test("MY OWN AGENT's untagged message reaches nothing, engaged or not (the loop brake)", async () => {
  const { h, e } = await routed({
    roster: [engaged(), engaged({ id: MINE2, name: "onyx" })],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  });
  const mine = msg({ authorUserId: ME, authorKind: "agent", metadata: { author_agent_id: MINE } });
  assert.equal(await h.routeAddressedAgent(e, mine, ME), "", "my agent must never wake my other agent");
  assert.equal(h.calls.feed.length, 0);
  assert.equal(h.calls.wake.length, 0);
});

test("IN A DM the engaged agent claims the message the consent gate would otherwise have", async () => {
  // The consequence worth stating: a direct channel auto-addresses every post, so an untagged
  // peer line carries `to_user_id = me` and classify answers 'trigger'. An engaged agent takes
  // it first. Same standing consent the ADDRESSED route has always applied, and only while the
  // window is open — with the agent idle the very same message falls through to the gate.
  const dm = { channel: { id: CH, name: "Samuel + David", isDirect: true }, workspaceId: "ws-1" };
  const autoAddressed = msg({ metadata: { to_user_id: ME } });

  const on = harness({ roster: [engaged()], live: [`${CH}:${MINE}`] });
  await on.reconcileChannel(dm, ME);
  assert.equal(await on.routeAddressedAgent(dm, autoAddressed, ME), "fed");

  const off = harness({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const dm2 = { channel: { id: CH, name: "Samuel + David", isDirect: true }, workspaceId: "ws-1" };
  await off.reconcileChannel(dm2, ME);
  assert.equal(await off.routeAddressedAgent(dm2, autoAddressed, ME), "", "idle: the gate still gets it");
  assert.equal(off.calls.feed.length, 0);
});

// ── 5. the sliding window, observed through the router ─────────────────────────

test("ACTING refreshes engagement locally, and no PATCH is written to do it (F-072)", async () => {
  const { h, e } = await routed({
    // Engaged by the server nearly a full TTL ago: one more minute of clock and it is dead.
    roster: [engaged({ engagedAt: engagedAgo(TTL_MS - 30_000) })],
    live: [`${CH}:${MINE}`],
  });
  const patchesBefore = h.calls.patch.length;
  assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "fed");
  assert.equal(h.calls.patch.length, patchesBefore, "acting writes NOTHING to the server");
  // The act moved the window forward: the agent is engaged as of NOW, not as of the stamp.
  const row = { id: MINE, ownerUserId: ME, engagedAt: engagedAgo(TTL_MS - 30_000) };
  assert.ok(h.engagedAtFor(CH, row) > Date.parse(row.engagedAt), "the local act is the later clock");
  assert.equal(h.isEngaged(CH, row, Date.now() + 60_000), true, "…so a minute from now it is still engaged");
});

test("a REFUSED delivery is not activity: only a message that landed refreshes", async () => {
  const { h, e } = await routed({ roster: [engaged()], live: [`${CH}:${MINE}`], fed: false });
  await h.routeAddressedAgent(e, untagged(), ME);
  const row = { id: MINE, ownerUserId: ME, engagedAt: engagedAgo(60_000) };
  assert.equal(h.engagedAtFor(CH, row), Date.parse(row.engagedAt), "the server floor, untouched");
});

test("being ADDRESSED refreshes the window too, so the follow-up needs no @", async () => {
  const { h, e } = await routed({
    roster: [engaged({ engagedAt: engagedAgo(TTL_MS - 30_000) })],
    live: [`${CH}:${MINE}`],
  });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "fed");
  const row = { id: MINE, ownerUserId: ME, engagedAt: engagedAgo(TTL_MS - 30_000) };
  assert.ok(h.engagedAtFor(CH, row) > Date.parse(row.engagedAt));
});

test("a PEER'S AGENT addressing mine is FED but must NOT hold my window open", async () => {
  // The refresh is shared with the ADDRESSED lane, which has no author-kind brake by design:
  // agent-to-agent addressing across machines IS the product. So a peer's agent @-tagging mine
  // slid my window forward with no human at any hop, and repeating it every 59 minutes held the
  // engagement open forever — an engagement no person had renewed and no person could see.
  // The delivery still happens (it was addressed); only the SLIDE is human-gated.
  const at = engagedAgo(TTL_MS - 30_000);
  const { h, e } = await routed({ roster: [engaged({ engagedAt: at })], live: [`${CH}:${MINE}`] });
  const theirAgent = msg({
    authorKind: "agent",
    metadata: { to_agent_id: MINE, author_agent_id: THEIRS },
  });
  assert.equal(await h.routeAddressedAgent(e, theirAgent, ME), "fed", "addressing still delivers");
  const row = { id: MINE, ownerUserId: ME, engagedAt: at };
  assert.equal(h.engagedAtFor(CH, row), Date.parse(at), "the server floor, untouched");
  // …so the window really does expire on the human's clock: half an hour on and it is idle.
  assert.equal(h.isEngaged(CH, row, Date.now() + 31 * 60_000), false);
});

// ── 6. WHO engaged it: the relationship the `engaged_by` column records ────────

const THIRD = "third-uuid";

test("the engaged lane is scoped to `engagedBy`, so one person's ask is not everyone's", async () => {
  // `engaged_at` and `engaged_by` are stamped together (repository-agents.markAgentsEngaged)
  // and the server treats the pair as a RELATIONSHIP — down to letting that person disengage
  // it. Ignoring `engagedBy` meant that in a six-person channel, one human engaging my agent
  // handed it everybody else's untagged asides as well.
  const { h, e } = await routed({ roster: [engaged({ engagedBy: PEER })], live: [`${CH}:${MINE}`] });
  const fromThird = msg({ authorUserId: THIRD, metadata: {} });
  assert.equal(await h.routeAddressedAgent(e, fromThird, ME), "", "a bystander's aside is not for it");
  assert.equal(h.calls.feed.length, 0);
  // …and the person who DID engage it is still heard, untagged.
  assert.equal(await h.routeAddressedAgent(e, untagged(), ME), "fed");
});

test("the OWNER is always in scope, and a missing `engagedBy` fails closed for everyone else", async () => {
  // It is my agent, on my machine, in a room I am in: the operator never has to "engage" their
  // own agent to talk to it. An older server that stamps no `engagedBy` therefore still answers
  // ME, and answers nobody else.
  const { h, e } = await routed({ roster: [engaged({ engagedBy: undefined })], live: [`${CH}:${MINE}`] });
  assert.equal(await h.routeAddressedAgent(e, msg({ authorUserId: ME, metadata: {} }), ME), "fed");
  assert.equal(await h.routeAddressedAgent(e, msg({ authorUserId: PEER, metadata: {} }), ME), "");
});

// ── 7. `intent: 'chat'` — suppression, and the one thing it must not suppress ──

test("a CHAT post engages nobody, whoever wrote it", async () => {
  // Chat is the composer's DEFAULT, so without this one engagement made every later line of a
  // human conversation an inbound turn for the next 60 minutes.
  const { h, e } = await routed({ roster: [engaged()], live: [`${CH}:${MINE}`] });
  const chatting = (author) => msg({ authorUserId: author, metadata: { intent: "chat" } });
  assert.equal(await h.routeAddressedAgent(e, chatting(PEER), ME), "", "the peer talking");
  assert.equal(await h.routeAddressedAgent(e, chatting(ME), ME), "", "and me talking");
  assert.equal(h.calls.feed.length, 0);
});

test("a CHAT post that NAMES an agent still reaches it: chat never suppresses addressing", async () => {
  // The composer's chat + `toAgents` shape is documented server-side as the PRIMARY way an
  // agent is given work, so suppressing it would break the flow this whole lane exists for.
  // The addressed route claims these before the engaged lane is ever consulted.
  const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const tagged = msg({ authorUserId: ME, metadata: { intent: "chat", to_agent_ids: [MINE] } });
  assert.equal(await h.routeAddressedAgent(e, tagged, ME), "fed", "…and it does not need to be engaged");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
});
