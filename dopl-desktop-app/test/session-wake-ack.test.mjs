// T50 (2026-09-01) — THE WAKE ACKNOWLEDGEMENT.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────────────────
// `@agent-<id>` in a post body is a wake the SERVER cannot confirm: the token is parsed on the
// operator's machine (`session-dispatch.js › feedLiveSession`) and nothing crosses back. So an
// orchestrator that redirected an agent could not tell "it landed and the agent is on it" from
// "it landed on nobody" — and those need opposite next actions. It re-posted, five times, into
// silence.
//
// ── THE FIX ─────────────────────────────────────────────────────────────────────────────
// `session-gate.js › enqueue` — the DELIVERY point — stamps `lastWakeSeq` / `lastWakeAt` on the
// session when the wake verdict is true. They ride the projection out through
// `session-health.js › health`, so one `read_sessions` answers the question.
//
// ⚠ NO CHANNEL POST GOES WITH IT, by ruling. The acknowledgement is a FIELD an orchestrator
// reads, not a row in a transcript both members pay for.
//
// SOURCE EXTRACTION with INJECTION — the `main-audit-gate-queue.test.mjs` idiom: slice
// SESSION-GATE-PURE, inject the REAL `session-io` queue helpers, drive `enqueue` and
// `feedInbound` directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "session-gate.js"), "utf8");

const BEGIN = "// ─── BEGIN SESSION-GATE-PURE";
const END = "// ─── END SESSION-GATE-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.ok(from !== -1 && to > from, "SESSION-GATE-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

const realIo = require(join(MAIN, "session-io.js"));
const MAX_PENDING_INBOUND = Number(
  /const MAX_PENDING_INBOUND = (\d+);/.exec(readFileSync(join(MAIN, "session-io.js"), "utf8"))[1]
);

function harness() {
  const dispatched = [];
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
  api.bind({ sessions, dispatch: (s, ev) => dispatched.push(ev) });
  return { ...api, sessions, dispatched };
}

/** A live windowless session at the message floor every spawn lands on. */
const session = (over = {}) => ({
  key: "c1:t1",
  settled: false,
  pendingInbound: [],
  state: { messageMode: "auto_inbound", inboundForTask: false, mode: "interactive" },
  win: null,
  ...over,
});

const inbound = (over = {}) => ({
  channelId: "c1",
  taskId: "t1",
  message: "@agent-a1b2c3d4 switch to the invoice thread",
  authorName: "Samuel",
  seq: 861,
  ...over,
});

// ── 1. THE STAMP ─────────────────────────────────────────────────────────────────────────

test("WAKE: a delivered wake stamps the seq and the clock", () => {
  const h = harness();
  const s = session();
  const before = Date.now();
  assert.equal(h.enqueue(s, inbound({ wake: true })), true);
  assert.equal(s.lastWakeSeq, 861);
  assert.ok(s.lastWakeAt >= before && s.lastWakeAt <= Date.now());
});

test("WAKE: an UNADDRESSED delivery stamps nothing — a feed is not a wake", () => {
  // ⚠ THE DISTINCTION IS THE WHOLE VALUE OF THE FIELD. Every message on a thread is FED to every
  // live agent on it (the fan-out ruling); only some of them WAKE one. A stamp on every feed
  // would answer "did my redirect land" with "yes" for every message anybody posted.
  const h = harness();
  const s = session();
  h.enqueue(s, inbound({ wake: false }));
  h.enqueue(s, inbound({ seq: 870 })); // no verdict at all
  assert.equal(s.lastWakeSeq, undefined);
  assert.equal(s.lastWakeAt, undefined);
  // …and the ordinary inbound bookkeeping still happened, so this is a narrowing and not a hole.
  assert.equal(s.lastInboundSeq, 870);
});

