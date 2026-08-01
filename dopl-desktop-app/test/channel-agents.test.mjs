// D2 — the summon lane and the @-addressed routing rule (main/channel-agents.js +
// main/channel-roster.js).
//
// WHAT IS PINNED HERE, in the order the feature happens:
//   SUMMON     a `channel_agents` row that is MINE and still `summoned` GREETS THE ROOM —
//              no window, no session — and ONLY a greeting that really posted flips the row
//              to `active`. A greeting that could not be posted leaves it `summoned`.
//   WAKE       being @-addressed with nothing running here is what opens that agent's
//              session, through the OTHER engine entry point.
//   ROSTER     a read that FAILS keeps the last known roster (a transient 5xx must not read
//              as "this operator has no agents" and silently re-enable the implicit trigger).
//   COUNT      `entry.teamAgents` is what classify gates on, so it is maintained on the loop
//              entry by every path that touches the roster.
//   ROUTE      a message naming one of MY agents is fed into THAT agent's session, keyed
//              (channel, agent) — and naming SEVERAL reaches every one of mine it named. One
//              naming somebody else's agent, or an agent of no channel I know, is refused and
//              falls through to the ordinary dispatch.
//
// The UNTAGGED half of the routing rule (engagement) lives in channel-engagement.test.mjs;
// both suites share test/helpers/channel-agents.mjs, which wires the three real modules to
// each other exactly as the app does.
//
// METHOD: the session-dispatch idiom. The PURE blocks are sliced and evaluated with fakes for
// the host-bound requires, so the routing truth table drives the REAL shipped rules with no
// electron, no HTTP and no engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS, ROSTER, BANNED, ME, PEER, CH, MINE, MINE2, THEIRS,
  agent, entry, msg, harness, routed,
} from "./helpers/channel-agents.mjs";

test("the sliced blocks are host-free: no require, no electron, no fs", () => {
  for (const { block, name } of [{ block: AGENTS.block, name: "CHANNEL-AGENTS-PURE" }, { block: ROSTER.block, name: "CHANNEL-ROSTER-PURE" }]) {
    for (const banned of BANNED) assert.ok(!block.includes(banned), `${name} must not reference ${banned}`);
  }
});

// ── roster policy ────────────────────────────────────────────────────────────────

test("teamAgentCount counts MINE, summoned or active, and nobody else's", () => {
  const h = harness();
  const rows = [
    agent({ id: "a1", status: "summoned" }),
    agent({ id: "a2", status: "active" }),
    agent({ id: "a3", status: "parked" }),
    agent({ id: "a4", status: "dismissed" }),
    agent({ id: "a5", status: "active", ownerUserId: PEER }),
  ];
  assert.equal(h.teamAgentCount(rows, ME), 2);
  assert.equal(h.teamAgentCount(rows, PEER), 1);
  assert.equal(h.teamAgentCount(rows, null), 0, "no identity -> no agents are mine");
  assert.equal(h.teamAgentCount(null, ME), 0);
});

test("summonTargets picks only MY still-summoned rows (an `active` leftover is not restarted)", () => {
  const h = harness();
  const rows = [
    agent({ id: "a1", status: "summoned" }),
    agent({ id: "a2", status: "active" }),
    agent({ id: "a3", status: "summoned", ownerUserId: PEER }),
  ];
  assert.deepEqual(h.summonTargets(rows, ME).map((r) => r.id), ["a1"]);
});

// ── summon -> spawn -> status ────────────────────────────────────────────────────

test("a summoned row of MINE GREETS THE ROOM and is then flipped to active", async () => {
  const h = harness();
  const e = entry();
  assert.equal(await h.reconcileChannel(e, ME), true);
  assert.equal(h.calls.summon.length, 1);
  assert.equal(h.calls.wake.length, 0, "a summon opens NO session and therefore no window");
  assert.deepEqual(
    { channelId: h.calls.summon[0].channelId, agentId: h.calls.summon[0].agentId, agentName: h.calls.summon[0].agentName },
    { channelId: CH, agentId: MINE, agentName: "quartz" }
  );
  assert.equal(h.calls.summon[0].ownerName, "Samuel", "the greeting gets the OWNER's display name");
  assert.equal(h.calls.summon[0].ownerUserId, ME, "…and the operator id the DM addressee rule needs");
  assert.equal(h.calls.summon[0].direct, false, "a group channel greets UNADDRESSED");
  assert.equal(h.calls.summon[0].agentStamp, "", "…and carries the row stamp the idempotency key uses");
  assert.deepEqual(h.calls.patch[0].body, { op: "set_status", status: "active" });
  assert.match(h.calls.patch[0].pathname, /\/agents\/agent-mine$/);
  assert.equal(e.teamAgents, 1, "classify's gate is maintained on the loop entry");
});

