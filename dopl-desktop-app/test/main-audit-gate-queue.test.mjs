// AUDIT D2 — a message REJECTED by a full gate queue must not be recorded as gated.
//
// main/session-gate.js enqueue() called io.noteGatedBody(s, a.message) BEFORE io.queueInbound,
// which answers 'full' at MAX_PENDING_INBOUND (16). The overflowing message correctly fell
// through to the caller's passive notice (enqueue -> false), but its body was now in
// s.gatedBodies — and every reader of that list drops the entry:
//   session-seed.js     the filter inside historySeed                     -> the fresh-run seed
//   session-history.js  the same filter over the rendered entries         -> the window
// So a message that exists on the server was invisible to the agent (and, then, in the window),
// permanently. The fix moves noteGatedBody BELOW the 'full' early return: nothing was gated, so
// nothing is recorded. It still runs ahead of every consumer (queueInbound only appends to the
// in-memory FIFO; the dispatch that feeds the turn is below it).
//
// ⚠ ONE READER, NOT TWO, SINCE 2026-08-20 (F-228). `session-history.js` fed the session WINDOW's
// transcript and is deleted with it. The seed reader is untouched and is the half that was ever
// data loss rather than a rendering bug: it is what the AGENT reads. Rewritten down to it rather
// than removed (INVARIANTS §14) — the overflow rule is unchanged and still shipped.
//
// ⚠ AND EVERY MESSAGE NOW TAKES THE AUTO LANE. A windowless session's message axis is floored at
// `auto_inbound` (INVARIANTS §11), so `queueInbound` answers 'dispatch' and the queue never
// holds in production. The overflow branch is therefore driven here with an explicit `ask`
// posture — the gate's own code path is intact and MAX_PENDING_INBOUND still bounds it, so the
// rule stays testable, but it is reachable only from a posture nothing currently sets.
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

// ⚠ THE HARNESS SHRANK WITH THE MODULE (2026-08-20, F-228). It used to inject a fake
// `Notification` class and a `sessionPark` stub, and to return `decideInbound` alongside
// `enqueue`. None of the three has a referent any more: `decideInbound` (the operator's
// Accept/Decline on the head of the queue) was dispatched from the session window's gate card,
// `sessionPark.recreateParkedShell` served `feedInboundForTask`, and the PURE block raises no
// notification at all now. Leaving them in was not free — `new Function` throws a ReferenceError
// on a return statement naming a symbol the block no longer declares, which is what took all
// four cases below red at once, and a `Notification` fake nothing constructs would have made
// "no banner" assertions pass vacuously forever.
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
  // D2: the gate keys on store.slotKey now — (channel, agent) for a TEAM session,
  // (channel, thread) for every other — so the fake mirrors both builders.
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

// `win: null` is the shape every session has now — agents run WINDOWLESS (F-228). Kept as an
// explicit field rather than dropped, because the gate must go on treating a session object
// with no surface as an ordinary one.
const session = () => ({
  key: "c1:t1",
  settled: false,
  pendingInbound: [],
  state: { messageMode: "ask", inboundForTask: false, mode: "interactive" },
  win: null,
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

test("D2: a rejected message survives THE filter that reads s.gatedBodies", () => {
  // ⚠ REWRITTEN FROM "BOTH FILTERS" (2026-08-20, F-228; INVARIANTS §14). There were two readers
  // of `s.gatedBodies` and one of them is deleted: `main/session-history.js` fed the session
  // WINDOW's rendered transcript, and there is no window. `main/session-seed.js` is untouched
  // and is the one that always mattered here — it is what the AGENT reads on a fresh run, so an
  // over-eager exclusion means a message that exists on the server never reaches the agent,
  // permanently and silently. The window half was the visible symptom; the seed half is the
  // data loss. Same predicate, same bug, one reader.
  const h = harness();
  const s = session();
  fillQueue(h, s);
  const overflow = "please review the refund before Friday";
  h.enqueue(s, reply(overflow));
  // The exact predicate session-seed.js filters historySeed with.
  const entry = { role: "counterparty", text: overflow };
  assert.equal(
    realSeed.isGatedEntry(entry, s.gatedBodies || []),
    false,
    "the rejected message must ride the fresh-run seed, or the agent never sees it at all"
  );
  // Control: a message that really WAS gated is still excluded. Without this the case above
  // passes on an empty `gatedBodies` — i.e. on the recorder having been deleted outright.
  assert.equal(realSeed.isGatedEntry({ role: "counterparty", text: "held 0" }, s.gatedBodies || []), true);
  // ...and the filter really is still WIRED, not merely exported: historySeed is the caller.
  const SEED = readFileSync(join(HERE, "..", "main", "session-seed.js"), "utf8");
  assert.match(SEED, /entries\.filter\(\(e\) => !isGatedEntry\(e, \(s && s\.gatedBodies\) \|\| \[\]\)\)/,
    "the seed still drops gated bodies — an unwired filter makes every case in this file moot");
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
  // ⚠ THIS IS NOW THE ONLY LANE THERE IS, which raises its stakes rather than lowering them.
  // A windowless session's message axis is FLOORED at `auto_inbound` (INVARIANTS §11), so
  // `autoInbound` answers true, `queueInbound` returns 'dispatch' and nothing is ever held.
  // Every inbound reply therefore takes THIS path, and the recording below is the only thing
  // standing between the agent and reading each of them twice — once through the fenced
  // continuation, once again out of the next fresh run's history seed.
  const h = harness();
  const s = session();
  s.state.messageMode = "auto_inbound";
  assert.equal(h.autoInbound(s), true, "precondition: this really is the auto lane");
  assert.equal(h.enqueue(s, reply("auto")), true);
  assert.deepEqual(s.pendingInbound, [], "nothing is HELD — there is no surface to answer a hold");
  assert.deepEqual(s.gatedBodies, ["auto"], "it rides its own continuation, so it must not seed twice");
  assert.equal(h.calls.dispatch[0].type, "inbound_arrived");
  // ⚠ `assert.equal(h.calls.notices.length, 0, "auto never surfaces a gate banner")` STOOD HERE
  // AND IS DELETED (F-228). `enqueue` raises no OS notification on ANY path now — the
  // `windowHasFocus` / `notifyInbound` / `surface` family went with the window it suppressed
  // for — so a "no banner" assertion would pass against a gate that cannot banner at all.
  // A vacuous guard on a security-adjacent path is worse than none: it reads as coverage.
});

test("D2: noteGatedBody sits BELOW the full early return in the shipped source", () => {
  const enqueueSrc = BLOCK.slice(BLOCK.indexOf("function enqueue(s, a)"));
  const body = enqueueSrc.slice(0, enqueueSrc.indexOf("\n}"));
  const full = body.indexOf("=== 'full'");
  const note = body.indexOf("io.noteGatedBody(");
  assert.ok(full !== -1 && note !== -1, "both the overflow return and the recorder still exist");
  assert.ok(note > full, "recording a gated body must happen only AFTER the overflow rejection");
});
