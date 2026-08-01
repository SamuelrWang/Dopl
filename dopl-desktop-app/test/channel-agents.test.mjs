// D2 — the summon lane and the @-addressed routing rule (main/channel-agents.js).
//
// WHAT IS PINNED HERE, in the order the feature happens:
//   SUMMON     a `channel_agents` row that is MINE and still `summoned` becomes a TEAM
//              session, and ONLY a session that really opened flips the row to `active`.
//   ROSTER     a read that FAILS keeps the last known roster (a transient 5xx must not read
//              as "this operator has no agents" and silently re-enable the implicit trigger).
//   COUNT      `entry.teamAgents` is what classify gates on, so it is maintained on the loop
//              entry by every path that touches the roster.
//   ROUTE      a message naming one of MY agents is fed into THAT agent's session, keyed
//              (channel, agent); one naming somebody else's agent, or an agent of no channel
//              I know, is refused and falls through to the ordinary dispatch.
//
// METHOD: the session-dispatch idiom. The CHANNEL-AGENTS-PURE block is sliced and evaluated
// with fakes for the five module-top requires, so the routing truth table drives the REAL
// shipped rules with no electron, no HTTP and no engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "channel-agents.js"), "utf8");

const BEGIN = "// ─── BEGIN CHANNEL-AGENTS-PURE";
const END = "// ─── END CHANNEL-AGENTS-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
// A missing / inverted sentinel would slice "" and pass every negative assertion vacuously.
if (from === -1 || to === -1 || to <= from) throw new Error("CHANNEL-AGENTS-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

test("the sliced block is host-free: no require, no electron, no fs", () => {
  for (const banned of ["require(", "electron", "fs.", "child_process"]) {
    assert.ok(!BLOCK.includes(banned), `CHANNEL-AGENTS-PURE must not reference ${banned}`);
  }
});

const ME = "me-uuid";
const PEER = "peer-uuid";
const CH = "chan-1";
const MINE = "agent-mine";
const THEIRS = "agent-theirs";

const agent = (over = {}) => ({ id: MINE, channelId: CH, ownerUserId: ME, name: "quartz", status: "summoned", ...over });

function harness(cfg = {}) {
  const calls = { fetch: [], patch: [], summon: [], feed: [], diag: [], persisted: [] };
  const roster = cfg.roster === undefined ? [agent()] : cfg.roster;
  const durable = { ...(cfg.durable || {}) }; // the electron-store map, seeded per test

  const io = {
    apiFetch: async (pathname, opts) => {
      calls.fetch.push({ pathname, method: (opts && opts.method) || "GET", body: opts && opts.body });
      if (opts && opts.method === "PATCH") {
        calls.patch.push({ pathname, body: opts.body });
        return { ok: cfg.patchOk !== false, status: cfg.patchOk === false ? 500 : 200 };
      }
      if (cfg.rosterStatus && cfg.rosterStatus !== 200) return { ok: false, status: cfg.rosterStatus };
      return { ok: true, status: 200, json: async () => ({ agents: roster }) };
    },
    normalizeList: (data, key) => (Array.isArray(data) ? data : (data && data[key]) || []),
    displayNameFor: (id) => (id === ME ? "Samuel" : "David"),
    // FIX B1: the durable last-known count. A fake object stands in for electron-store, so
    // the persistence rule (only a SUCCESSFUL read writes; a zero deletes) is driven for real.
    getTeamAgentCount: (id) => Number(durable[id]) || 0,
    setTeamAgentCount: (id, n) => {
      calls.persisted.push({ id, n });
      if (Number(n) > 0) durable[id] = Number(n);
      else delete durable[id];
    },
  };
  const targeting = {
    metaStr: (m, k) => {
      const v = m && m.metadata ? m.metadata[k] : undefined;
      return typeof v === "string" && v.trim() ? v.trim() : "";
    },
    resolveToolProfile: () => "full",
  };
  const settings = { getWindowMode: () => cfg.windowMode !== false };
  const live = new Set(cfg.live || []);
  const sessionEngine = {
    summonTeamSession: async (a) => {
      calls.summon.push(a);
      if (cfg.summonSkip) return { skipped: cfg.summonSkip };
      live.add(`${a.channelId}:${a.agentId}`);
      return { sessionId: "sess-1" };
    },
    hasLiveSession: (a) => live.has(`${a.channelId}:${a.agentId || a.taskId || ""}`),
    acceptsInboundFrom: (a, author) => cfg.accepts !== false && !!author,
    feedInbound: (a) => {
      calls.feed.push(a);
      return cfg.fed !== false;
    },
  };
  const diag = (...args) => calls.diag.push(args.join(" "));

  const api = new Function(
    "io", "targeting", "settings", "sessionEngine", "diag",
    `${BLOCK}\n return { isMyLiveAgent, teamAgentCount, summonTargets, agentById, handleFor,` +
      ` fetchRoster, setStatus, reconcileChannel, reconcileAll, wakeChannel, routeAddressedAgent };`
  )(io, targeting, settings, sessionEngine, diag);
  // What channel-listener.js seeds a fresh loop entry with (io.getTeamAgentCount).
  return { ...api, calls, live, durable, getTeamAgentSeed: io.getTeamAgentCount };
}

const entry = () => ({ channel: { id: CH, name: "Ops" }, workspaceId: "ws-1" });
const msg = (over = {}) => ({ kind: "message", authorUserId: PEER, seq: 9, body: "please look", ...over });

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

test("a summoned row of MINE opens a TEAM session and is then flipped to active", async () => {
  const h = harness();
  const e = entry();
  assert.equal(await h.reconcileChannel(e, ME), true);
  assert.equal(h.calls.summon.length, 1);
  assert.deepEqual(
    { channelId: h.calls.summon[0].channelId, agentId: h.calls.summon[0].agentId, agentName: h.calls.summon[0].agentName },
    { channelId: CH, agentId: MINE, agentName: "quartz" }
  );
  assert.equal(h.calls.summon[0].ownerName, "Samuel", "the framing gets the OWNER's display name");
  assert.deepEqual(h.calls.patch[0].body, { op: "set_status", status: "active" });
  assert.match(h.calls.patch[0].pathname, /\/agents\/agent-mine$/);
  assert.equal(e.teamAgents, 1, "classify's gate is maintained on the loop entry");
});

test("a summon that could NOT start leaves the row `summoned` (the next pass retries)", async () => {
  const h = harness({ summonSkip: "cap" });
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.equal(h.calls.summon.length, 1);
  assert.equal(h.calls.patch.length, 0, "nothing claims an agent is active when none started");
  assert.equal(e.teamAgents, 1, "it is still an agent in the room — addressing stays required");
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

async function routed(cfg = {}) {
  const h = harness(cfg);
  const e = entry();
  await h.reconcileChannel(e, ME); // seed the roster the router reads
  h.calls.summon.length = 0;
  h.calls.feed.length = 0;
  return { h, e };
}

test("a message naming MY agent is fed into THAT agent's session, keyed (channel, agent)", async () => {
  const { h, e } = await routed();
  const ok = await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME);
  assert.equal(ok, "fed", "the route CLAIMS the message");
  assert.equal(h.calls.feed.length, 1);
  assert.deepEqual(
    { channelId: h.calls.feed[0].channelId, agentId: h.calls.feed[0].agentId, message: h.calls.feed[0].message },
    { channelId: CH, agentId: MINE, message: "please look" }
  );
  assert.equal(h.calls.feed[0].taskId, undefined, "an agent slot is NOT a thread id");
  assert.equal(h.calls.summon.length, 0, "a live session is reused, never re-spawned");
});

test("addressed with NO live session: it is summoned on demand, then fed", async () => {
  const h = harness({ roster: [agent({ status: "active" })] }); // active, but nothing running here
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.equal(h.calls.summon.length, 0, "a stale `active` row is not auto-started by a pass");
  const ok = await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME);
  assert.equal(ok, "fed");
  assert.equal(h.calls.summon.length, 1, "…but being addressed IS a reason to start it");
  assert.deepEqual(h.calls.patch.map((p) => p.body.status), ["active"]);
  assert.equal(h.calls.feed.length, 1);
});

// ── FIX S2: "not mine" falls through; "mine, refused" starts NOTHING ──────────────
// The four verdicts. Only '' means "not this lane"; everything else is truthy, so the
// listener short-circuits and the message never reaches classify -> 'trigger' -> a consent
// card and a pair ASSIST spawn standing in for the agent that was actually named.

test("S2: a summon that cannot start REFUSES — it does not fall through to a pair spawn", async () => {
  const h = harness({ roster: [agent({ status: "active" })], summonSkip: "cap" });
  const e = entry();
  await h.reconcileChannel(e, ME);
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME), "refused");
  assert.equal(h.calls.feed.length, 0);
  assert.ok(h.calls.diag.some((d) => d.includes("could not start")), "and it says so in the log");
});

test("an agent I do NOT own falls through: a peer cannot start a session on my machine", async () => {
  const { h, e } = await routed({ roster: [agent(), agent({ id: THEIRS, ownerUserId: PEER, name: "onyx" })] });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: THEIRS } }), ME), "");
  assert.equal(h.calls.summon.length, 0);
  assert.equal(h.calls.feed.length, 0);
});

test("S2: an UNKNOWN id on a READ roster falls through; a DISMISSED row of mine refuses", async () => {
  const { h, e } = await routed({ roster: [agent({ status: "dismissed" })] });
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: "nobody" } }), ME), "",
    "the roster was read and this id is not in it — not my lane");
  const dismissed = await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), ME);
  assert.equal(dismissed, "dismissed", "a retired agent starts NOTHING, and is not a fall-through");
  assert.equal(h.calls.summon.length, 0, "…nothing is started for it");
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

test("my OWN message never routes, and neither does anything with no identity", async () => {
  const { h, e } = await routed();
  assert.equal(await h.routeAddressedAgent(e, msg({ authorUserId: ME, metadata: { to_agent_id: MINE } }), ME), "");
  assert.equal(await h.routeAddressedAgent(e, msg({ metadata: { to_agent_id: MINE } }), null), "");
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
