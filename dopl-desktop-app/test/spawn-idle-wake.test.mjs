// THE SPAWN-IDLE WAKE RULE, AND THE LAUNCH GOAL IT RESURRECTS (2026-08-22, Samuel's ruling).
//
// ── WHAT THE RULING IS ───────────────────────────────────────────────────────────────────────
// A SPAWN-IDLE agent (`sessions:launch` with `idle: true` — the New Agent button) registers, takes
// a slot against `MAX_CONCURRENT_SESSIONS`, gets an @-mention address and a pill, and starts NO
// `claude` child: `wakeEffects` runs its first query on the first fed turn. Under the plain fan-out
// that first turn was whatever was said next in the thread, so an agent parked "ready" woke on a
// passing remark between two other people and spent its launch answering nobody.
//
//   FED NOTHING while undirected. Unaddressed traffic is DROPPED, not queued — the agent reads the
//     thread on demand once woken, and that read costs no permission
//     (`session-profiles.js › isOwnChannelRead` scopes by channel only, auto-allowed under the
//     windowless message floor), so nothing is lost by not pushing it.
//   WOKEN by exactly two things: a 1:1 `sessions:message` (the reducer's `steer`), or a thread /
//     main-room message that @-mentions its agent id — FROM ANY AUTHOR, operator, peer or peer's
//     agent. That third case is the ruling verbatim ("user tells peer: I'm going to wake another
//     agent, you direct it") and is bounded by disclosure: an agent id is minted on this machine,
//     known to no server, and the parse is intersected with the ids live on this thread.
//
// ── AND THE BUG FOUND IN THE SAME PASS ───────────────────────────────────────────────────────
// The operator's LAUNCH GOAL was DEAD TEXT on this lane. `sessions:launch` composes one ("Join the
// thread "<title>" as my agent: read it with dopl_channel and carry the work forward") and hands it
// in as `spec.firstMessage`; on every other lane that becomes the fenced body of the first turn.
// Here `startSession` set `firstTurn = ''` for a `parkedShell`, and the wake path
// (`resumeParked` -> the reducer's `pushInbound`/`pushTurn`) never pushes `s.firstTurn` — only
// `session-query.js › startQuery` does, which a spawn-idle session never runs. So a woken agent
// opened on an EMPTY FENCE and everything it was launched to do was in a string nothing read.
//
// ── METHOD ───────────────────────────────────────────────────────────────────────────────────
// The routing half is driven in `test/session-dispatch.test.mjs` (the fan-out's own truth table).
// THIS file pins the three pieces that live outside it, each against the SHIPPED source: the stamp
// (`session-engine.js › startSession`), the clear (the engine's ONE dispatch funnel), the belt
// (`session-gate.js › feedInbound`, driven), and the goal delivery (`session-seed.js ›
// takeFraming`, driven through the real prompt-framing module).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");

const ENGINE = read("session-engine.js");
const GATE = read("session-gate.js");

// ── 1. THE STAMP: only a parked shell starts undirected ──────────────────────────────────────

test("STAMP: `awaitingDirective` is the parked-shell flag, and it is `=== true` only", () => {
  assert.match(ENGINE, /awaitingDirective: spec\.parkedShell === true,/,
    "a truthy spec value must not be able to park an ordinary launch");
  // ⚠ NOT AN OVERLOAD OF `freshFraming`, and the two are asserted apart because they look alike:
  // that one is a ONE-SHOT marker about whether a TURN carries the full framing, consumed by the
  // first turn built; this is read on EVERY message and answers whether anything may reach the
  // agent at all. Collapsing them would clear the wake flag the moment a turn was framed.
  assert.match(ENGINE, /freshFraming: spec\.parkedShell === true && !spec\.resumeSdkId,/,
    "the framing marker keeps its own condition");
  assert.notEqual(ENGINE.indexOf("awaitingDirective"), ENGINE.indexOf("freshFraming"),
    "two fields, not one");
});

// ── 2. THE CLEAR: one funnel, both wake lanes ────────────────────────────────────────────────

test("CLEAR: both wake lanes clear the flag at the ONE dispatch funnel", () => {
  // ⚠ AT `dispatch`, NOT AT EITHER GATE. `steer` (the operator's own 1:1 message, via
  // `session-reopen.js › messageByTask`) never passes through `session-dispatch.js` at all, and
  // `inbound_arrived` only reaches the reducer for a message that named this agent. Clearing at
  // the funnel is what makes "woken" mean the same thing on both.
  assert.match(ENGINE,
    /if \(event && \(event\.type === 'steer' \|\| event\.type === 'inbound_arrived'\)\) s\.awaitingDirective = false;/);
  const at = ENGINE.indexOf("s.awaitingDirective = false;");
  const reduce = ENGINE.indexOf("const { state, effects } = sessionReducer(s.state, event);");
  assert.ok(at !== -1 && reduce !== -1 && at < reduce,
    "cleared before the reducer runs, so the waking turn's own effects see a woken session");
});

