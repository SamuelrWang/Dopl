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
  // D2: the fake mirrors the real store's TWO key builders. `slotKey` is what feedInbound
  // uses now — (channel, agent) for a TEAM session, (channel, thread) for every other — so
  // the fake has to answer it the same way or the gate would look at an empty registry.
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
  };
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
    `${BLOCK}\n return { bind, autoInbound, enqueue, feedInbound };`
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
  // ⚠ NO OS NOTIFICATION ANY MORE (2026-08-20, F-228). The banner existed to point the
  // operator at the WINDOW holding the card, and the gate no longer raises one itself.
  // ⚠ THE COPY BUILDER WENT TOO (F-235, same day): this comment used to add that
  // "`inboundNotice`'s COPY survives — `trigger.js` still sends it", which was never true —
  // trigger.js sends `consent.notifyInbound`, a different function. It is deleted.
  assert.equal(h.calls.notices.length, 0);
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
  assert.equal(h.calls.notices.length, 0);
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

// ⚠ TEN TESTS STOOD HERE AND WENT WITH THE HOLD/ACCEPT FAMILY (2026-08-20, F-228).
// `decideInbound` (accept / accept-task / decline, FIX F9's missing-pendingId guard, the stale
// -id guard), `drainQueue`'s re-surface, `drainInbound`'s backlog feed, and the four
// `feedInboundForTask` recreate cases. All of them answered a HELD reply from the session
// window's gate card, and there is no card.
//
// ⚠ WHY THIS IS NOT A LOST GUARD. A windowless session's message axis is held at the
// `auto_inbound` floor, so `autoInbound` answers true, `enqueue` takes its dispatch branch and
// the queue never holds — the hold path and the surface that answered it were ONE mechanism and
// went together. What did NOT go is the FIX F1 seed-exclusion discipline below, which is about
// what an agent SEES and applies to every fed message, held or not.

// ── FIX F1: a gated message never rides the channel-history seed as well ──────────
//
// The listener advances its cursor to a message's seq BEFORE dispatching it, so any history
// window fetched around that moment contains the very message the gate just took. Baking the
// seed at fetch time therefore fed the body twice. The seed is assembled at first-turn time
// (realIo.withSeed) minus every body the gate recorded.
//
// ⚠ THE SHELL THIS DESCRIBES WAS A REOPENED WINDOW and that lane is deleted (F-228), but the
// RULE is not about windows: `pendingHistory` is whatever a caller stashed for the first turn,
// and `io.noteGatedBody` runs on EVERY fed message. The fixture keeps its shape so the
// exclusion is still driven end to end.

function reopenedShell(entries) {
  const s = fakeSession();
  s.nonce = "n0nce";
  s.pendingHistory = entries; // what a first-turn history stash looks like
  return s;
}
const THREAD = () => [
  { from: "Sam", text: "kick off", lane: "me" },
  { from: "David", text: "secret plan", lane: "them" },
];

test("FIX F1: a GATED message is ABSENT from the seeded first turn", () => {
  // ⚠ REWRITTEN 2026-08-20: this drove `decideInbound(s, pid, "decline")` before asserting.
  // The RECORDING is what the rule is about and `enqueue` does it — `io.noteGatedBody` runs on
  // every fed message, decision or no decision — so the assertion is unchanged and the step
  // that no longer exists is simply not taken.
  const h = harness();
  const s = reopenedShell(THREAD());
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" }));
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
  // The engine's pushInbound effect: the fenced continuation, seeded once via withSeed.
  const turn = realIo.withSeed(s, realIo.frameContinuation(s.nonce, "secret plan", "David"));
  assert.equal(turn.split("secret plan").length - 1, 1, "fed once, not seed + continuation");
  assert.ok(turn.includes("kick off"), "the earlier thread is still context");
});

test("FIX F1: a message still HELD at the gate is excluded when the operator types first", () => {
  const h = harness();
  const s = reopenedShell(THREAD());
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" })); // recorded, and riding its own continuation
  const turn = realIo.withSeed(s, "hello");
  assert.ok(!turn.includes("secret plan"), "it is not seed context — it is fed as a turn");
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
  assert.equal(realIo.withSeed(s, "hi"), "hi", "nothing left to seed, so no fence at all");
});
