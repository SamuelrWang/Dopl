// CONTEXT ECONOMY W2 (2026-10-12): A WOKEN THREAD AGENT IS TOLD WHERE TO RE-READ FROM.
//
// Every re-read of a thread used to page the whole thread again. A fed turn now names
// `since=<seq>`: the seq through which this run holds EVERY message on its thread. The mark is
// advanced at the one delivery point (`session-gate.js › enqueue`) and frozen the moment the
// dispatch does NOT hand the run a thread message (`session-dispatch.js › markGap`), so a named
// `since=` never skips a message the agent has not seen. A run that may have missed messages (a
// resume, a revived record) carries no mark and names nothing. Driven through the REAL chain: the
// sliced dispatch block → the sliced gate block → the real reducer → the engine's pushInbound
// expression (pinned against its source) → the real seed.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { harness as dispatchHarness, verdictMsg, agent, ME, A1, A2, THREAD } from "./_wake-dispatch-harness.mjs";

const require = createRequire(import.meta.url);
const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");
const io = require(join(MAIN, "session-io.js"));
const seed = require(join(MAIN, "session-seed.js"));
const { sessionReducer } = require(join(MAIN, "session-reducer.js"));
const { initialSessionState } = require(join(MAIN, "session-state.js"));
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
const SINCE = /read it with since=(\d+), not in full\./;

const ENGINE_PUSH = "io.withSeed(s, io.frameContinuation(s.nonce, eff.message, eff.authorName, eff.addressing, eff.authorNote, s.doplToolSet, io.replyFor(s, eff.replyTo, eff.fromScope), eff.source, eff.catchUpSeq, s, eff.fromScope))";
test("the engine's pushInbound is the expression this file drives", () => {
  assert.ok(read("session-engine.js").includes(ENGINE_PUSH));
});

// A running thread session, as `startSession` builds one (`io.initialCatchUp`, the engine's call).
function session(spec = { threadId: THREAD }) {
  return {
    key: "k", settled: false, agentId: A1, nonce: "n1", side: "responder",
    channelId: CH, workspaceId: WS, threadId: THREAD, freshFraming: false, awaitingDirective: false,
    context: { channelName: "Ops", channelId: CH, workspaceId: WS, threadId: THREAD, scope: "thread" },
    catchUp: io.initialCatchUp(spec),
    state: { ...initialSessionState({ mode: "interactive", side: "responder", messageMode: "auto_inbound" }), phase: "running", parked: false },
  };
}

// One machine: the real gate + reducer + engine push, fed by the real dispatch for each message.
function machine(s) {
  const pushed = [];
  const SRC = read("session-gate.js");
  const block = SRC.slice(SRC.indexOf("// ─── BEGIN SESSION-GATE-PURE"), SRC.indexOf("// ─── END SESSION-GATE-PURE"));
  const g = new Function("crypto", "io", "store", "diag", `${block}\n return { bind, feedInbound };`)(
    crypto, io, { slotKey: () => "k" }, () => {},
  );
  g.bind({
    sessions: new Map([["k", s]]),
    dispatch: (sess, ev) => {
      const { state, effects } = sessionReducer(sess.state, ev);
      sess.state = state;
      for (const eff of effects) if (eff.type === "pushInbound") pushed.push(new Function("io", "s", "eff", `return ${ENGINE_PUSH};`)(io, sess, eff));
    },
  });
  // The dispatch roster holds THIS session object, so the gap it marks is the one the gate reads.
  const send = (msg, over = {}) => {
    const h = dispatchHarness({ agents: [Object.assign(s, agent(A1), { key: "k" })], ...over });
    h.feedLiveSession({ channel: { id: CH, name: "Ops" }, workspaceId: WS }, msg, "me" in over ? over.me : ME);
    // A refusal is the feed answering false: the recorder saw the call, nothing was delivered.
    if (over.feedInboundReturn === false) return;
    for (const call of h.calls.feedInbound) g.feedInbound({ ...call, agentId: A1 });
  };
  return { pushed, send };
}

const toThread = (seq) => verdictMsg("thread", { seq, body: `thread message ${seq}` });
const toOther = (seq) => verdictMsg("agent", { seq, recipientAgentIds: [A2], body: `for someone else ${seq}` });
const sinceOf = (turn) => { const m = SINCE.exec(turn); return m ? Number(m[1]) : null; };