test("a greeting that could NOT be posted leaves the row `summoned` (the next pass retries)", async () => {
  const h = harness({ summonSkip: "post-failed" });
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.equal(h.calls.summon.length, 1);
  assert.equal(h.calls.patch.length, 0, "nothing claims an agent is active when the room was never told");
  assert.equal(e.teamAgents, 1, "it is still an agent in the room — addressing stays required");
});

test("the whole arc: a summon GREETS and starts nothing, then an addressed message wakes it", async () => {
  // This is the operator-reported bug as a behavior: /new-agent must put a message in the
  // chat and leave the machine idle, and the agent must still be there when it is addressed.
  const h = harness();
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.deepEqual(h.calls.summon.map((a) => a.agentId), [MINE], "one greeting");
  assert.equal(h.calls.wake.length, 0, "and NOTHING running: no session, no window");
  assert.deepEqual(h.calls.patch.map((p) => p.body.status), ["active"], "greeted == alive and listening");

  const verdict = await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME);
  assert.equal(verdict, "fed", "the lazy wake is unchanged: being addressed is what runs it");
  assert.equal(h.calls.wake.length, 1);
  assert.equal(h.calls.summon.length, 1, "and the room is not greeted a second time");
});

test("a DIRECT channel's greeting carries the operator id (the server addresses DMs for us)", async () => {
  const h = harness();
  const e = { channel: { id: CH, name: "Samuel + David", isDirect: true }, workspaceId: "ws-1" };
  await h.reconcileChannel(e, ME);
  assert.equal(h.calls.summon[0].direct, true);
  assert.equal(h.calls.summon[0].ownerUserId, ME,
    "session-greeting names the summoner so the auto-addressed post reads as self-addressed noise");
});

test("the row STAMP rides the spec, so a re-summoned row greets again instead of deduping", async () => {
  const h = harness({ roster: [agent({ updatedAt: "2026-07-31T10:00:00.000Z" })] });
  await h.reconcileChannel(entry(), ME);
  assert.equal(h.calls.summon[0].agentStamp, "2026-07-31T10:00:00.000Z");
});

test("a PEER's summoned row is never started here (their agent runs on their machine)", async () => {
  const h = harness({ roster: [agent({ id: THEIRS, ownerUserId: PEER, name: "onyx" })] });
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.equal(h.calls.summon.length, 0);
  assert.equal(e.teamAgents, 0);
});

test("a FAILED roster read changes nothing: no summon, no count, the last roster stands", async () => {
  const h = harness({ rosterStatus: 500 });
  const e = entry();
  assert.equal(await h.reconcileChannel(e, ME), false);
  assert.equal(h.calls.summon.length, 0);
  assert.equal(e.teamAgents, undefined, "an unreadable roster never claims zero agents");
  assert.equal(e.rosterKnown, undefined, "…and never claims to KNOW the roster either");
  assert.deepEqual(h.calls.persisted, [], "a failed read must not overwrite the durable count");
});

// ── FIX B1: the count is a TRI-STATE, and the unknown state keeps the law armed ───

test("B1: a SEEDED count survives a roster read that fails (the law stays armed)", async () => {
  // The failure this closes: the loop entry is created and starts LIVE before any roster is
  // read, so a restart against a slow/failing/pre-deploy roster route left teamAgents at 0
  // and an unaddressed DM message classified 'trigger' — the pre-multiplayer rule.
  const h = harness({ rosterStatus: 500, durable: { [CH]: 2 } });
  // The entry exactly as channel-listener creates it: seeded from the durable count, and not
  // yet confirmed by any read on this run.
  const e = { channel: { id: CH, name: "Ops" }, workspaceId: "ws-1", teamAgents: h.getTeamAgentSeed(CH), rosterKnown: false };
  assert.equal(e.teamAgents, 2, "the seed comes off the durable store, not off a read");
  assert.equal(await h.reconcileChannel(e, ME), false);
  assert.equal(e.teamAgents, 2, "the last known count stands while the roster is unknown");
  assert.equal(e.rosterKnown, false, "and it is still not a KNOWN roster");
});

