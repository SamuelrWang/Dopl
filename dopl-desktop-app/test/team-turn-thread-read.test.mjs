// A TEAM SESSION WAS NEVER TOLD TO READ THE THREAD IT WAS WOKEN INTO (review of F1-F7).
//
// WHAT F7 BUILT, AND WHO IT MISSED. A fresh responder spawn carries none of the exchange it is
// answering, so prompt-framing.firstActions orders it to read that one thread before it writes:
// `op "read", channel, workspace, thread "<id>"`. The line is gated on `ctx.taskId` — and a TEAM
// session has none. Its slot is (channel, AGENT) and session-team.js constructs it with
// `taskId: ''` ON PURPOSE: an agent lives in the ROOM and works whatever thread it is asked in,
// so keying the slot on a thread would collapse every agent of a channel onto one session.
//
// F1 then made that hole the common case. Milestones now thread-route into team sessions
// (channel-agents.routeThread), so the one session shape that wakes up INSIDE an exchange it
// holds nothing of was the one shape never told to read it.
//
// THE FIX, and why it is per-TURN. The thread is a fact about THIS DELIVERY — which message woke
// the agent — not about the session, so it rides the delivery the way `message` and `authorName`
// already do: channel-deliver.deliverToAgent -> the gate's queue ITEM -> the dispatched event ->
// the reducer's pushInbound effect -> io.withSeed -> session-seed.turnContext, which fills the
// framing context's missing `taskId` for that one turn. THE SLOT DOES NOT MOVE, `s.context` is
// never written, and a pair session — which has a bound thread of its own — is untouched.
//
// WHAT IS PINNED HERE:
//   THE TURN        a room-bound first turn framed with a thread carries the scoped read, with
//                   the RIGHT id; without one it is byte for byte the spawn turn it was.
//   THE CARRIAGE    the id really travels: delivery -> gate item -> event -> effect -> withSeed,
//                   including the case that made it per-turn (two threads queued at one gate).
//   NO SPILL        it is not written to the session, and a thread-less shape produces the exact
//                   effect object every other reducer suite pins.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { loadReducer } from "./_reducer-block.mjs";
import { ME, PEER, CH, MINE, THEIRS, THREAD, agent, msg, entry, routed, harness } from "./helpers/channel-agents.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const seed = require("../main/session-seed.js");

const CHANNEL = "cccccccc-1111-2222-3333-444444444444";
const WS = "wwwwwwww-1111-2222-3333-444444444444";
const AGENT = "aaaaaaaa-1111-2222-3333-444444444444";
const OTHER_THREAD = "9c9c9c9c-2222-3333-4444-555555555555";

/** The context session-team.js builds: channel + workspace + identity, and NO thread. */
const teamContext = (over = {}) => ({
  channelName: "Ops", channelId: CHANNEL, workspaceId: WS, agentId: AGENT,
  agentName: "quartz", ownerName: "Samuel", ...over,
});

/** A room-bound parked shell, as startSession stamps one with nothing to resume. */
const teamShell = (over = {}) => ({
  side: "responder", bind: "room", nonce: "n0nce", context: teamContext(),
  freshFraming: true, freshRun: true, gatedBodies: [], ...over,
});

// ── 1. the turn itself ────────────────────────────────────────────────────────

test("a thread-routed wake frames the team turn WITH the scoped read, ids and all", () => {
  const s = teamShell();
  const turn = seed.withSeed(s, "cobalt replied in the channel.", THREAD);
  assert.match(turn, /You are quartz, an agent in the shared channel "Ops"\./, "still the team turn");
  assert.match(turn, /Your SECOND action is to read the exchange you are joining/);
  assert.ok(
    turn.includes(`with op "read", channel "${CHANNEL}", workspace "${WS}", thread "${THREAD}"`),
    `the whole scoped call:\n${turn}`
  );
  assert.equal(turn.split('op "read"').length - 1, 1, "one read instruction");
  assert.ok(turn.indexOf('op "read"') < turn.indexOf('op "post", channel "'), "read first, then deliver");
});

