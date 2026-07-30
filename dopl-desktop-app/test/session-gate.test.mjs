// Tests for the v2.5 D1 inbound-gate ENGINE side (main/session-gate.js).
//
// SOURCE EXTRACTION with INJECTION (the session-park idiom): the BEGIN/END
// SESSION-GATE-PURE block references its leaf deps (crypto / Notification / io / store /
// sessionPark / diag) and the bind()-set engine handles as free vars, so we slice the
// block, prove it holds no electron require, inject fakes, and pin:
//   a reply is HELD + surfaced (window pop is the engine's emit; here the OS notice);
//   the OS NOTIFICATION path itself (suppression, FIX #8's pre-dispatch focus reading, the
//   click handler, the copy) lives in the sibling test/inbound-gate-notify.test.mjs;
//   an accept / accept-for-task / decline dispatches the matching reducer event, and an
//   UNKNOWN decision string declines (fail closed);
//   a standing grant drains the whole held queue instead of leaving items behind;
//   no live session -> recreateParkedShell first (and {ok:false} -> no gate at all);
//   FIX F1 — a held / declined / accepted message never ALSO rides the channel-history
//   seed (the reopened shell's fetch window always contains it);
//   FIX F9 — a missing pendingId decides nothing (it used to consume the head).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-gate.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-GATE-PURE";
const END = "// ─── END SESSION-GATE-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-GATE-PURE sentinel missing");
assert.notEqual(to, -1, "END SESSION-GATE-PURE sentinel missing");
assert.ok(to > from, "session-gate sentinels out of order");
const BLOCK = SRC.slice(from, to);

for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!BLOCK.includes(banned), `SESSION-GATE-PURE block must not reference ${banned}`);
}

// The REAL queue helpers — session-io.js imports nothing electron-bound, so the FIFO
// semantics under test are the ones that ship.
const realIo = require(join(HERE, "..", "main", "session-io.js"));

const KEY = "c1:t1";

function harness(over = {}) {
  const cfg = { notifySupported: true, recreate: { ok: true }, recreated: null, ...over };
  const calls = { dispatch: [], notices: [], handlers: [], recreate: [] };

  const crypto = { randomUUID: (() => { let n = 0; return () => `pid-${++n}`; })() };
  class FakeNotification {
    constructor(opts) { this.opts = opts; calls.notices.push(opts); }
    static isSupported() { return cfg.notifySupported; }
    on(evt, fn) { if (evt === "click") calls.handlers.push(fn); }
    show() { this.shown = true; }
  }
  const io = {
    queueInbound: realIo.queueInbound,
    shiftInbound: realIo.shiftInbound,
    noteGatedBody: realIo.noteGatedBody, // FIX F1: the real seed-exclusion recorder
  };
  const sessions = new Map();
  const store = { sessionKey: (c, t) => `${c}:${t}` };
  // The REAL recreateParkedShell registers the shell in the engine registry (via
  // startSession) before returning; the fake mirrors that so the gate can find it.
  const sessionPark = {
    recreateParkedShell: async (a) => {
      calls.recreate.push(a);
      if (cfg.recreate && cfg.recreate.ok && cfg.recreated) sessions.set(store.sessionKey(a.channelId, a.taskId), cfg.recreated);
      return cfg.recreate;
    },
  };
  const diag = () => {};

  const api = new Function(
    "crypto", "Notification", "io", "store", "sessionPark", "diag",
    `${BLOCK}\n return { bind, inboundNotice, autoInbound, windowHasFocus, enqueue, feedInbound, feedInboundForTask, decideInbound, drainInbound };`
  )(crypto, FakeNotification, io, store, sessionPark, diag);
  // A faithful mini-dispatch: the engine's dispatch runs the reducer, which is what
  // arms the standing grant mid-decision (the drain below depends on that ordering).
  api.bind({
    sessions,
    dispatch: (s, ev) => {
      calls.dispatch.push(ev);
      if (ev.type === "inbound_accept_for_task" && s && s.state) s.state.inboundForTask = true;
    },
  });
  return { ...api, sessions, calls, cfg };
}