test("CLEAR: `steer` really is a wake trigger for a parked session (the 1:1 lane)", () => {
  // The ruling says "1:1 messageAgent (already works via steer — verify)". Driven through the
  // REAL reducer rather than asserted from source: `wakeEffects` is what starts the query.
  const { loadReducer } = require("./_reducer-block.mjs");
  const { sessionReducer, initialSessionState } = loadReducer();
  const parked = { ...initialSessionState({}), phase: "parked", parked: true, activity: "parked" };
  const out = sessionReducer(parked, { type: "steer", text: "go", priority: "next" });
  assert.ok(out.effects.some((e) => e.type === "resumeQuery"), "a steer resumes a parked session");
  assert.ok(out.effects.some((e) => e.type === "pushTurn"), "…and pushes the operator's words");
  assert.equal(out.state.parked, false);
});

// ── 3. THE BELT: session-gate refuses the same message again ─────────────────────────────────

/** `feedInbound`, sliced from the shipped gate and driven against a fake registry. */
function gate(session) {
  // ⚠ `autoInbound` IS SLICED WITH IT. `enqueue` calls it to decide hold-vs-dispatch, so a slice
  // that started at `enqueue` would evaluate to a ReferenceError — and stubbing it would test a
  // hold rule this file does not ship.
  const body = GATE.slice(GATE.indexOf("function autoInbound(s) {"), GATE.indexOf("// ⚠ THE SURFACING HALF IS DELETED"))
    + GATE.slice(GATE.indexOf("function enqueue(s, a) {"), GATE.indexOf("// ⚠ FOUR MORE WENT IN THE SAME SWEEP"));
  const queued = [];
  const dispatched = [];
  const sessions = new Map([["k", session]]);
  const api = new Function(
    "deps", "store", "io", "crypto",
    `${body}\n return { feedInbound };`
  )(
    { sessions, dispatch: (s, ev) => dispatched.push(ev) },
    { slotKey: () => "k" },
    {
      queueInbound: (s, item, held) => { queued.push(item); return held ? "queued" : "dispatch"; },
      noteGatedBody: () => {},
    },
    { randomUUID: () => "pending-1" }
  );
  return { ...api, queued, dispatched };
}

const live = () => ({ settled: false, state: { messageMode: "auto_inbound" } });
const undirected = () => ({ ...live(), awaitingDirective: true });

test("BELT: the gate refuses an unaddressed message for an undirected agent", () => {
  const g = gate(undirected());
  assert.equal(g.feedInbound({ message: "hello everyone", addressing: null }), false);
  assert.equal(g.dispatched.length, 0, "nothing was fed");
  // ⚠ AND NOTHING WAS RECORDED EITHER. A refusal here must look like a full queue, not like a
  // GATED message: `io.noteGatedBody` would drop the body out of any later seed, which is the
  // AUDIT D2 failure (a message invisible to the agent forever) reached from a new direction.
  assert.equal(g.queued.length, 0);
});

test("BELT: an addressed message passes the belt and is dispatched", () => {
  const g = gate(undirected());
  assert.equal(g.feedInbound({ message: "@abc12def go", addressing: { me: true, ids: ["abc12def"] } }), true);
  assert.equal(g.dispatched.length, 1);
  assert.equal(g.dispatched[0].type, "inbound_arrived");
});

test("BELT: a WOKEN session is untouched by it — the belt is per-session and `=== true`", () => {
  for (const flag of [undefined, false, null, "true", 1]) {
    const g = gate({ ...live(), awaitingDirective: flag });
    assert.equal(g.feedInbound({ message: "anything", addressing: null }), true, JSON.stringify(flag));
  }
});

test("BELT: somebody else's addressee is not a directive", () => {
  const g = gate(undirected());
  assert.equal(g.feedInbound({ message: "@z9y8x7w6 go", addressing: { me: false, ids: ["z9y8x7w6"] } }), false);
});

