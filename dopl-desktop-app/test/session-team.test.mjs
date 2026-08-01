// D2 — the TEAM session: what a summon actually constructs, and what the ROOM binding means.
//
// TWO claims are load-bearing and both are pinned here:
//   1. A SUMMON OPENS A PARKED SHELL, keyed (channel, AGENT), bound 'room', with NO thread.
//      Parked because the law is "nothing acts unless addressed": the window is real, no SDK
//      query runs, no turn is spent, and the first addressed message wakes it. Keyed on the
//      agent because an agent runs ONE session per channel whatever thread it works, and a
//      team session in the main room has no thread to key on at all.
//   2. THE BINDING IS THE FEED PREDICATE. 'pair' is FIX L1 byte for byte (only the bound
//      counterparty feeds); 'room' accepts any member but the operator. Nothing infers it —
//      it is an explicit persisted field, and it defaults to the NARROWER value everywhere.
//
// METHOD: the session-park / session-gate idiom. The SESSION-TEAM-PURE block is sliced and
// driven with fakes for its module bindings (store, sessionHistory, diag) and for the engine
// handles it is injected with.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-team.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-TEAM-PURE");
const to = SRC.indexOf("// ─── END SESSION-TEAM-PURE");
if (from === -1 || to === -1 || to <= from) throw new Error("SESSION-TEAM-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

test("the sliced block is host-free: no require, no electron, no fs", () => {
  for (const banned of ["require(", "electron", "fs.", "child_process"]) {
    assert.ok(!BLOCK.includes(banned), `SESSION-TEAM-PURE must not reference ${banned}`);
  }
});

const CH = "chan-1";
const AGENT = "agent-1";
const ME = "me-uuid";
const PEER = "peer-uuid";
const THIRD = "third-uuid";

function harness(cfg = {}) {
  const calls = { started: [], history: [], emit: [], diag: [] };
  const sessions = new Map();
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
  };
  const sessionHistory = {
    load: async (s) => {
      calls.history.push({ bind: s.bind, taskId: s.taskId, counterpartyId: s.counterpartyId });
      if (cfg.historyThrows) throw new Error("boom");
      return true;
    },
  };
  const diag = (...a) => calls.diag.push(a.join(" "));

  const api = new Function(
    "store", "sessionHistory", "diag",
    `${BLOCK}\n return { bind, summon, hasSession, acceptsInboundFrom, summonNotice };`
  )(store, sessionHistory, diag);

  api.bind({
    sessions,
    startSession: async (spec) => {
      calls.started.push(spec);
      if (cfg.startFails) return null;
      const s = { ...spec, sessionId: "sess-1", settled: false, state: { parked: true } };
      sessions.set(spec.key, s);
      return s;
    },
    getSdk: async () => {
      if (cfg.sdkThrows) throw new Error("no sdk");
      return {};
    },
    emit: (s, p) => calls.emit.push(p),
    windowModeEnabled: () => cfg.windowMode !== false,
    atWindowCap: () => cfg.atCap === true,
    windowFactoryReady: () => cfg.factory !== false,
    // FIX S6: the engine resolves this from the listener, so it can legitimately be null on a
    // cold start (or after a sign-out). `cfg.selfId` drives that state.
    getSelfId: () => (Object.prototype.hasOwnProperty.call(cfg, "selfId") ? cfg.selfId : ME),
  });
  return { ...api, sessions, calls, store };
}

const spec = () => ({
  channelId: CH, workspaceId: "ws-1", agentId: AGENT, agentName: "quartz",
  ownerName: "Samuel", channelName: "Ops", toolProfile: "full",
});

// ── 1. what a summon constructs ──────────────────────────────────────────────────

test("a summon opens a PARKED, ROOM-bound shell keyed (channel, agent) with NO thread", async () => {
  const h = harness();
  const res = await h.summon(spec());
  assert.equal(res.sessionId, "sess-1");
  const s = h.calls.started[0];
  assert.equal(s.parkedShell, true, "no SDK query runs: nothing acts unless addressed");
  assert.equal(s.bind, "room");
  assert.equal(s.agentId, AGENT);
  assert.equal(s.taskId, "", "a team agent lives in the ROOM; it has no thread of its own");
  assert.equal(s.key, `${CH}:${AGENT}`, "the slot is the AGENT, not the thread");
  assert.notEqual(s.key, `${CH}:`, "…which is what stops every agent collapsing onto one slot");
  assert.equal(s.side, "responder");
  assert.equal(s.profile, "full");
});

test("the agent's OWN identity rides the spawn context (the way channel + workspace do)", async () => {
  const h = harness();
  await h.summon(spec());
  const ctx = h.calls.started[0].context;
  assert.equal(ctx.agentId, AGENT, "this is what becomes as_agent in the delivery call");
  assert.equal(ctx.agentName, "quartz");
  assert.equal(ctx.ownerName, "Samuel");
  assert.equal(ctx.channelId, CH);
  assert.equal(ctx.workspaceId, "ws-1");
});

