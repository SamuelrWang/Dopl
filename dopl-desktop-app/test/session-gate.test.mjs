// Tests for the INBOUND FEED's engine side (main/session-gate.js).
//
// SOURCE EXTRACTION with INJECTION (the session-park idiom): the BEGIN/END SESSION-GATE-PURE block
// references its leaf deps (io / store) and the bind()-set engine handles as free vars, so we slice
// the block, prove it holds no electron require, inject fakes, and pin:
//   every message is dispatched on arrival — inbound consent is retired and its hold deleted
//   (2026-09-25, Samuel's ruling 5), so nothing queues, surfaces or waits for an Accept;
//   a session held on its sign-in, a settled one and an unknown one are refused;
//   FIX F1 — a fed message never ALSO rides the channel-history seed.

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

// The REAL seed helpers — session-io.js imports nothing electron-bound.
const realIo = require(join(HERE, "..", "main", "session-io.js"));

const KEY = "c1:t1";

function harness() {
  const calls = { dispatch: [] };
  const sessions = new Map();
  const store = { slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}` };
  const io = { noteGatedBody: realIo.noteGatedBody }; // FIX F1: the real seed-exclusion recorder
  const api = new Function("io", "store", `${BLOCK}\n return { bind, feedInbound };`)(io, store);
  api.bind({ sessions, dispatch: (s, ev) => { calls.dispatch.push(ev); } });
  return { ...api, sessions, calls };
}

// A session object shaped like the engine's.
function fakeSession(over = {}) {
  const state = { messageMode: "ask", mode: "interactive", ...(over.state || {}) };
  return { key: KEY, settled: false, ...over, state };
}

const reply = (over = {}) => ({ channelId: "c1", taskId: "t1", message: "ping", authorName: "David", ...over });
const evTypes = (calls) => calls.dispatch.map((e) => e.type);

test("feedInbound dispatches every message on arrival, in every posture, live or parked", () => {
  const states = [{}, { messageMode: "auto_both" }, { messageMode: "auto_outbound" }, { toolMode: "bypass" }, { parked: true }];
  for (const st of states) {
    const h = harness();
    h.sessions.set(KEY, fakeSession({ state: st }));
    assert.equal(h.feedInbound(reply({ message: "first" })), true, JSON.stringify(st));
    assert.equal(h.feedInbound(reply({ message: "second" })), true);
    assert.deepEqual(evTypes(h.calls), ["inbound_arrived", "inbound_arrived"], "nothing queues behind a head");
    assert.deepEqual(h.calls.dispatch.map((e) => e.message), ["first", "second"]);
  }
});

test("the fed event carries the framing and the origin, never a pending id", () => {
  const h = harness();
  h.sessions.set(KEY, fakeSession());
  h.feedInbound(reply({ addressing: { to: "me" }, authorNote: "note", replyTo: "u1", fromOperator: true }));
  assert.deepEqual(h.calls.dispatch[0], {
    type: "inbound_arrived", message: "ping", authorName: "David",
    authorNote: "note", addressing: { to: "me" }, replyTo: "u1", fromOperator: true,
  });
  h.feedInbound(reply({ fromOperator: "yes" }));
  assert.equal(h.calls.dispatch[1].fromOperator, false, "only `=== true` is the operator");
});

test("an unknown / settled session is not ours to feed (false -> a refused receipt)", () => {
  const h = harness();
  assert.equal(h.feedInbound(reply()), false, "no session for this key");
  h.sessions.set(KEY, fakeSession({ settled: true }));
  assert.equal(h.feedInbound(reply()), false);
  assert.deepEqual(evTypes(h.calls), []);
});

test("a session held on its sign-in is refused, and the body stays in its history", () => {
  const h = harness();
  const s = fakeSession({ state: { authHeld: true, parked: true } });
  s.pendingHistory = [{ from: "David", text: "while you were out", lane: "them" }];
  h.sessions.set(KEY, s);
  assert.equal(h.feedInbound(reply({ message: "while you were out", wake: true })), false);
  assert.deepEqual(evTypes(h.calls), []);
  assert.equal(s.lastWakeSeq, undefined, "a refused message is no wake");
  assert.ok(realIo.withSeed(s, "hi").includes("while you were out"), "not recorded as fed, so the seed keeps it");
});

// ── FIX F1: a fed message never rides the channel-history seed as well ──────────
//
// The listener advances its cursor to a message's seq BEFORE dispatching it, so any history
// window fetched around that moment contains the very message the feed just took. Baking the
// seed at fetch time therefore fed the body twice. The seed is assembled at first-turn time
// (realIo.withSeed) minus every body the feed recorded; `pendingHistory` is whatever a caller
// stashed for the first turn.

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

test("FIX F1: a FED message is ABSENT from the seeded first turn", () => {
  const h = harness();
  const s = reopenedShell(THREAD());
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" }));
  const turn = realIo.withSeed(s, "what did they say?");
  assert.ok(!turn.includes("secret plan"), "it is not seed context — it rides its own continuation");
  assert.ok(turn.includes("kick off"), "the rest of the thread still seeds the turn");
  assert.ok(turn.endsWith("what did they say?"));
});

test("FIX F1: a fed message reaches the agent exactly ONCE (continuation, not seed)", () => {
  const h = harness();
  const s = reopenedShell(THREAD());
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: "secret plan" }));
  // The engine's pushInbound effect: the fenced continuation, seeded once via withSeed.
  const turn = realIo.withSeed(s, realIo.frameContinuation(s.nonce, "secret plan", "David"));
  assert.equal(turn.split("secret plan").length - 1, 1, "fed once, not seed + continuation");
  assert.ok(turn.includes("kick off"), "the earlier thread is still context");
});

test("FIX F1: a CLAMPED history entry still matches the gated body it came from", () => {
  const h = harness();
  const long = "z".repeat(2500);
  const s = reopenedShell([{ from: "David", text: long.slice(0, 2000) + "…", lane: "them" }]);
  h.sessions.set(KEY, s);
  h.feedInbound(reply({ message: long }));
  assert.equal(realIo.withSeed(s, "hi"), "hi", "nothing left to seed, so no fence at all");
});

test("nothing here can hold or notify: no Notification, no queue, and the deleted surfacing stays deleted", () => {
  // Code only, so the header's prose ABOUT the deletion cannot satisfy or fail it.
  const code = BLOCK.replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(code.includes("function enqueue"), "precondition: stripping comments left the code");
  for (const dead of ["Notification", "pendingInbound", "queueInbound", "autoInbound", "decideInbound", "drainInbound", "inboundNotice"]) {
    assert.ok(!code.includes(dead), `${dead} is deleted, not merely unexported`);
  }
  const io = readFileSync(join(HERE, "..", "main", "session-io.js"), "utf8");
  assert.ok(!/queueInbound|shiftInbound|MAX_PENDING_INBOUND/.test(io), "the hold queue left session-io.js with it");
});