test("…and the delivery call it is handed carries the SAME thread, so the reply lands in it", () => {
  // THE LAW rule 2 is "reply where you were asked". A turn told to read one thread and to post
  // untagged would answer the room instead of the room it was woken by.
  const turn = seed.withSeed(teamShell(), "x", THREAD);
  assert.ok(turn.includes(`op "post", channel "${CHANNEL}", workspace "${WS}", thread "${THREAD}", as_agent "${AGENT}"`));
  assert.match(turn, /Keep that thread argument on every post you make here/);
});

test("the SPAWN turn — no thread yet — is byte for byte the turn it was", () => {
  const before = seed.withSeed(teamShell(), "the room says hello");
  for (const junk of ["", null, undefined, "   ", 0, {}]) {
    const turn = seed.withSeed(teamShell(), "the room says hello", junk);
    assert.equal(turn, before, `${JSON.stringify(junk)}: unchanged`);
  }
  assert.ok(!before.includes('op "read"'), "no half-addressed read");
  assert.ok(!/SECOND action/.test(before), "and no orphan step");
  assert.ok(!/undefined|null/.test(before), "no placeholder leaks");
  // FIX F3b (2026-08-04): the lookup ORDER is gone (ToolSearch is hard-denied on every
  // session profile — see prompt-profile-drift.test.mjs); the GRANT statement it was really
  // protecting rides alone in its place.
  assert.match(before, /mcp__dopl__dopl_channel is GRANTED to this session/, "the grant line still rides alone");
});

test("a half-known address prints no read, whatever the turn's thread is", () => {
  for (const over of [{ channelId: "" }, { workspaceId: null }]) {
    const turn = seed.withSeed(teamShell({ context: teamContext(over) }), "x", THREAD);
    assert.ok(!turn.includes('op "read"'), JSON.stringify(over));
    assert.ok(!/undefined|null/.test(turn), JSON.stringify(over));
  }
});