test("B1: a SUCCESSFUL read is the only thing that confirms, or lowers, the count", async () => {
  const h = harness({ durable: { [CH]: 5 } });
  const e = { channel: { id: CH, name: "Ops" }, workspaceId: "ws-1", teamAgents: 5, rosterKnown: false };
  assert.equal(await h.reconcileChannel(e, ME), true);
  assert.equal(e.teamAgents, 1, "a real read replaces the seed, up OR down");
  assert.equal(e.rosterKnown, true);
  assert.equal(h.durable[CH], 1, "…and the durable value follows it, for the next boot");
});

test("B1: a roster with NO agents of mine clears the durable record rather than storing a 0", async () => {
  const h = harness({ roster: [], durable: { [CH]: 3 } });
  const e = entry();
  assert.equal(await h.reconcileChannel(e, ME), true);
  assert.equal(e.teamAgents, 0);
  assert.equal(e.rosterKnown, true);
  assert.equal(CH in h.durable, false, "zero is the default; it needs no row");
});

test("B1: with NO identity nothing is read, counted or persisted", async () => {
  const h = harness({ durable: { [CH]: 4 } });
  const e = { channel: { id: CH, name: "Ops" }, workspaceId: "ws-1", teamAgents: 4, rosterKnown: false };
  assert.equal(await h.reconcileChannel(e, null), false);
  assert.equal(e.teamAgents, 4, "an unresolved operator cannot lower the count either");
  assert.deepEqual(h.calls.persisted, []);
});

test("with NO resolved identity the pass fails closed (we cannot tell whose agents these are)", async () => {
  const h = harness();
  const e = entry();
  assert.equal(await h.reconcileChannel(e, null), false);
  assert.equal(h.calls.fetch.length, 0, "it does not even spend the read");
});

test("reconcileChannel is SINGLE-FLIGHT: a doorbell during a read joins it, never doubles it", async () => {
  const h = harness();
  const e = entry();
  const a = h.reconcileChannel(e, ME);
  const b = h.reconcileChannel(e, ME);
  assert.equal(a, b, "the second caller gets the SAME in-flight promise");
  await a;
  assert.equal(h.calls.summon.length, 1, "one row, one summon");
  // …and once it settles, a later pass is free to run again.
  await h.reconcileChannel(e, ME);
  assert.ok(h.calls.fetch.filter((f) => f.method === "GET").length >= 2);
});

// ── the @-addressed routing rule ─────────────────────────────────────────────────

test("a message naming MY agent is fed into THAT agent's session, keyed (channel, agent)", async () => {
  const { h, e } = await routed();
  h.live.add(`${CH}:${MINE}`); // a session is already open here (an earlier addressed message)
  const ok = await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME);
  assert.equal(ok, "fed", "the route CLAIMS the message");
  assert.equal(h.calls.feed.length, 1);
  assert.deepEqual(
    { channelId: h.calls.feed[0].channelId, agentId: h.calls.feed[0].agentId, message: h.calls.feed[0].message },
    { channelId: CH, agentId: MINE, message: "please look" }
  );
  assert.equal(h.calls.feed[0].taskId, undefined, "an agent slot is NOT a thread id");
  assert.equal(h.calls.wake.length, 0, "a live session is reused, never re-spawned");
});

// ── MULTI-ADDRESS: "@quartz @onyx work together" reaches BOTH of mine ────────────
// `metadata.to_agent_ids` is the list; `to_agent_id` is the compat mirror of its FIRST
// element. Routing off the mirror alone silently dropped every agent but one.

test("a multi-address feeds EVERY one of my agents it names, not just the first", async () => {
  const { h, e } = await routed({
    roster: [agent({ status: "active" }), agent({ id: MINE2, name: "onyx", status: "active" })],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  });
  const m = msg({ metadata: { to_agent_ids: [MINE, MINE2], to_agent_id: MINE } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE, MINE2], "both, in the order named");
});