test("each fed thread message names since= its own seq while nothing was withheld", () => {
  const m = machine(session());
  m.send(toThread(10));
  m.send(toThread(12));
  assert.equal(m.pushed.length, 2);
  assert.deepEqual(m.pushed.map(sinceOf), [10, 12]);
});

test("a thread message this run was NOT handed freezes the mark: since= never passes it", () => {
  const m = machine(session());
  m.send(toThread(10));
  m.send(toOther(11)); // routed to another agent: skipped for this run
  m.send(toThread(12));
  m.send(toThread(14));
  assert.equal(m.pushed.length, 3, "the skipped message was not fed");
  assert.deepEqual(m.pushed.map(sinceOf), [10, 10, 10]);
});

test("a message HELD (dormant, not woken) or REFUSED by the feed is a gap too", () => {
  for (const withhold of [
    (m, s) => { s.awaitingDirective = true; m.send(toThread(11)); s.awaitingDirective = false; },
    (m) => m.send(toThread(11), { feedInboundReturn: false }),
  ]) {
    const s = session();
    const m = machine(s);
    m.send(toThread(10));
    const before = m.pushed.length;
    withhold(m, s);
    assert.equal(m.pushed.length, before, "message 11 never reached the agent");
    m.send(toThread(12));
    assert.deepEqual(m.pushed.map(sinceOf), [10, 10]);
  }
});

// Batch 47 finding 1: the identity return sits BEFORE the fan-out, so it must gap the runs too.
test("a thread message dropped because this machine cannot say who it is is a gap", () => {
  const m = machine(session());
  m.send(toThread(10));
  m.send(toThread(11), { me: null }); // no operator id: fails closed, nothing is fed
  m.send(toThread(12));
  assert.equal(m.pushed.length, 2, "message 11 never reached the agent");
  assert.deepEqual(m.pushed.map(sinceOf), [10, 10]);
});

// Batch 47 finding 2, Samuel's ruling (#4622, card #4619 option 1): a peer's MILESTONE (or any
// non-message row) is never fed, so it is a gap — the since= named afterwards stays BELOW it and a
// `since=N` re-read returns it. The run's OWN milestone is not one: it wrote it.
test("a peer's milestone is a gap: since= stays below it, so the re-read returns it", () => {
  const s = session();
  const m = machine(s);
  m.send(toThread(10));
  m.send(verdictMsg("thread", { seq: 11, kind: "thread_progress", body: "step landed" }));
  m.send(toThread(12));
  assert.equal(m.pushed.length, 2, "the milestone is not fed");
  const since = sinceOf(m.pushed[1]);
  assert.ok(since < 11, `since=${since} must sit below the milestone`);
});

test("the run's OWN milestone is not a gap", () => {
  const s = session();
  const m = machine(s);
  m.send(toThread(10));
  m.send(verdictMsg("thread", { seq: 11, kind: "thread_progress", body: "mine", metadata: { session_id: "k" } }));
  m.send(toThread(12));
  assert.deepEqual(m.pushed.map(sinceOf), [10, 12]);
});

test("a gap before anything was delivered names no since= at all", () => {
  const m = machine(session());
  m.send(toOther(9));
  m.send(toThread(10));
  assert.equal(m.pushed.length, 1);
  assert.equal(sinceOf(m.pushed[0]), null);
  assert.ok(!/since=/.test(m.pushed[0]));
});

test("a resumed run, or one with no thread, starts with no mark and never names since=", () => {
  assert.equal(io.initialCatchUp({ threadId: THREAD, resumeSdkId: "sdk-1" }), null);
  assert.equal(io.initialCatchUp({ threadId: "" }), null);
  assert.deepEqual(io.initialCatchUp({ threadId: THREAD }), { through: null, gap: false });
  const m = machine(session({ threadId: THREAD, resumeSdkId: "sdk-1" }));
  m.send(toThread(10));
  assert.equal(m.pushed.length, 1);
  assert.ok(!/since=/.test(m.pushed[0]));
});

test("the since= line sits inside our voice, below the fence and above the reply call", () => {
  const out = seed.frameContinuation("n9", "body", "Dave", null, null, undefined, "CALL", undefined, 41).split("\n");
  const end = out.indexOf("END-REQUEST-n9");
  const line = out.findIndex((l) => SINCE.test(l));
  assert.ok(end !== -1 && line === end + 1, "right below the fence");
  assert.match(out[out.length - 1], /^Answer IN THE CHANNEL/, "the reply call stays the last line");
  assert.ok(!seed.frameContinuation("n9", "body", "Dave").includes("since="), "no seq, no line");
});