// A session object shaped like the engine's: reducer state + the pending FIFO + a window.
function fakeSession(over = {}) {
  const state = { messageMode: "ask", inboundForTask: false, mode: "interactive", ...(over.state || {}) };
  const focused = over.focused === true;
  return {
    key: KEY, settled: false, pendingInbound: [], state, windowHidden: false,
    win: { isDestroyed: () => false, isFocused: () => focused, show() { this.shown = true; }, focus() { this.focused = true; } },
    ...over, state,
  };
}

const reply = (over = {}) => ({ channelId: "c1", taskId: "t1", message: "ping", authorName: "David", ...over });
const evTypes = (calls) => calls.dispatch.map((e) => e.type);

// ── hold + surface ───────────────────────────────────────────────────────────────

test("feedInbound HOLDS the reply on the session queue and dispatches inbound_arrived", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  assert.equal(h.feedInbound(reply()), true);
  assert.equal(s.pendingInbound.length, 1, "the message waits on the session object");
  assert.deepEqual(evTypes(h.calls), ["inbound_arrived"]);
  assert.equal(h.calls.dispatch[0].message, "ping");
  assert.equal(h.calls.notices.length, 1, "one OS notification for the held message");
  assert.equal(h.calls.notices[0].title, "Message from David");
  assert.match(h.calls.notices[0].body, /^ping$/);
});

test("feedInbound gates a PARKED session the same way (the gate is mode/park agnostic)", () => {
  const h = harness();
  const s = fakeSession({ state: { messageMode: "ask", inboundForTask: false, mode: "autonomous", parked: true } });
  h.sessions.set(KEY, s);
  assert.equal(h.feedInbound(reply()), true);
  assert.equal(s.pendingInbound.length, 1);
  assert.deepEqual(evTypes(h.calls), ["inbound_arrived"]);
});

test("only the HEAD is surfaced; a second reply queues silently behind it", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "first" }));
  h.feedInbound(reply({ message: "second" }));
  assert.equal(s.pendingInbound.length, 2);
  assert.deepEqual(evTypes(h.calls), ["inbound_arrived"], "no card for the queued one yet");
  assert.equal(h.calls.notices.length, 1);
});

test("an unknown / settled session is not ours to gate (false -> the listener notifies)", () => {
  const h = harness();
  assert.equal(h.feedInbound(reply()), false, "no session for this key");
  h.sessions.set(KEY, fakeSession({ settled: true }));
  assert.equal(h.feedInbound(reply()), false);
  assert.deepEqual(evTypes(h.calls), []);
});

test("a FULL queue returns false so the listener can fall through to its passive notice", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  for (let i = 0; i < 16; i++) assert.equal(h.feedInbound(reply({ message: `m${i}` })), true);
  assert.equal(s.pendingInbound.length, 16, "the bounded FIFO cap (MAX_PENDING_INBOUND)");
  assert.equal(h.feedInbound(reply({ message: "overflow" })), false);
  assert.equal(s.pendingInbound.length, 16, "nothing is silently dropped from the queue");
});

// ── the auto path (D4) ───────────────────────────────────────────────────────────

test("AUTO (AXIS B or the standing grant): fed straight through, never queued, no notification", () => {
  // v2.9: the opt-ins are the MESSAGE axis (auto_inbound / auto_both) and the standing
  // "Accept for this session" grant. The TOOL axis is not one of them, at any value.
  for (const opt of [{ messageMode: "auto_inbound" }, { messageMode: "auto_both" }, { inboundForTask: true }]) {
    const h = harness();
    const s = fakeSession({ state: { messageMode: "ask", inboundForTask: false, ...opt } });
    h.sessions.set(KEY, s);
    assert.equal(h.feedInbound(reply()), true);
    assert.equal(s.pendingInbound.length, 0, `${JSON.stringify(opt)}: nothing is held`);
    assert.deepEqual(evTypes(h.calls), ["inbound_arrived"]);
    assert.equal(h.calls.notices.length, 0, `${JSON.stringify(opt)}: no gate notification`);
  }
});

