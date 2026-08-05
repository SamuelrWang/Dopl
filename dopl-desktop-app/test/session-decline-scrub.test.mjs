// FIX F1 (the DECLINE half) — a message the operator REFUSED must not reach the agent later.
//
// THE BEHAVIOUR. `s.gatedBodies` is the session's list of bodies the GATE handled, and both
// readers of it drop the entry:
//   main/session-history.js  filter((e) => !io.isGatedEntry(e, s.gatedBodies))  -> the window
//   main/session-seed.js     the same filter inside historySeed                -> the fresh seed
// The listener advances its cursor to a message's seq BEFORE dispatching it, so a history read
// that runs after the gate ALWAYS contains the body sitting on the card. Recording it is what
// makes an ACCEPTED message appear exactly once (in its own fenced continuation) and a
// DECLINED one appear not at all.
//
// `session-gate.js` records in TWO places, and this file is about the second:
//   enqueue()       io.noteGatedBody(s, a.message)     — when the card is raised
//   decideInbound() io.noteGatedBody(s, head.message)  — when the answer is DECLINE
//
// F-145 — THE SECOND HAD NO TEST. `main-audit-gate-queue.test.mjs` drives the first through
// seven cases; the decline arm could be deleted with all 2293 desktop tests green. It is
// written as a belt ("idempotent: enqueue recorded it already"), and a belt with no test is a
// line a future reader deletes as dead — after which a declined body reaches the next
// session's history seed on any path where the queue was populated without going through
// `enqueue`. So the contract pinned here is the FUNCTION's, not the happy path's: whatever put
// the card on the queue, deciding DECLINE records the body before the decline is dispatched.
//
// SOURCE EXTRACTION with INJECTION — the session-gate.test.mjs / main-audit-gate-queue.test.mjs
// idiom: slice the BEGIN/END SESSION-GATE-PURE block and inject the REAL io + seed helpers.

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

/** The exact predicate session-history.js and session-seed.js filter the transcript with. */
const wouldReachTheAgent = (s, body) =>
  !realSeed.isGatedEntry({ role: "counterparty", text: body }, s.gatedBodies || []);

// ── the guard: a decline records, whatever put the card on the queue ─────────────

test("F1: DECLINE records the head's body even when nothing recorded it on the way in", () => {
  // The card is on the queue and `gatedBodies` is empty — the shape any path that populates
  // `pendingInbound` without going through `enqueue` leaves behind. This is what makes the
  // decline arm load-bearing rather than decorative: without it the refused words are still
  // in the fetched history window, and the next seed hands them to the agent verbatim.
  const h = harness();
  const s = session();
  const secret = "the acquisition price is 4.2M, do not act on this";
  s.pendingInbound = [{ pendingId: "p-1", message: secret, authorName: "David", threadId: "" }];
  assert.equal(wouldReachTheAgent(s, secret), true, "precondition: nothing has scrubbed it yet");

  assert.equal(h.decideInbound(s, "p-1", "decline"), true);

  assert.ok((s.gatedBodies || []).includes(secret), "the declined body is recorded");
  assert.equal(wouldReachTheAgent(s, secret), false,
    "a declined message must be filtered out of BOTH the window history and the fresh seed");
  assert.equal(h.calls.dispatch.at(-1).type, "inbound_decline");
});

test("F1: the normal path still holds — held, then declined, and it is scrubbed once", () => {
  const h = harness();
  const s = session();
  const body = "can you push the release tonight?";
  assert.equal(h.enqueue(s, reply(body)), true);
  assert.deepEqual(s.gatedBodies, [body], "enqueue records it when the card is raised");

  const head = s.pendingInbound[0];
  assert.equal(h.decideInbound(s, head.pendingId, "decline"), true);

  assert.deepEqual(s.gatedBodies, [body], "recording twice must not duplicate the entry");
  assert.equal(wouldReachTheAgent(s, body), false);
});

test("F1: it is the HEAD's body that is scrubbed, not the queue's latest", () => {
  // The queue can hold several messages from several threads. Scrubbing the wrong one would
  // both leak the refused message AND hide a message nobody has answered yet.
  const h = harness();
  const s = session();
  s.pendingInbound = [
    { pendingId: "p-1", message: "refuse me", authorName: "David", threadId: "" },
    { pendingId: "p-2", message: "still waiting on an answer", authorName: "David", threadId: "" },
  ];

  h.decideInbound(s, "p-1", "decline");

  assert.equal(wouldReachTheAgent(s, "refuse me"), false);
  assert.equal(wouldReachTheAgent(s, "still waiting on an answer"), true,
    "the message behind it is still live and must keep rendering");
});

test("F1: fail-closed — any decision that is not an explicit accept scrubs", () => {
  // `decideInbound` maps everything but 'accept' / 'accept-task' to 'decline'. A junk verdict
  // from the renderer must take the SAFE branch, which is the one that scrubs.
  for (const verdict of ["decline", "dismiss", "", null, undefined, "ACCEPT", 1, {}]) {
    const h = harness();
    const s = session();
    const body = `refused via ${JSON.stringify(verdict)}`;
    s.pendingInbound = [{ pendingId: "p-1", message: body, authorName: "David", threadId: "" }];
    h.decideInbound(s, "p-1", verdict);
    assert.equal(wouldReachTheAgent(s, body), false, JSON.stringify(verdict));
  }
});

test("F1: an ACCEPT does NOT depend on this arm — it rides its own fenced continuation", () => {
  // The contrast that gives the case above meaning. An accepted message is fed to the agent
  // deliberately (`inbound_accept` carries the body), so the seed exclusion is what stops it
  // arriving TWICE — that recording is enqueue's, and the decline arm must not be read as the
  // only thing that ever scrubs.
  const h = harness();
  const s = session();
  const body = "yes please, go ahead";
  assert.equal(h.enqueue(s, reply(body)), true);
  const head = s.pendingInbound[0];
  h.decideInbound(s, head.pendingId, "accept");
  const accepted = h.calls.dispatch.at(-1);
  assert.equal(accepted.type, "inbound_accept");
  assert.equal(accepted.message, body, "the agent gets it through the continuation, not the seed");
  assert.equal(wouldReachTheAgent(s, body), false, "and it is still excluded from the seed");
});

// ── the shipped source, so the ORDER cannot drift back ───────────────────────────

test("F1: the decline arm records BEFORE it dispatches, and the head is already shifted", () => {
  const src = BLOCK.slice(BLOCK.indexOf("function decideInbound(s, pendingId, decision)"));
  const body = src.slice(0, src.indexOf("\nfunction drainQueue"));
  const shift = body.indexOf("io.shiftInbound(");
  const note = body.indexOf("io.noteGatedBody(");
  const decline = body.indexOf("'inbound_decline'");
  assert.ok(shift !== -1 && note !== -1 && decline !== -1, "all three still exist");
  assert.ok(shift < note, "the head leaves the queue first, so nothing can double-consume it");
  assert.ok(note < decline,
    "the body is recorded BEFORE the decline is dispatched — a reducer or a parallel history " +
    "load must never observe a declined message that is not yet scrubbed");
  assert.match(body, /io\.noteGatedBody\(s, head\.message\)/,
    "it scrubs THIS card's message, never the queue's latest");
});
