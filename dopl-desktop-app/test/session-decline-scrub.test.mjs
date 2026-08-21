// FIX F1 — a message the GATE handled must not reach the agent a second time through the seed.
//
// THE BEHAVIOUR. `s.gatedBodies` is the session's list of bodies the gate handled, and the
// reader of it drops the entry:
//   main/session-seed.js     the filter inside historySeed  -> the fresh-run seed the AGENT gets
// The listener advances its cursor to a message's seq BEFORE dispatching it, so a history read
// that runs after the gate ALWAYS contains the body the gate just took. Recording it is what
// makes a fed message appear exactly ONCE — in its own fenced continuation — instead of once
// there and again out of the next fresh run's transcript.
//
// ⚠ THIS FILE WAS ABOUT THE *DECLINE* ARM AND THAT ARM IS DELETED (2026-08-20, F-228;
// INVARIANTS §14 — rewritten down to what survives, not removed). `session-gate.js` recorded in
// TWO places:
//   enqueue()       io.noteGatedBody(s, a.message)     — when the card was raised     [SURVIVES]
//   decideInbound() io.noteGatedBody(s, head.message)  — when the answer was DECLINE  [DELETED]
// `decideInbound` was the operator's Accept/Decline on the head of the queue, dispatched from
// the session window's gate card. There is no card, no window, and — decisively — nothing left
// to decide: a windowless session's message axis is floored at `auto_inbound` (INVARIANTS §11),
// so `autoInbound` answers true, `queueInbound` returns 'dispatch', and no reply is ever HELD
// for a human. The hold and its accept surface were one mechanism and went together.
//
// F-145's ARGUMENT SURVIVES ITS SUBJECT, WHICH IS WHY THIS FILE DOES TOO. F-145 was raised
// because the decline arm had no test and read like a belt ("idempotent: enqueue recorded it
// already") — and a belt with no test is a line a future reader deletes as dead. The SAME thing
// is now true of the enqueue arm: `main-audit-gate-queue.test.mjs` drives it for the OVERFLOW
// rule (noteGatedBody must sit BELOW the 'full' early return) and asserts nothing about the
// other edge — that it must sit ABOVE the dispatch. Nothing else pins that ordering, and it is
// the load-bearing one: a reducer or a parallel history load must never observe a fed message
// that is not yet scrubbed. So the contract pinned here is still the FUNCTION's rather than the
// happy path's, on the one arm that is left.
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

// ⚠ THE INJECTION SET SHRANK WITH THE MODULE. The `Notification` fake and the `sessionPark`
// stub had no referent left in the block (the OS-banner family and `feedInboundForTask` are
// deleted), and `decideInbound` in the return statement threw a ReferenceError before a single
// case ran — which is what took all six red at once rather than one at a time.
function harness() {
  const calls = { dispatch: [] };
  let n = 0;
  const crypto = { randomUUID: () => `pid-${++n}` };
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
  const api = new Function(
    "crypto", "io", "store", "diag",
    `${BLOCK}\n return { bind, enqueue, autoInbound, feedInbound };`
  )(crypto, io, store, () => {});
  api.bind({ sessions, dispatch: (s, ev) => calls.dispatch.push(ev) });
  return { ...api, sessions, calls };
}

// `win: null` — agents run WINDOWLESS (F-228). The default posture is the production one:
// `auto_inbound`, the floor every windowless session is held at.
const session = (over = {}) => ({
  key: "c1:t1",
  settled: false,
  pendingInbound: [],
  state: { messageMode: "auto_inbound", inboundForTask: false, mode: "interactive", ...(over.state || {}) },
  win: null,
  ...over,
});

const reply = (message) => ({ channelId: "c1", taskId: "t1", message, authorName: "David" });

/** The exact predicate session-seed.js filters the fresh-run transcript with. */
const wouldReachTheAgent = (s, body) =>
  !realSeed.isGatedEntry({ role: "counterparty", text: body }, s.gatedBodies || []);

// ── the guard: the gate scrubs on EVERY posture, not just the one it was written for ──

test("F1: fail-closed — every posture the gate can take scrubs the body it handled", () => {
  // ⚠ REWRITTEN FROM "any decision that is not an explicit accept scrubs". The old case fed
  // `decideInbound` junk verdicts ("dismiss", "", null, 1, {}) and proved they all took the
  // SAFE branch, which was the one that scrubbed. There are no verdicts. The surviving
  // fail-closed property is the same shape one level up: whatever AXIS B says — including a
  // value nothing sets, and a corrupt one a hand-edited store could produce — a body that
  // entered the gate is recorded, so the seed can never hand it to the agent again.
  //
  // The two lanes matter for different reasons and both are driven: `auto_inbound` /
  // `auto_both` / `inboundForTask` DISPATCH (the body is fed now, so a seed copy is a
  // DUPLICATE), `ask` and anything unrecognised HOLD (the body is queued, so a seed copy is a
  // message the operator has not answered arriving unasked).
  for (const state of [
    { messageMode: "auto_inbound" },
    { messageMode: "auto_both" },
    { messageMode: "ask", inboundForTask: true },
    { messageMode: "ask" },
    { messageMode: "AUTO_BOTH" }, // case is not normalized here: an unknown value must HOLD
    { messageMode: null },
    { messageMode: 1 },
    {},
  ]) {
    const h = harness();
    const s = session({ state });
    const body = `handled under ${JSON.stringify(state)}`;
    assert.equal(h.enqueue(s, reply(body)), true, JSON.stringify(state));
    assert.equal(wouldReachTheAgent(s, body), false, JSON.stringify(state));
  }
});