test("autoInbound reads the LIVE state, and ONLY the message axis opts in", () => {
  const h = harness();
  assert.equal(h.autoInbound(fakeSession()), false);
  assert.equal(h.autoInbound(fakeSession({ state: { messageMode: "auto_inbound" } })), true);
  assert.equal(h.autoInbound(fakeSession({ state: { messageMode: "auto_both" } })), true);
  assert.equal(h.autoInbound(fakeSession({ state: { inboundForTask: true } })), true);
  // THE INVARIANT: outbound-only, and EVERY tool posture, leave the inbound gate holding.
  assert.equal(h.autoInbound(fakeSession({ state: { messageMode: "auto_outbound" } })), false);
  for (const toolMode of ["manual", "accept_edits", "auto", "bypass"]) {
    assert.equal(h.autoInbound(fakeSession({ state: { toolMode } })), false, `${toolMode} is not a message opt-in`);
  }
  assert.equal(h.autoInbound(null), false, "a junk session never auto-accepts");
});

// ── the operator decision ────────────────────────────────────────────────────────

test("decideInbound: accept / accept-task / decline map to their reducer events", () => {
  const cases = [
    ["accept", "inbound_accept"],
    ["accept-task", "inbound_accept_for_task"],
    ["decline", "inbound_decline"],
  ];
  for (const [decision, evType] of cases) {
    const h = harness();
    const s = fakeSession();
    h.sessions.set(KEY, s);
    h.feedInbound(reply());
    h.calls.dispatch.length = 0;
    assert.equal(h.decideInbound(s, "pid-1", decision), true);
    assert.deepEqual(evTypes(h.calls), [evType], decision);
    assert.equal(s.pendingInbound.length, 0, "the answered item leaves the queue");
  }
});

test("decideInbound FAILS CLOSED: an unknown decision string declines", () => {
  for (const junk of ["allow", "ACCEPT", "", undefined, null, "accept-all", { accept: true }]) {
    const h = harness();
    const s = fakeSession();
    h.sessions.set(KEY, s);
    h.feedInbound(reply());
    h.calls.dispatch.length = 0;
    h.decideInbound(s, "pid-1", junk);
    assert.deepEqual(evTypes(h.calls), ["inbound_decline"], `${String(junk)} must decline`);
  }
});

test("decideInbound ignores a STALE pendingId (a old card cannot consume a newer reply)", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  h.feedInbound(reply());
  h.calls.dispatch.length = 0;
  assert.equal(h.decideInbound(s, "pid-999", "accept"), false);
  assert.deepEqual(evTypes(h.calls), []);
  assert.equal(s.pendingInbound.length, 1, "the real head is untouched");
});

// FIX F9: an EMPTY/absent pendingId used to skip the head check entirely (`if (pendingId
// && …)`) and consume the head, so a call that named no card at all could spend the
// message the operator was still looking at.
test("FIX F9: a MISSING or empty pendingId decides nothing and never consumes the head", () => {
  for (const id of [undefined, null, "", 0, false]) {
    const h = harness();
    const s = fakeSession();
    h.sessions.set(KEY, s);
    h.feedInbound(reply());
    h.calls.dispatch.length = 0;
    assert.equal(h.decideInbound(s, id, "accept"), false, `${String(id)} must not decide`);
    assert.deepEqual(evTypes(h.calls), [], `${String(id)} must dispatch nothing`);
    assert.equal(s.pendingInbound.length, 1, `${String(id)} must leave the head waiting`);
    // The real id still works afterwards, so the card is not stranded either.
    assert.equal(h.decideInbound(s, "pid-1", "accept"), true);
    assert.equal(s.pendingInbound.length, 0);
  }
});

test("decideInbound on an empty queue / settled session is a no-op", () => {
  const h = harness();
  const s = fakeSession();
  assert.equal(h.decideInbound(s, "pid-1", "accept"), false);
  assert.equal(h.decideInbound({ settled: true, pendingInbound: [] }, "pid-1", "accept"), false);
  assert.deepEqual(evTypes(h.calls), []);
});