test("a multi-address delivers to MINE and silently skips the ones that are not", async () => {
  const { h, e } = await routed({
    roster: [
      agent({ status: "active" }),
      agent({ id: THEIRS, ownerUserId: PEER, name: "onyx", status: "active" }),
    ],
    live: [`${CH}:${MINE}`],
  });
  const m = msg({ metadata: { to_agent_ids: [THEIRS, MINE], to_agent_id: THEIRS } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed", "the mirror named a PEER's agent, and mine still ran");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
  assert.equal(h.calls.wake.length, 0, "and nothing was started for the agent that is not mine");
});

test("the scalar mirror is the whole answer when there is no array (an older server)", async () => {
  const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
});

test("one delivered agent claims the message even when another of mine could not run", async () => {
  // The verdict fold: 'fed' outranks 'refused' outranks 'dismissed'. The message reached an
  // agent of mine, so the listener must not carry on to classify with it.
  const { h, e } = await routed({
    roster: [agent({ status: "active" }), agent({ id: MINE2, name: "onyx", status: "dismissed" })],
    live: [`${CH}:${MINE}`],
  });
  const m = msg({ metadata: { to_agent_ids: [MINE2, MINE], to_agent_id: MINE2 } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
  // …and with NOTHING deliverable, the strongest refusal is what the caller hears.
  const dead = await routed({
    roster: [agent({ status: "dismissed" }), agent({ id: MINE2, name: "onyx", status: "active" })],
    wakeSkip: "cap",
  });
  const both = msg({ metadata: { to_agent_ids: [MINE, MINE2], to_agent_id: MINE } });
  assert.equal(await dead.h.routeAddressedAgent(dead.e, both, ME), "refused");
  assert.equal(dead.h.calls.feed.length, 0);
});

test("addressed with NO live session: it is WOKEN on demand, then fed", async () => {
  const h = harness({ roster: [agent({ status: "active" })] }); // active, but nothing running here
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.equal(h.calls.wake.length, 0, "a stale `active` row is not auto-started by a pass");
  const ok = await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME);
  assert.equal(ok, "fed");
  assert.equal(h.calls.wake.length, 1, "…but being addressed IS a reason to open its session");
  assert.equal(h.calls.summon.length, 0, "and it does NOT re-greet the room to do it");
  assert.deepEqual(h.calls.patch.map((p) => p.body.status), ["active"]);
  assert.equal(h.calls.feed.length, 1);
});

// ── FIX S2: "not mine" falls through; "mine, refused" starts NOTHING ──────────────
// The four verdicts. Only '' means "not this lane"; everything else is truthy, so the
// listener short-circuits and the message never reaches classify -> 'trigger' -> a consent
// card and a pair ASSIST spawn standing in for the agent that was actually named.

test("S2: a wake that cannot start REFUSES — it does not fall through to a pair spawn", async () => {
  const h = harness({ roster: [agent({ status: "active" })], wakeSkip: "cap" });
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "refused");
  assert.equal(h.calls.feed.length, 0);
  assert.ok(h.calls.diag.some((d) => d.includes("could not start")), "and it says so in the log");
});

test("an agent I do NOT own falls through: a peer cannot start a session on my machine", async () => {
  const { h, e } = await routed({ roster: [agent(), agent({ id: THEIRS, ownerUserId: PEER, name: "onyx" })] });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: THEIRS } }), ME), "");
  assert.equal(h.calls.wake.length, 0);
  assert.equal(h.calls.feed.length, 0);
});

test("S2: an UNKNOWN id on a READ roster falls through; a DISMISSED row of mine refuses", async () => {
  const { h, e } = await routed({ roster: [agent({ status: "dismissed" })] });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: "nobody" } }), ME), "",
    "the roster was read and this id is not in it — not my lane");
  const dismissed = await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME);
  assert.equal(dismissed, "dismissed", "a retired agent starts NOTHING, and is not a fall-through");
  assert.equal(h.calls.wake.length, 0, "…nothing is started for it");
  assert.equal(h.calls.feed.length, 0);
  assert.equal(await h.routeAddressedAgent(e, msg(), ME), "", "no to_agent_id at all");
});