test("the shell says why it is open and why it is quiet, then loads the ROOM history", async () => {
  const h = harness();
  await h.summon(spec());
  const notice = h.calls.emit.find((p) => p.type === "notice");
  assert.ok(notice, "the operator gets a line");
  assert.match(notice.text, /@quartz/);
  assert.match(notice.text, /addresses it/i, "it states the law, not an activity");
  assert.deepEqual(h.calls.history, [{ bind: "room", taskId: "", counterpartyId: undefined }]);
});

test("a history read that throws does not take the summon down with it", async () => {
  const h = harness({ historyThrows: true });
  const res = await h.summon(spec());
  assert.equal(res.sessionId, "sess-1");
});

test("every refusal is named, and NONE of them constructs a session", async () => {
  for (const [cfg, reason] of [
    [{ windowMode: false }, "disabled"],
    [{ factory: false }, "disabled"],
    [{ atCap: true }, "cap"],
    [{ sdkThrows: true }, "no-sdk"],
  ]) {
    const h = harness(cfg);
    const res = await h.summon(spec());
    assert.equal(res.skipped, reason, JSON.stringify(cfg));
    assert.equal(h.calls.started.length, 0);
  }
});

test("a slot that already holds a session is BUSY: one agent is never started twice", async () => {
  const h = harness();
  await h.summon(spec());
  const again = await h.summon(spec());
  assert.equal(again.skipped, "busy");
  assert.equal(h.calls.started.length, 1);
  // A SETTLED session in the slot is not a session: the agent can be summoned again.
  h.sessions.get(`${CH}:${AGENT}`).settled = true;
  assert.equal((await h.summon(spec())).sessionId, "sess-1");
});

// ── 2. the binding predicate ─────────────────────────────────────────────────────

function withSession(h, over = {}) {
  h.sessions.set(`${CH}:${AGENT}`, { settled: false, bind: "room", counterpartyId: null, ...over });
  return { channelId: CH, agentId: AGENT };
}

test("ROOM: any member but the operator may feed a turn", () => {
  const h = harness();
  const slot = withSession(h);
  assert.equal(h.acceptsInboundFrom(slot, PEER), true);
  assert.equal(h.acceptsInboundFrom(slot, THIRD), true, "a THIRD member too — that is the room");
  assert.equal(h.acceptsInboundFrom(slot, ME), false, "my own output is not an inbound turn");
  assert.equal(h.acceptsInboundFrom(slot, ""), false);
});

test("PAIR is FIX L1, unchanged: only the bound counterparty, and none without one", () => {
  const h = harness();
  const slot = withSession(h, { bind: "pair", counterpartyId: PEER });
  assert.equal(h.acceptsInboundFrom(slot, PEER), true);
  assert.equal(h.acceptsInboundFrom(slot, THIRD), false, "a third member can never inject a turn");
  const unbound = harness();
  const slot2 = withSession(unbound, { bind: "pair", counterpartyId: null });
  assert.equal(unbound.acceptsInboundFrom(slot2, PEER), false, "no counterparty bound -> nobody feeds");
});

test("the binding must say 'room' EXACTLY; anything else takes the narrow fence", () => {
  const h = harness();
  for (const junk of [undefined, null, "", "pair", "ROOM", "rooms", 1, true]) {
    const slot = withSession(h, { bind: junk, counterpartyId: PEER });
    assert.equal(h.acceptsInboundFrom(slot, THIRD), false, JSON.stringify(junk));
    assert.equal(h.acceptsInboundFrom(slot, PEER), true, "…and the pair still feeds");
  }
});

test("no session, or a settled one, accepts nobody", () => {
  const h = harness();
  assert.equal(h.acceptsInboundFrom({ channelId: CH, agentId: AGENT }, PEER), false);
  const slot = withSession(h, { settled: true });
  assert.equal(h.acceptsInboundFrom(slot, PEER), false);
});

test("FIX S6: ROOM fails CLOSED while the operator identity is unresolved", () => {
  // The engine resolves selfUserId from the listener, and a summon can beat that on a cold
  // start. The room branch used to answer `author !== String(getSelfId() || '')`, which with
  // no self id is `author !== ''` — TRUE for everybody, including this machine's own output,
  // the one author the room binding exists to exclude. The fence answered yes to every id it
  // was asked about. With no identity there is no room membership to reason about.
  for (const missing of [null, undefined, "", 0, false]) {
    const h = harness({ selfId: missing });
    const slot = withSession(h);
    assert.equal(h.acceptsInboundFrom(slot, PEER), false, JSON.stringify(missing));
    assert.equal(h.acceptsInboundFrom(slot, ME), false, "and MY OWN words least of all");
  }
  // A missing getSelfId handle entirely (a mid-wave engine that never bound it) is the same.
  const bare = harness();
  bare.bind({ sessions: bare.sessions });
  bare.sessions.set(`${CH}:${AGENT}`, { settled: false, bind: "room" });
  assert.equal(bare.acceptsInboundFrom({ channelId: CH, agentId: AGENT }, PEER), false);
  // …and it recovers the moment the identity lands: nothing is permanently refused.
  const h = harness({ selfId: ME });
  assert.equal(h.acceptsInboundFrom(withSession(h), PEER), true);
});