test("after an accept, the NEXT held reply becomes the new card and re-surfaces", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "first" }));
  h.feedInbound(reply({ message: "second" }));
  h.calls.dispatch.length = 0;
  h.calls.notices.length = 0;
  h.decideInbound(s, "pid-1", "accept");
  assert.deepEqual(evTypes(h.calls), ["inbound_accept", "inbound_arrived"]);
  assert.equal(h.calls.dispatch[1].message, "second");
  assert.equal(h.calls.notices.length, 1, "the next held message gets its own notification");
});

test("accept-for-task DRAINS every remaining held reply (none is stranded in the queue)", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  for (const message of ["a", "b", "c"]) h.feedInbound(reply({ message }));
  h.calls.dispatch.length = 0;
  h.calls.notices.length = 0;
  h.decideInbound(s, "pid-1", "accept-task");
  // The grant lands mid-decision (the reducer), so the backlog is FED rather than
  // re-surfaced one card at a time — and the queue is emptied as it goes.
  assert.deepEqual(evTypes(h.calls), ["inbound_accept_for_task", "inbound_accept", "inbound_accept"]);
  assert.deepEqual(h.calls.dispatch.map((e) => e.message), ["a", "b", "c"], "in arrival order");
  assert.equal(s.pendingInbound.length, 0, "nothing is left behind to be double-consumed");
  assert.equal(h.calls.notices.length, 0, "no further gate notifications once the grant is armed");
});

// ── D4: flipping the toggle ON feeds what is already held ────────────────────────

test("drainInbound feeds the whole backlog once an opt-in is armed (the AXIS B case)", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "a" }));
  h.feedInbound(reply({ message: "b" }));
  h.calls.dispatch.length = 0;
  s.state.messageMode = "auto_inbound"; // the reducer's set_message_mode landed
  assert.equal(h.drainInbound(s), true);
  assert.deepEqual(evTypes(h.calls), ["inbound_accept", "inbound_accept"]);
  assert.deepEqual(h.calls.dispatch.map((e) => e.message), ["a", "b"], "arrival order preserved");
  assert.equal(s.pendingInbound.length, 0, "no card is left behind a switch that says auto");
});

test("drainInbound is a NO-OP with no opt-in armed (it must never bypass the gate)", () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  h.feedInbound(reply());
  h.calls.dispatch.length = 0;
  assert.equal(h.drainInbound(s), false, "the toggle going OFF changes nothing");
  assert.deepEqual(evTypes(h.calls), [], "and it never re-emits a duplicate gate card");
  assert.equal(s.pendingInbound.length, 1, "the held reply keeps waiting for a decision");
  assert.equal(h.drainInbound({ settled: true, state: { messageMode: "auto_both" }, pendingInbound: [] }), false);
  assert.equal(h.drainInbound(null), false);
});

// ── no live session: recreate the shell, THEN gate ───────────────────────────────

test("feedInboundForTask recreates the parked shell and holds the reply on it", async () => {
  const shell = fakeSession();
  const h = harness({ recreate: { ok: true }, recreated: shell });
  assert.equal(await h.feedInboundForTask(reply()), true);
  // FIX F4: the body we are about to hold rides along, so the shell records it BEFORE its
  // (awaited) history read and the message renders ONCE — as the card, not also as history.
  assert.deepEqual(h.calls.recreate, [{ channelId: "c1", taskId: "t1", holdBody: "ping" }]);
  assert.equal(shell.pendingInbound.length, 1, "the reply waits on the recreated shell");
  assert.deepEqual(evTypes(h.calls), ["inbound_arrived"], "held, NOT fed as a continuation");
  assert.equal(h.calls.notices.length, 1, "the operator is notified about the reopened window");
});

test("feedInboundForTask: a recreate that reports ok but registers nothing -> false", async () => {
  const h = harness({ recreate: { ok: true }, recreated: null });
  assert.equal(await h.feedInboundForTask(reply()), false, "no session object, no gate");
  assert.deepEqual(evTypes(h.calls), []);
});