test("S2: an id this machine cannot resolve refuses when the OWNER BRIDGE names ME", async () => {
  // The server stamps to_user_id = the addressed agent's OWNER and validates the id against
  // this channel before stamping anything, so `to_agent_id` + `to_user_id === me` names an
  // agent of MINE by construction. Not finding the row means the roster here is missing or
  // stale, not that the agent is somebody else's — and falling through would spawn a pair
  // session against a message meant for that agent.
  const mine = msg({ metadata: { to_agent_id: "agent-brand-new", to_user_id: ME } });
  const theirs = msg({ metadata: { to_agent_id: THEIRS, to_user_id: PEER } });

  // (a) the roster was never read at all (the failing-read / pre-first-pass case)
  const unread = harness({ rosterStatus: 500 });
  const e1 = entry();
  await unread.reconcileChannel(e1, ME); // fails: nothing is cached
  assert.equal(await unread.routeAddressedAgent(e1, mine, ME), "refused");
  assert.equal(await unread.routeAddressedAgent(e1, theirs, ME), "", "somebody else's agent still falls through");

  // (b) the roster WAS read, but this row was created since (the stale case)
  const { h, e } = await routed();
  assert.equal(await h.routeAddressedAgent(e, mine, ME), "refused");
  assert.equal(await h.routeAddressedAgent(e, theirs, ME), "");
  assert.equal(h.calls.feed.length, 0, "and neither of them starts anything");
});

test("MY OWN message addressed to MY OWN agent ROUTES — the product's primary flow", async () => {
  // The regression this file exists to catch from now on. `/new-agent` summons an agent for
  // ITS OWN OPERATOR, and "@quartz do X" typed into the composer is a message THEY authored,
  // naming an agent THEY own, whose session runs on THIS machine. The route used to refuse
  // `authorUserId === myUserId` outright, so after summoning, the agent was deaf to the one
  // person entitled to drive it and only a PEER could ever reach it.
  const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const mine = msg({ authorUserId: ME, metadata: { to_agent_ids: [MINE], to_agent_id: MINE, to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, mine, ME), "fed");
  assert.deepEqual(h.calls.feed.map((f) => f.agentId), [MINE]);
  assert.equal(h.calls.feed[0].selfAuthored, true,
    "…and it is flagged, so the inbound gate does not ask the operator to approve their own sentence");
});

test("nothing routes with no identity resolved", async () => {
  const { h, e } = await routed();
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), null), "");
  assert.equal(h.calls.feed.length, 0);
});

test("a PEER's message is NOT flagged self-authored (the gate still holds their words)", async () => {
  const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "fed");
  assert.equal(h.calls.feed[0].selfAuthored, false);
});

test("window-mode OFF short-circuits the whole lane (a legacy build behaves like one)", async () => {
  const { h, e } = await routed();
  const off = harness({ windowMode: false });
  assert.equal(await off.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "",
    "a legacy build falls through to classify, exactly as it always did");
  assert.equal(off.calls.feed.length, 0);
  // sanity: the same message DOES route with window-mode on
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "fed");
});

test("S2: the BINDING is consulted before the feed, and its refusal starts nothing else", async () => {
  const { h, e } = await routed({ accepts: false });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "refused");
  assert.equal(h.calls.feed.length, 0, "nothing is fed past a binding that said no");
});

test("S2: a full queue (feedInbound false) is a refusal, not an invitation to spawn", async () => {
  const { h, e } = await routed({ fed: false });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "refused");
});

// ── handle resolution (what the escalation notification names) ───────────────────

test("handleFor names an agent off the roster, and answers '' for anything it cannot", async () => {
  const { h } = await routed({ roster: [agent(), agent({ id: THEIRS, ownerUserId: PEER, name: "onyx" })] });
  assert.equal(h.handleFor(CH, MINE), "quartz");
  assert.equal(h.handleFor(CH, THEIRS), "onyx", "a PEER's handle resolves too — attribution is room-wide");
  assert.equal(h.handleFor(CH, "unknown"), "");
  assert.equal(h.handleFor("other-channel", MINE), "");
  assert.equal(h.handleFor(CH, ""), "");
});