test("a PAIR session's own bound thread WINS: the per-turn id only ever fills a hole", () => {
  const pair = {
    side: "responder", nonce: "n", freshFraming: true, freshRun: true, gatedBodies: [],
    context: { channelName: "Ops", channelId: CHANNEL, workspaceId: WS, taskId: THREAD },
  };
  const turn = seed.withSeed(pair, "x", OTHER_THREAD);
  assert.ok(turn.includes(`thread "${THREAD}"`), "the session's own thread");
  assert.ok(!turn.includes(OTHER_THREAD), "never overwritten by a turn's id");
  assert.match(turn, /COUNTERPARTY \(who you are answering/, "and it is still the ASSIST framing");
});

test("NOTHING IS WRITTEN TO THE SESSION: the room-bound context stays thread-less", () => {
  const s = teamShell();
  seed.withSeed(s, "x", THREAD);
  assert.equal(s.context.taskId, undefined, "a later turn from another thread must frame itself");
  assert.equal(s.freshFraming, false, "the framing is still the one-shot it was");
  // The SECOND turn is a bare continuation — the per-turn id cannot resurrect the preamble.
  assert.equal(seed.withSeed(s, "next turn", OTHER_THREAD), "next turn");
});

test("turnContext is pure: it returns the SAME object when there is nothing to add", () => {
  const ctx = teamContext();
  assert.equal(seed.turnContext({ context: ctx }, ""), ctx, "no thread, no copy");
  assert.equal(seed.turnContext({ context: { taskId: THREAD } }, OTHER_THREAD).taskId, THREAD);
  const filled = seed.turnContext({ context: ctx }, ` ${THREAD} `);
  assert.equal(filled.taskId, THREAD, "trimmed");
  assert.notEqual(filled, ctx, "and the session's own context object is never mutated");
  assert.equal(ctx.taskId, undefined);
  assert.deepEqual(seed.turnContext({}, THREAD), { taskId: THREAD }, "a context-less shell is fine");
});

// ── 2. the carriage: does the id actually get there? ──────────────────────────

test("DELIVERY: the thread lane hands the routed thread id to the session feed", async () => {
  const h = harness({
    roster: [agent({ status: "active" })],
    participants: [{ kind: "agent", agentId: MINE, userId: null }, { kind: "agent", agentId: THEIRS, userId: null }],
    live: [`${CH}:${MINE}`],
  });
  const e = entry();
  await h.reconcileChannel(e, ME);
  h.calls.feed.length = 0;
  const m = msg({
    kind: "task_progress", authorKind: "agent",
    metadata: { taskId: THREAD, author_agent_id: THEIRS },
  });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed");
  assert.equal(h.calls.feed[0].threadId, THREAD, "the milestone's own thread rides the delivery");
});

test("DELIVERY: a main-room turn carries no thread, and a LEGACY tag carries none either", async () => {
  const room = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  assert.equal(await room.h.routeAddressedAgent(room.e, msg({ metadata: { to_agent_id: MINE } }), ME), "fed");
  assert.equal(room.h.calls.feed[0].threadId, "", "no thread in the main room");

  const legacy = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const tagged = msg({ metadata: { to_agent_id: MINE, taskId: `task-${CH}-42` } });
  assert.equal(await legacy.h.routeAddressedAgent(legacy.e, tagged, ME), "fed");
  assert.equal(legacy.h.calls.feed[0].threadId, "",
    "a legacy id names no readable thread, so the read line must not be printed for it");
});

test("DELIVERY: an ADDRESSED post inside a thread carries it too (the lane does not matter)", async () => {
  const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const named = msg({ authorUserId: PEER, metadata: { to_agent_ids: [MINE], to_user_id: ME, taskId: THREAD } });
  assert.equal(await h.routeAddressedAgent(e, named, ME), "fed");
  assert.equal(h.calls.feed[0].threadId, THREAD);
});

// ── 3. the gate carries THIS message's thread, not the queue's latest ─────────

const GATE_SRC = M("session-gate.js");
const GATE_BLOCK = GATE_SRC.slice(
  GATE_SRC.indexOf("// ─── BEGIN SESSION-GATE-PURE"),
  GATE_SRC.indexOf("// ─── END SESSION-GATE-PURE")
);
const realIo = require("../main/session-io.js");

function gate() {
  const calls = { dispatch: [] };
  let n = 0;
  const crypto = { randomUUID: () => `pid-${++n}` };
  class FakeNotification {
    static isSupported() { return false; }
    on() {}
    show() {}
  }
  const sessions = new Map();
  const store = { sessionKey: (c, t) => `${c}:${t}`, slotKey: (a) => `${a.channelId}:${a.agentId || a.taskId || ""}` };
  const api = new Function(
    "crypto", "Notification", "io", "store", "sessionPark", "diag",
    `${GATE_BLOCK}\n return { bind, enqueue, feedInbound, decideInbound, drainInbound };`
  )(crypto, FakeNotification, realIo, store, { recreateParkedShell: async () => ({ ok: false }) }, () => {});
  api.bind({ sessions, dispatch: (s, ev) => calls.dispatch.push(ev) });
  const s = {
    key: `${CH}:${MINE}`, settled: false, pendingInbound: [], state: { messageMode: "ask" },
    win: { isDestroyed: () => true },
  };
  sessions.set(`${CH}:${MINE}`, s);
  return { ...api, s, calls };
}

const feed = (over = {}) => ({ channelId: CH, agentId: MINE, message: "ping", authorName: "David", ...over });

test("GATE: the thread rides the queue item and the card's own event", () => {
  const h = gate();
  h.feedInbound(feed({ threadId: THREAD }));
  assert.equal(h.s.pendingInbound[0].threadId, THREAD, "held on the item, next to the body");
  assert.equal(h.calls.dispatch[0].type, "inbound_arrived");
  assert.equal(h.calls.dispatch[0].threadId, THREAD);
});

test("GATE: the ACCEPT carries the HEAD's thread, not whatever arrived after it", () => {
  // The reason this is per-message and not a field on the session: two threads can be waiting at
  // one gate, and the framing built on Accept must describe the message being accepted.
  const h = gate();
  h.feedInbound(feed({ message: "first", threadId: THREAD }));
  h.feedInbound(feed({ message: "second", threadId: OTHER_THREAD }));
  h.calls.dispatch.length = 0;
  h.decideInbound(h.s, "pid-1", "accept");
  assert.equal(h.calls.dispatch[0].type, "inbound_accept");
  assert.equal(h.calls.dispatch[0].message, "first");
  assert.equal(h.calls.dispatch[0].threadId, THREAD, "the head's own thread");
  // …and the card that replaces it carries the SECOND one.
  assert.equal(h.calls.dispatch[1].type, "inbound_arrived");
  assert.equal(h.calls.dispatch[1].threadId, OTHER_THREAD);
});

test("GATE: a drained backlog keeps each message's own thread", () => {
  const h = gate();
  h.s.state.messageMode = "ask";
  h.feedInbound(feed({ message: "a", threadId: THREAD }));
  h.feedInbound(feed({ message: "b", threadId: OTHER_THREAD }));
  h.s.state.messageMode = "auto_inbound"; // AXIS B flipped while cards were waiting
  h.calls.dispatch.length = 0;
  assert.equal(h.drainInbound(h.s), true);
  assert.deepEqual(h.calls.dispatch.map((e) => e.threadId), [THREAD, OTHER_THREAD]);
});

test("GATE: a main-room delivery still queues an empty thread, never undefined", () => {
  const h = gate();
  h.feedInbound(feed());
  assert.equal(h.s.pendingInbound[0].threadId, "");
  assert.equal(h.calls.dispatch[0].threadId, "");
});

// ── 4. the reducer effect, and the shapes that must not move ─────────────────

const { initialSessionState, sessionReducer } = loadReducer();
const running = (opts) =>
  sessionReducer(initialSessionState(opts), { type: "launched", payload: { type: "init" } }).state;
const findEff = (effects, type) => effects.find((e) => e.type === type);

test("REDUCER: an accepted turn's pushInbound effect carries its thread", () => {
  const held = sessionReducer(running(), { type: "inbound_arrived", pendingId: "p1", message: "go", authorName: "David", threadId: THREAD }).state;
  const r = sessionReducer(held, { type: "inbound_accept", pendingId: "p1", message: "go", authorName: "David", threadId: THREAD });
  assert.deepEqual(findEff(r.effects, "pushInbound"),
    { type: "pushInbound", message: "go", authorName: "David", threadId: THREAD });
});

test("REDUCER: the AUTO path carries it too (no card, straight to the turn)", () => {
  const auto = running({ messageMode: "auto_inbound" });
  const r = sessionReducer(auto, { type: "inbound_arrived", pendingId: "p1", message: "go", authorName: "David", threadId: THREAD });
  assert.deepEqual(findEff(r.effects, "pushInbound"),
    { type: "pushInbound", message: "go", authorName: "David", threadId: THREAD });
});

test("REDUCER: a thread-less turn produces the EXACT effect object it always did", () => {
  // The key is absent, not empty — the reducer suites deep-equal this shape, and an extra
  // undefined field would be a silent change to every one of them.
  for (const threadId of [undefined, "", null]) {
    const auto = running({ messageMode: "auto_both" });
    const r = sessionReducer(auto, { type: "inbound_arrived", pendingId: "p1", message: "go", authorName: "David", threadId });
    assert.deepEqual(findEff(r.effects, "pushInbound"),
      { type: "pushInbound", message: "go", authorName: "David" }, String(threadId));
  }
});

// ── 5. the last hop, pinned statically (the engine binds no fake here) ───────

test("ENGINE: the effect's thread is what withSeed is given", () => {
  const ENGINE = M("session-engine.js");
  assert.match(
    ENGINE,
    /io\.withSeed\(s, io\.frameContinuation\(s\.nonce, eff\.message, eff\.authorName\), eff\.threadId\)/,
    "pushInbound hands the turn's thread to the framing"
  );
  // …and the OTHER seed path (a steer / first turn) is deliberately left alone.
  assert.match(ENGINE, /io\.withSeed\(s, eff\.text\)/, "pushTurn is unchanged");
});

test("DELIVERY: the id is the UUID-gated one, taken at the delivery and not off the slot", () => {
  const DELIVER = M("channel-deliver.js");
  assert.match(DELIVER, /threadId: targeting\.firstClassTaskId\(m\),/);
  const TEAM = M("session-team.js");
  assert.match(TEAM, /taskId: '',/, "the SLOT still carries no thread: (channel, agent) is unchanged");
});