test("feedInboundForTask: a LIVE session skips the recreate and gates directly", async () => {
  const h = harness();
  const s = fakeSession();
  h.sessions.set(KEY, s);
  assert.equal(await h.feedInboundForTask(reply()), true);
  assert.equal(h.calls.recreate.length, 0, "no second window for a session already open");
  assert.equal(s.pendingInbound.length, 1);
});

test("feedInboundForTask: nothing survives on this machine -> false, no dispatch", async () => {
  const h = harness({ recreate: { ok: false } });
  assert.equal(await h.feedInboundForTask(reply()), false);
  assert.equal(h.calls.recreate.length, 1);
  assert.deepEqual(evTypes(h.calls), [], "the listener falls through to its passive notice");
});

// ── FIX F1: a gated message never rides the channel-history seed as well ──────────
//
// The reopened shell loads the channel history in PARALLEL with the hold, and the
// listener advanced its cursor to this message's seq BEFORE dispatching it, so the
// fetched window always contains the very message the gate is holding. Baking the seed at
// fetch time therefore fed a DECLINED message to the fresh session anyway, and fed an
// ACCEPTED one twice. The seed is now assembled at first-turn time (realIo.withSeed)
// minus every body the gate handled.

function reopenedShell(entries) {
  const s = fakeSession();
  s.nonce = "n0nce";
  s.pendingHistory = entries; // what session-history stashed after its fetch
  return s;
}
const THREAD = () => [
  { from: "Sam", text: "kick off", lane: "me" },
  { from: "David", text: "secret plan", lane: "them" },
];

test("FIX F1: a DECLINED message is ABSENT from the seeded first turn", () => {
  const h = harness();
  const s = reopenedShell(THREAD());
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" }));
  assert.equal(h.decideInbound(s, "pid-1", "decline"), true);
  const turn = realIo.withSeed(s, "what did they say?");
  assert.ok(!turn.includes("secret plan"), "a declined body must never reach the agent");
  assert.ok(turn.includes("kick off"), "the rest of the thread still seeds the turn");
  assert.ok(turn.endsWith("what did they say?"));
});

test("FIX F1: an ACCEPTED message reaches the agent exactly ONCE (continuation, not seed)", () => {
  const h = harness();
  const s = reopenedShell(THREAD());
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" }));
  assert.equal(h.decideInbound(s, "pid-1", "accept"), true);
  // The engine's pushInbound effect: the fenced continuation, seeded once via withSeed.
  const turn = realIo.withSeed(s, realIo.frameContinuation(s.nonce, "secret plan", "David"));
  assert.equal(turn.split("secret plan").length - 1, 1, "fed once, not seed + continuation");
  assert.ok(turn.includes("kick off"), "the earlier thread is still context");
});

test("FIX F1: a message still HELD at the gate is excluded when the operator types first", () => {
  const h = harness();
  const s = reopenedShell(THREAD());
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" })); // undecided, still on the queue
  const turn = realIo.withSeed(s, "hello");
  assert.ok(!turn.includes("secret plan"), "an unanswered message is not context yet");
  assert.equal(s.pendingInbound.length, 1, "and it is still waiting for a decision");
});

test("FIX F1: an AUTO-accepted message is excluded too (it rides its own continuation)", () => {
  const h = harness();
  const s = reopenedShell(THREAD());
  s.state.messageMode = "auto_both";
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" }));
  assert.equal(s.pendingInbound.length, 0, "auto never holds");
  assert.ok(!realIo.withSeed(s, "hello").includes("secret plan"), "no double feed on the auto path");
});

test("FIX F1: a CLAMPED history entry still matches the gated body it came from", () => {
  const h = harness();
  const long = "z".repeat(2500);
  const s = reopenedShell([{ from: "David", text: long.slice(0, 2000) + "…", lane: "them" }]);
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: long }));
  h.decideInbound(s, "pid-1", "decline");
  assert.equal(realIo.withSeed(s, "hi"), "hi", "nothing left to seed, so no fence at all");
});