test("BELT: it is a SECOND fence, not the only one", () => {
  // The primary gate is `session-dispatch.js › mayFeed` (driven in that file's truth table). Both
  // exist because this function is the ENTRY POINT the engine exports, so a second caller must not
  // be able to wake an agent by saying nothing to it.
  assert.match(GATE, /s\.awaitingDirective === true && !\(a\.addressing && a\.addressing\.me === true\)/);
  assert.match(read("session-dispatch.js"), /function mayFeed\(s, addressing\)/);
});

// ── 4. THE LAUNCH GOAL REACHES THE WAKE TURN ─────────────────────────────────────────────────

const seed = require(join(MAIN, "session-seed.js"));

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
const TASK = "cccccccc-3333-4ddd-8eee-ffffffffffff";
const GOAL = 'Join the thread "Q3 report" as my agent: read it with dopl_channel and carry the work forward.';

const woken = (over = {}) => ({
  side: "requester",
  bind: "pair",
  nonce: "n1",
  freshFraming: true,
  launchGoal: GOAL,
  pendingHistory: null,
  context: { channelName: "Ops", channelId: CH, workspaceId: WS, taskId: TASK, scope: "thread" },
  ...over,
});

test("GOAL: the wake turn fences the operator's launch goal as its request body", () => {
  const s = woken();
  const turn = seed.withSeed(s, "Alice replied in the channel.");
  assert.ok(turn.includes(GOAL), "the goal reaches the agent at all — it used to reach nobody");
  // INSIDE the fence, not above it: the goal interpolates a renderer-supplied thread title, so it
  // is not fully trusted text and may not sit in the trusted preamble.
  // ⚠ THE FENCE IS A WHOLE LINE, and it must be found as one: the SECURITY paragraph NAMES both
  // tokens in prose above it, so a bare `indexOf` finds the sentence rather than the delimiter.
  const lines = turn.split("\n");
  const begin = lines.findIndex((l) => l.trim() === "BEGIN-REQUEST-n1");
  const end = lines.findIndex((l) => l.trim() === "END-REQUEST-n1");
  const at = lines.findIndex((l) => l.includes(GOAL));
  assert.ok(begin !== -1 && end > begin, "the turn is fenced");
  assert.ok(at > begin && at < end, "and the goal is DATA inside it");
  // …and the framing around it is the full first-turn framing, which is what `freshFraming` buys.
  assert.match(turn, /You are a Dopl agent DRIVING a thread/);
  assert.match(turn, /The GOAL is delimited below/);
});

test("GOAL: the EMPTY FENCE is the regression — a goal-less shell still frames correctly", () => {
  // What shipped before the fix, for every spawn-idle wake: framing, BEGIN, nothing, END.
  const turn = seed.withSeed(woken({ launchGoal: "" }), "x");
  const lines = turn.split("\n");
  const begin = lines.findIndex((l) => l.trim() === "BEGIN-REQUEST-n1");
  const end = lines.findIndex((l) => l.trim() === "END-REQUEST-n1");
  assert.equal(lines.slice(begin + 1, end).join("").trim(), "", "the shape the bug produced");
  assert.match(turn, /You are a Dopl agent DRIVING a thread/, "…and it is still a well-formed turn");
});

test("GOAL: a real channel TRANSCRIPT still wins over the synthesized goal", () => {
  // They are never both present in practice (a spawn-idle session has no `pendingHistory`), and
  // the order states the rule if they ever are: real thread content beats a launch instruction.
  const s = woken({ pendingHistory: [{ from: "Alice", lane: "them", text: "here is the invoice" }] });
  const turn = seed.withSeed(s, "x");
  assert.ok(turn.includes("Alice: here is the invoice"));
  assert.ok(!turn.includes(GOAL), "the goal stands down for real content");
});

test("GOAL: it is ONE-SHOT — the second turn carries neither framing nor goal", () => {
  const s = woken();
  seed.withSeed(s, "first");
  assert.equal(s.freshFraming, false, "the marker is consumed");
  const second = seed.withSeed(s, "second");
  assert.equal(second, "second", "a later turn passes straight through");
});

test("GOAL: the engine stamps it only where it can be read", () => {
  // ⚠ A NON-PARKED SPAWN ALREADY PUSHED `firstTurn` AT `startQuery`, so stamping the goal there
  // too would put the same text in the prompt twice.
  assert.match(ENGINE,
    /launchGoal: spec\.parkedShell === true \? String\(spec\.firstMessage == null \? '' : spec\.firstMessage\) : '',/);
  assert.match(ENGINE, /const firstTurn = spec\.parkedShell \? ''/,
    "`firstTurn` stays empty for a parked shell — `startQuery` is its only pusher and it never runs");
});