test("FIX S6: the PAIR binding is untouched — it never consulted the self id", () => {
  const h = harness({ selfId: null });
  const slot = withSession(h, { bind: "pair", counterpartyId: PEER });
  assert.equal(h.acceptsInboundFrom(slot, PEER), true, "an unresolved operator does not break FIX L1");
  assert.equal(h.acceptsInboundFrom(slot, THIRD), false);
});

// ── 3. the field really is persisted, and really does default narrow ─────────────

test("bind + agentId survive into the durable record, defaulting to the NARROW binding", () => {
  const STORE = readFileSync(join(HERE, "..", "main", "session-store.js"), "utf8");
  const durable = new Function(
    `${fnOf(STORE, "durableName")}\n${fnOf(STORE, "durableSessionRecord")}\n return durableSessionRecord;`
  )();
  assert.equal(durable({ bind: "room", agentId: AGENT }).bind, "room");
  assert.equal(durable({ bind: "room", agentId: AGENT }).agentId, AGENT);
  for (const junk of [undefined, null, "", "pair", "ROOM", 1, {}]) {
    assert.equal(durable({ bind: junk }).bind, "pair", JSON.stringify(junk));
  }
  assert.equal(durable({}).agentId, null);
});

test("the engine's own projection carries them, all the way onto the durable record", () => {
  // This used to be two regexes over session-io.js, which is a probe a semantic break walks
  // straight past: hardcoding `bind: 'pair'` (or dropping agentId) would still have matched a
  // shape assertion if it were spelled the same way. So RUN the real projection instead — a
  // live session in, a durable record out, through both functions that ship.
  const IO = readFileSync(join(HERE, "..", "main", "session-io.js"), "utf8");
  const STORE = readFileSync(join(HERE, "..", "main", "session-store.js"), "utf8");
  const baseRecord = new Function(`${fnOf(IO, "baseRecord")}\n return baseRecord;`)();
  const durable = new Function(
    `${fnOf(STORE, "durableName")}\n${fnOf(STORE, "durableSessionRecord")}\n return durableSessionRecord;`
  )();
  const live = (over = {}) => ({
    key: `${CH}:${AGENT}`, sessionId: "sess-1", channelId: CH, taskId: "", workspaceId: "ws-1",
    side: "responder", profile: "full", mode: "autonomous", startedAt: 1,
    state: { phase: "parked", turns: 0, costUsd: 0 }, context: {}, ...over,
  });

  const team = durable(baseRecord(live({ bind: "room", agentId: AGENT })));
  assert.equal(team.bind, "room", "a summoned agent's record must survive as room-bound");
  assert.equal(team.agentId, AGENT, "…and as the agent it runs AS, or a recreate re-keys onto the thread slot");
  assert.equal(team.taskId, "", "a team session has no thread of its own");

  // A pair session projects the narrow binding and no agent, from the same code path.
  const pair = durable(baseRecord(live({ counterpartyId: PEER })));
  assert.deepEqual({ bind: pair.bind, agentId: pair.agentId }, { bind: "pair", agentId: null });
  // …and the widening still needs the exact word, at the projection AND at the whitelist.
  for (const junk of [undefined, null, "", "ROOM", "rooms", 1, true]) {
    assert.equal(durable(baseRecord(live({ bind: junk, agentId: AGENT }))).bind, "pair", JSON.stringify(junk));
  }
});

test("slotKey prefers the AGENT and is otherwise byte-for-byte sessionKey", () => {
  const STORE = readFileSync(join(HERE, "..", "main", "session-store.js"), "utf8");
  const api = new Function(
    `${fnOf(STORE, "sessionKey")}\n${fnOf(STORE, "slotKey")}\n return { sessionKey, slotKey };`
  )();
  assert.equal(api.slotKey({ channelId: "c1", agentId: "a1" }), "c1:a1");
  assert.equal(api.slotKey({ channelId: "c1", agentId: "a1", taskId: "t1" }), "c1:a1", "the agent WINS");
  // Every existing caller passes no agentId, so it lands exactly where it always did.
  for (const t of ["t1", "", null, undefined]) {
    assert.equal(api.slotKey({ channelId: "c1", taskId: t }), api.sessionKey("c1", t));
  }
  assert.equal(api.slotKey(null), ":");
});

// Brace-balanced extraction of a top-level function (the classify.test.mjs idiom).
function fnOf(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(start, i);
}
