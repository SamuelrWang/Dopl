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
// ⚠ THIS FILE WAS ABOUT THE *DECLINE* ARM, AND THE HOLD IT BELONGED TO IS DELETED TOO (the decline
// arm 2026-08-20, F-228; the hold queue and the reducer's accept/decline arms 2026-09-25, Samuel's
// ruling 5). One recorder is left — `enqueue`'s `io.noteGatedBody(s, a.message)` — and it runs on
// every fed message. F-145's argument survives its subject: a belt with no test is a line a future
// reader deletes as dead, and the ORDER (recorded ABOVE the dispatch) is load-bearing — a reducer or
// a parallel history load must never observe a fed message that is not yet scrubbed.
//
// SOURCE EXTRACTION with INJECTION — the session-gate.test.mjs idiom: slice the BEGIN/END
// SESSION-GATE-PURE block and inject the REAL seed helpers.

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

// The REAL seed-exclusion recorder and its reader (session-seed, re-exported through session-io).
const realIo = require(join(HERE, "..", "main", "session-io.js"));
const realSeed = require(join(HERE, "..", "main", "session-seed.js"));

function harness() {
  const calls = { dispatch: [] };
  const io = { noteGatedBody: realIo.noteGatedBody };
  const sessions = new Map();
  const store = { slotKey: (a) => `${(a && a.channelId) || ""}:${(a && (a.agentId || a.taskId)) || ""}` };
  const api = new Function("io", "store", `${BLOCK}\n return { bind, enqueue, feedInbound };`)(io, store);
  api.bind({ sessions, dispatch: (s, ev) => calls.dispatch.push(ev) });
  return { ...api, sessions, calls };
}

// The default posture is the production one: `auto_inbound`, the floor every windowless session is held at.
const session = (over = {}) => ({
  key: "c1:t1",
  settled: false,
  state: { messageMode: "auto_inbound", mode: "interactive", ...(over.state || {}) },
  ...over,
});

const reply = (message) => ({ channelId: "c1", taskId: "t1", message, authorName: "David" });

/** The exact predicate session-seed.js filters the fresh-run transcript with. */
const wouldReachTheAgent = (s, body) =>
  !realSeed.isGatedEntry({ role: "counterparty", text: body }, s.gatedBodies || []);

// ── the guard: the feed scrubs on EVERY posture ─────────────────────────────────

test("F1: fail-closed — every posture scrubs the body it fed, a corrupt one included", () => {
  for (const state of [
    { messageMode: "auto_inbound" }, { messageMode: "auto_both" }, { messageMode: "ask" },
    { messageMode: "AUTO_BOTH" }, { messageMode: null }, { messageMode: 1 }, {},
  ]) {
    const h = harness();
    const s = session({ state });
    const body = `handled under ${JSON.stringify(state)}`;
    assert.equal(h.enqueue(s, reply(body)), true, JSON.stringify(state));
    assert.equal(wouldReachTheAgent(s, body), false, JSON.stringify(state));
  }
});

test("F1: each call records its OWN body, and every message is fed", () => {
  const h = harness();
  const s = session({ state: { messageMode: "ask" } });
  assert.equal(h.enqueue(s, reply("the first one")), true);
  assert.equal(h.enqueue(s, reply("the second one")), true);
  assert.deepEqual(s.gatedBodies, ["the first one", "the second one"]);
  assert.deepEqual(h.calls.dispatch.map((e) => e.message), ["the first one", "the second one"]);
});

test("F1: recording twice does not duplicate the entry", () => {
  // `s.gatedBodies` is bounded (session-seed SEED_SKIP_CAP), so duplicates would evict real
  // entries off the front and quietly un-scrub the oldest messages in a busy thread.
  const h = harness();
  const s = session();
  const body = "can you push the release tonight?";
  assert.equal(h.enqueue(s, reply(body)), true);
  assert.equal(h.enqueue(s, reply(body)), true, "the same words can genuinely arrive twice");
  assert.deepEqual(s.gatedBodies, [body]);
  assert.equal(wouldReachTheAgent(s, body), false);
});

test("F1: a FED message rides its own continuation AND is excluded from the seed", () => {
  const h = harness();
  const s = session();
  const body = "yes please, go ahead";
  assert.equal(h.enqueue(s, reply(body)), true);
  const fed = h.calls.dispatch.at(-1);
  assert.equal(fed.type, "inbound_arrived");
  assert.equal(fed.message, body, "the agent gets it through the continuation, not the seed");
  assert.equal(wouldReachTheAgent(s, body), false, "and it is still excluded from the seed");
});

// ── the shipped source, so the ORDER cannot drift back ───────────────────────────

test("F1: the feed records BEFORE it dispatches, through exactly one recorder", () => {
  const codeOnly = BLOCK.replace(/^\s*\/\/.*$/gm, " ");
  const src = codeOnly.slice(codeOnly.indexOf("function enqueue(s, a)"));
  const body = src.slice(0, src.indexOf("\n}"));
  const note = body.indexOf("io.noteGatedBody(");
  const dispatch = body.indexOf("deps.dispatch(");
  assert.ok(note !== -1 && dispatch !== -1, "both still exist");
  assert.ok(note < dispatch,
    "the body is recorded BEFORE the turn is fed — a reducer or a parallel history load must " +
    "never observe a message that is not yet scrubbed");
  assert.match(body, /io\.noteGatedBody\(s, a\.message\)/, "it scrubs THIS call's message");
  assert.equal((codeOnly.match(/io\.noteGatedBody\(/g) || []).length, 1,
    "exactly ONE recorder — a second one is a second ordering to get wrong");
});