test("WAKE: it reads the VERDICT, never the body — an @-mention alone stamps nothing", () => {
  // ⚠ `a.wake` IS THE TIER DECISION ALREADY MADE for THIS message and THIS agent
  // (`session-dispatch.js › feedLiveSession`). Re-deriving it here would be a second spelling of
  // the wake rule, which is how two readers come to disagree about one message — and the LOOP
  // FENCE lives in that decision, so a body-reading stamp would credit an agent-authored post
  // that woke nothing.
  const h = harness();
  const s = session();
  h.enqueue(s, inbound({ message: "@agent-a1b2c3d4 do the thing" })); // body names it, verdict absent
  assert.equal(s.lastWakeSeq, undefined);
  assert.ok(!/a\.message/.test(BLOCK.slice(BLOCK.indexOf("lastWakeSeq") - 400, BLOCK.indexOf("lastWakeSeq"))),
    "the stamp must not be reached from anything that reads the body");
});

test("WAKE: only a strict `true` counts — a truthy value is not a verdict", () => {
  const h = harness();
  for (const wake of ["true", 1, {}, [], "yes"]) {
    const s = session();
    h.enqueue(s, inbound({ wake }));
    assert.equal(s.lastWakeSeq, undefined, String(wake));
  }
});

test("WAKE: a non-finite seq stamps nothing — there is no `#<seq>` to report", () => {
  const h = harness();
  for (const seq of [undefined, null, "eight", NaN, Infinity]) {
    const s = session();
    h.enqueue(s, inbound({ wake: true, seq }));
    assert.equal(s.lastWakeSeq, undefined, String(seq));
    assert.equal(s.lastWakeAt, undefined, String(seq));
  }
});

test("WAKE: the LATEST wake wins — the field answers 'woke on #<seq>', not 'was woken once'", () => {
  const h = harness();
  const s = session();
  h.enqueue(s, inbound({ wake: true, seq: 861 }));
  h.enqueue(s, inbound({ wake: true, seq: 902 }));
  assert.equal(s.lastWakeSeq, 902);
});

// ── 2. A WAKE THE QUEUE REJECTED IS NOT A WAKE ───────────────────────────────────────────

test("WAKE: an OVERFLOWED message stamps nothing — it was never delivered", () => {
  // ⚠ THE STAMP SITS PAST THE `full` EARLY RETURN ON PURPOSE. A wake recorded above that line
  // claims a turn for a message the queue rejected, which is precisely the false confirmation
  // this field exists to remove — and the caller falls through to a PASSIVE notice, so the agent
  // really did not get it.
  const h = harness();
  const s = session({ state: { messageMode: "ask", inboundForTask: false, mode: "interactive" } });
  for (let i = 0; i < MAX_PENDING_INBOUND; i++) {
    assert.equal(h.enqueue(s, inbound({ wake: false, seq: 100 + i, message: `held ${i}` })), true);
  }
  assert.equal(h.enqueue(s, inbound({ wake: true, seq: 999 })), false, "the queue is full");
  assert.equal(s.lastWakeSeq, undefined, "a rejected message woke nothing");
});

// ── 3. THROUGH THE ENGINE'S OWN ENTRY POINT ──────────────────────────────────────────────

test("WAKE: it lands through `feedInbound`, which is the door every lane uses", () => {
  const h = harness();
  const s = session();
  h.sessions.set("c1:a1b2c3d4", s);
  assert.equal(h.feedInbound({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4",
    message: "go", authorName: "Samuel", seq: 861, wake: true }), true);
  assert.equal(s.lastWakeSeq, 861);
});

test("WAKE: a SPAWN-IDLE shell refused for want of a wake stamps nothing", () => {
  // The belt in `feedInbound`: an unwoken spawn-idle session is fed NOTHING until something
  // names it, so there is no delivery and there must be no acknowledgement of one.
  const h = harness();
  const s = session({ awaitingDirective: true });
  h.sessions.set("c1:a1b2c3d4", s);
  assert.equal(h.feedInbound({ channelId: "c1", taskId: "t1", agentId: "a1b2c3d4",
    message: "hello", authorName: "Samuel", seq: 861 }), false);
  assert.equal(s.lastWakeSeq, undefined);
});
