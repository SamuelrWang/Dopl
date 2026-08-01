// AUDIT D2 — a message REJECTED by a full gate queue must not be recorded as gated.
//
// main/session-gate.js enqueue() called io.noteGatedBody(s, a.message) BEFORE io.queueInbound,
// which answers 'full' at MAX_PENDING_INBOUND (16). The overflowing message correctly fell
// through to the caller's passive notice (enqueue -> false), but its body was now in
// s.gatedBodies — and BOTH readers of that list drop the entry:
//   session-history.js  filter((e) => !io.isGatedEntry(e, s.gatedBodies))  -> rendered history
//   session-seed.js     the same filter inside historySeed                -> the fresh-run seed
// So a message that exists on the server was invisible in the window AND invisible to the agent,
// permanently. The fix moves noteGatedBody BELOW the 'full' early return: nothing was gated, so
// nothing is recorded. It still runs ahead of every consumer (queueInbound only appends to the
// in-memory FIFO; the dispatch that feeds the turn is below it).
//
// SOURCE EXTRACTION with INJECTION (the session-gate.test.mjs idiom): slice the BEGIN/END
// SESSION-GATE-PURE block, inject the REAL io queue + seed helpers, drive the 17th message.

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
assert.ok(from !== -1 && to > from, "SESSION-GATE-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

// The REAL helpers that ship: the bounded FIFO (session-io) and the seed-exclusion recorder
// plus its reader (session-seed, re-exported through session-io). Neither imports electron.
const realIo = require(join(HERE, "..", "main", "session-io.js"));
const realSeed = require(join(HERE, "..", "main", "session-seed.js"));

// MAX_PENDING_INBOUND, read off the source so this test cannot drift from the shipped bound.
const MAX_PENDING_INBOUND = Number(
  /const MAX_PENDING_INBOUND = (\d+);/.exec(readFileSync(join(HERE, "..", "main", "session-io.js"), "utf8"))[1]
);

function harness() {
  const calls = { dispatch: [], notices: [] };
  let n = 0;
  const crypto = { randomUUID: () => `pid-${++n}` };
  class FakeNotification {
    constructor(opts) { calls.notices.push(opts); }
    static isSupported() { return true; }
    on() {}
    show() {}
  }
  const io = {
    queueInbound: realIo.queueInbound,
    shiftInbound: realIo.shiftInbound,
    noteGatedBody: realIo.noteGatedBody,
  };
  const sessions = new Map();
  // D2: the gate keys on store.slotKey now — (channel, agent) for a TEAM session,
  // (channel, thread) for every other — so the fake mirrors both builders.
  const store = {
    sessionKey: (c, t) => `${c}:${t}`,
    slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}`,
  };
  const sessionPark = { recreateParkedShell: async () => ({ ok: false }) };
  const api = new Function(
    "crypto", "Notification", "io", "store", "sessionPark", "diag",
    `${BLOCK}\n return { bind, enqueue, feedInbound, decideInbound };`
  )(crypto, FakeNotification, io, store, sessionPark, () => {});
  api.bind({ sessions, dispatch: (s, ev) => calls.dispatch.push(ev) });
  return { ...api, sessions, calls };
}

const session = () => ({
  key: "c1:t1",
  settled: false,
  pendingInbound: [],
  state: { messageMode: "ask", inboundForTask: false, mode: "interactive" },
  windowHidden: false,
  win: { isDestroyed: () => false, isFocused: () => false, show() {}, focus() {} },
});

const reply = (message) => ({ channelId: "c1", taskId: "t1", message, authorName: "David" });

// Fill the queue to exactly MAX_PENDING_INBOUND held cards.
function fillQueue(h, s) {
  for (let i = 0; i < MAX_PENDING_INBOUND; i++) {
    assert.equal(h.enqueue(s, reply(`held ${i}`)), true, `message ${i} must be held`);
  }
  assert.equal(s.pendingInbound.length, MAX_PENDING_INBOUND, "the queue is full");
}

// ── the bug: the 17th message ────────────────────────────────────────────────────

test("D2: the overflow message is REJECTED and is NOT recorded as gated", () => {
  const h = harness();
  const s = session();
  fillQueue(h, s);
  const overflow = "the seventeenth message, which the server has and the operator does not";
  assert.equal(h.enqueue(s, reply(overflow)), false, "a full queue rejects, so the listener notifies passively");
  assert.equal(s.pendingInbound.length, MAX_PENDING_INBOUND, "and nothing was queued");
  assert.ok(
    !(s.gatedBodies || []).some((b) => b.includes("seventeenth")),
    "the rejected body must never enter s.gatedBodies"
  );
});

test("D2: a rejected message survives BOTH filters that read s.gatedBodies", () => {
  const h = harness();
  const s = session();
  fillQueue(h, s);
  const overflow = "please review the refund before Friday";
  h.enqueue(s, reply(overflow));
  // The exact predicate session-history.js and session-seed.js filter with.
  const entry = { role: "counterparty", text: overflow };
  assert.equal(
    realSeed.isGatedEntry(entry, s.gatedBodies || []),
    false,
    "the rejected message must render in the window history and ride the fresh-run seed"
  );
  // Control: a message that really WAS gated is still excluded from both.
  assert.equal(realSeed.isGatedEntry({ role: "counterparty", text: "held 0" }, s.gatedBodies || []), true);
});

// ── the held path is unchanged ───────────────────────────────────────────────────

test("D2: a message that IS held is still recorded before anything can consume it", () => {
  const h = harness();
  const s = session();
  assert.equal(h.enqueue(s, reply("first")), true);
  assert.deepEqual(s.gatedBodies, ["first"], "FIX F1 still holds for a real hold");
  assert.equal(h.calls.dispatch[0].type, "inbound_arrived");
  // Queued behind the head: recorded too, and still no double-consume.
  assert.equal(h.enqueue(s, reply("second")), true);
  assert.deepEqual(s.gatedBodies, ["first", "second"]);
  assert.equal(h.calls.dispatch.length, 1, "only the HEAD surfaces");
});

test("D2: an AUTO-fed message (no hold) is still excluded from the seed", () => {
  const h = harness();
  const s = session();
  s.state.messageMode = "auto_inbound";
  assert.equal(h.enqueue(s, reply("auto")), true);
  assert.deepEqual(s.gatedBodies, ["auto"], "it rides its own continuation, so it must not seed twice");
  assert.equal(h.calls.dispatch[0].type, "inbound_arrived");
  assert.equal(h.calls.notices.length, 0, "auto never surfaces a gate banner");
});

test("D2: noteGatedBody sits BELOW the full early return in the shipped source", () => {
  const enqueueSrc = BLOCK.slice(BLOCK.indexOf("function enqueue(s, a)"));
  const body = enqueueSrc.slice(0, enqueueSrc.indexOf("\n}"));
  const full = body.indexOf("=== 'full'");
  const note = body.indexOf("io.noteGatedBody(");
  assert.ok(full !== -1 && note !== -1, "both the overflow return and the recorder still exist");
  assert.ok(note > full, "recording a gated body must happen only AFTER the overflow rejection");
});