test("F1: it records THIS message's body, never another one on the queue", () => {
  // The queue can hold several messages. Recording the wrong one would BOTH duplicate the
  // message it missed AND hide one the agent has not been given yet — the two failures the old
  // "it is the HEAD's body, not the queue's latest" case was written against, in the arm that
  // is left. Driven under `ask` so a real queue exists to get wrong.
  const h = harness();
  const s = session({ state: { messageMode: "ask" } });
  assert.equal(h.enqueue(s, reply("the first one")), true);
  assert.equal(h.enqueue(s, reply("the second one")), true);
  assert.deepEqual(s.gatedBodies, ["the first one", "the second one"], "each call records its OWN body");
  assert.equal(h.calls.dispatch.length, 1, "and only the head is fed");
});

test("F1: recording twice does not duplicate the entry", () => {
  // The idempotence the old "held, then declined, and it is scrubbed once" case proved through
  // the two arms. With one arm left it is `noteGatedBody`'s own contract, and it still matters:
  // `s.gatedBodies` is bounded (session-seed SEED_SKIP_CAP), so duplicates would evict real
  // entries off the front and quietly un-scrub the oldest messages in a busy thread.
  const h = harness();
  const s = session({ state: { messageMode: "ask" } });
  const body = "can you push the release tonight?";
  assert.equal(h.enqueue(s, reply(body)), true);
  assert.equal(h.enqueue(s, reply(body)), true, "the same words can genuinely arrive twice");
  assert.deepEqual(s.gatedBodies, [body]);
  assert.equal(wouldReachTheAgent(s, body), false);
});

test("F1: a FED message rides its own continuation AND is excluded from the seed", () => {
  // ⚠ REWRITTEN FROM "an ACCEPT does NOT depend on this arm — it rides its own fenced
  // continuation". That case existed as the CONTRAST that gave the decline arm meaning: an
  // accepted body reached the agent deliberately, through `inbound_accept`, so the seed
  // exclusion was what stopped it arriving TWICE — and that recording was enqueue's, not
  // decideInbound's. With the decline arm gone the contrast collapses into the rule: this is
  // the ONLY lane, the dispatch carries the body, and the exclusion is the only thing standing
  // between the agent and reading it a second time.
  const h = harness();
  const s = session();
  const body = "yes please, go ahead";
  assert.equal(h.autoInbound(s), true, "precondition: the windowless floor, so this is fed");
  assert.equal(h.enqueue(s, reply(body)), true);
  const fed = h.calls.dispatch.at(-1);
  assert.equal(fed.type, "inbound_arrived");
  assert.equal(fed.message, body, "the agent gets it through the continuation, not the seed");
  assert.equal(wouldReachTheAgent(s, body), false, "and it is still excluded from the seed");
});

// ── the shipped source, so the ORDER cannot drift back ───────────────────────────

test("F1: the gate records BEFORE it dispatches", () => {
  // ⚠ REWRITTEN FROM the decline arm's ordering (shift < note < dispatch). The middle term is
  // what survives, on `enqueue`, and NOTHING else in the suite pins it —
  // `main-audit-gate-queue.test.mjs` pins the other edge (note must sit BELOW the 'full' early
  // return) and stops there. Both edges are needed: too early and an overflowing message is
  // scrubbed without ever being gated; too late and the reducer is fed a body that the next
  // history read can still hand over a second time.
  const src = BLOCK.slice(BLOCK.indexOf("function enqueue(s, a)"));
  const body = src.slice(0, src.indexOf("\n}"));
  const full = body.indexOf("=== 'full'");
  const note = body.indexOf("io.noteGatedBody(");
  const dispatch = body.indexOf("deps.dispatch(");
  assert.ok(full !== -1 && note !== -1 && dispatch !== -1, "all three still exist");
  assert.ok(full < note, "nothing was gated on an overflow, so nothing is recorded (AUDIT D2)");
  assert.ok(note < dispatch,
    "the body is recorded BEFORE the turn is fed — a reducer or a parallel history load must " +
    "never observe a message that is not yet scrubbed");
  assert.match(body, /io\.noteGatedBody\(s, a\.message\)/,
    "it scrubs THIS call's message, never a queue entry it did not put there");
});

test("F1: the DELETED arm is deleted, not silently reintroduced somewhere quieter", () => {
  // The belt on the ⚠ in this file's header. If a decline path ever comes back, it comes back
  // with a scrub or the refused words reach the next seed verbatim — and the person who writes
  // it should read this file first.
  const codeOnly = BLOCK.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(codeOnly.includes("function enqueue"), "precondition: stripping comments left the code");
  for (const dead of ["decideInbound", "drainQueue", "drainInbound", "feedInboundForTask"]) {
    assert.ok(!codeOnly.includes(dead), `${dead} is back without a case in this file`);
  }
  assert.equal(
    (codeOnly.match(/io\.noteGatedBody\(/g) || []).length, 1,
    "exactly ONE recorder — a second one is a second ordering to get wrong"
  );
});
