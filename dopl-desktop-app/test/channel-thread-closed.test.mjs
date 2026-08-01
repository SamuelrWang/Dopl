// A CLOSED THREAD STILL ROUTED, AND STILL WOKE SESSIONS (adversarial review of F1-F7).
//
// WHAT THE PRODUCT PROMISES. Closing a thread is described to every agent, in the MCP tool's own
// copy, as the thing that ENDS it: closing stops the thread routing, and no session is woken by
// it afterwards. Nothing on the desktop implemented that sentence. The thread lane is
// channel-agents.routeThread -> channel-threads.fetchParticipants, which read
// GET /api/channels/<id>/tasks/<threadId> and consumed ONLY `task.participants`. `task.status`
// was never looked at, so a closed thread kept feeding every participating agent — and F1 had
// just put the MILESTONE STREAM on that same lane, so closing the room a pair of agents were
// working in did not quiet it at all. It made it louder.
//
// THE FIX, and where it lives. `threadIsClosed` is checked inside the one AUTHENTICATED read, so
// the verdict is cached, single-flighted and backed off with everything else on the message path
// (F-072), and it answers with the ESTABLISHED sentinel: `null`, which routeThread has always
// treated as "route nobody". No lane changes shape; one lane goes quiet.
//
// WHAT IS PINNED HERE:
//   THE LANE GOES QUIET   an unaddressed, thread-tagged post in a CLOSED thread reaches nobody
//                         and wakes nothing — against a CONTROL that is identical but 'open'.
//   THE ADDRESSED LANE    is UNCHANGED. `to_agent_ids` still reaches the agent it names inside a
//                         closed thread: an explicit address is an explicit ask, and that lane
//                         never asks who is in a thread. This is a DECISION, pinned so it cannot
//                         be changed by accident in either direction.
//   LEGACY SERVERS        a task with no `status` field at all is what a server predating the
//                         column sends. It is not a guess to act on, so nothing about it moves.
//   THE CACHE, BOTH WAYS  a close is honoured within CACHE_TTL_MS of the last good read (the
//                         accepted lag), and a CLOSED verdict expires like every other failed
//                         read, so a REOPEN recovers after FAIL_BACKOFF_MS instead of never.
//
// NOT IN SCOPE, deliberately: a post INTO a closed thread is still ACCEPTED server-side (F6).
// This stops the local WAKE and the local DELIVERY, never the write.
//
// METHOD: test/helpers/channel-agents.mjs — the REAL channel-threads / channel-roster /
// channel-deliver / channel-engagement / channel-agents blocks wired to each other, with a fake
// standing in for HTTP alone.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ME, PEER, CH, MINE, MINE2, THEIRS, THREAD,
  agent, msg, harness, entry, engagedAgo,
} from "./helpers/channel-agents.mjs";

// ── fixtures ───────────────────────────────────────────────────────────────────

const asAgent = (id) => ({ kind: "agent", agentId: id, userId: null });
const asUser = (id) => ({ kind: "user", userId: id, agentId: null });
const PARTICIPANTS = [asUser(ME), asUser(PEER), asAgent(MINE), asAgent(THEIRS)];

/** A peer AGENT's post inside the thread — the shape of every handshake turn. */
const inThread = (over = {}) => msg({
  authorKind: "agent",
  body: "schema half landed",
  ...over,
  metadata: { taskId: THREAD, author_agent_id: THEIRS, ...(over.metadata || {}) },
});

/** The same post as a MILESTONE, which is the volume F1 put on this lane. */
const milestone = (over = {}) => inThread({ kind: "task_progress", ...over });

const fedTo = (h) => h.calls.feed.map((f) => f.agentId);
const threadReads = (h) => h.calls.fetch.filter((f) => f.pathname.includes("/tasks/")).length;

/** A room with one live agent of mine in the thread, and the roster already read. */
async function room(cfg = {}) {
  const h = harness({
    roster: [agent({ status: "active" })],
    participants: PARTICIPANTS,
    live: [`${CH}:${MINE}`],
    ...cfg,
  });
  const e = entry();
  await h.reconcileChannel(e, ME);
  h.calls.summon.length = 0;
  h.calls.wake.length = 0;
  h.calls.feed.length = 0;
  h.calls.fetch.length = 0;
  return { h, e };
}

// ── 1. the lane goes quiet, and the control proves it is the STATUS ────────────

test("a CLOSED thread routes NOBODY, where the identical OPEN one feeds", async () => {
  const open = await room({ threadState: "open" });
  assert.equal(await open.h.routeAddressedAgent(open.e, inThread(), ME), "fed",
    "THE CONTROL: with status 'open' this is the ordinary thread lane");
  assert.deepEqual(fedTo(open.h), [MINE]);

  const closed = await room({ threadState: "closed" });
  assert.equal(await closed.h.routeAddressedAgent(closed.e, inThread(), ME), "");
  assert.equal(closed.h.calls.feed.length, 0, "nothing is delivered");
  assert.equal(closed.h.calls.wake.length, 0, "and no session is woken, which is the promise");
});

test("the MILESTONE stream is what this actually silences (F1 put it on this lane)", async () => {
  for (const kind of ["task_started", "task_progress", "task_finished", "task_failed"]) {
    const { h, e } = await room({ threadState: "closed" });
    assert.equal(await h.routeAddressedAgent(e, milestone({ kind }), ME), "", kind);
    assert.equal(h.calls.feed.length, 0, kind);
    assert.equal(h.calls.wake.length, 0, `${kind}: a closed room wakes nothing`);
  }
});

test("a closed thread does not wake a PARKED agent either (nothing running, nothing started)", async () => {
  const { h, e } = await room({ threadState: "closed", live: [] });
  assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "");
  assert.equal(h.calls.wake.length, 0, "the wake is the expensive half, and it does not happen");
  assert.equal(h.calls.summon.length, 0);
});

test("EVERY one of my agents in the room goes quiet, not just the first", async () => {
  const { h, e } = await room({
    roster: [agent({ status: "active" }), agent({ id: MINE2, name: "onyx", status: "active" })],
    participants: [asAgent(MINE), asAgent(MINE2), asAgent(THEIRS)],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
    threadState: "closed",
  });
  assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "");
  assert.deepEqual(fedTo(h), []);
});

test("ANY status that is not 'open' closes the lane (unknown lifecycle fails CLOSED)", async () => {
  for (const state of ["closed", "cancelled", "archived", "Closed", "expired"]) {
    const { h, e } = await room({ threadState: state });
    assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "", state);
    assert.equal(h.calls.feed.length, 0, state);
  }
});

// ── 2. THE DECISION: an explicit address still works on a closed thread ────────

test("ADDRESSED still reaches its agent inside a CLOSED thread (an address is an ask)", async () => {
  // The addressed lane resolves `to_agent_ids` against the authenticated roster and never asks
  // who is in a thread — so closing a thread cannot silence somebody deliberately naming an
  // agent. That is the intended split, and this is the pin: only the PASSIVE lane goes quiet.
  const { h, e } = await room({ threadState: "closed" });
  const named = inThread({ metadata: { to_agent_ids: [MINE], to_agent_id: MINE, to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, named, ME), "fed");
  assert.deepEqual(fedTo(h), [MINE]);
  assert.equal(threadReads(h), 0, "…and it does not even read the thread to decide that");
});

test("a MILESTONE addressed to my agent in a closed thread is delivered too", async () => {
  const { h, e } = await room({ threadState: "closed", live: [] });
  const named = milestone({ metadata: { to_agent_ids: [MINE], to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, named, ME), "fed");
  assert.deepEqual(h.calls.wake.map((w) => w.agentId), [MINE], "being named still opens the session");
});

test("the ENGAGED lane is untouched: a human's chat still reaches an engaged agent", async () => {
  // Stated because it is the one remaining way a closed thread's tag can reach an agent, and it
  // is not a hole: the engaged lane refuses every agent author and every non-'message' kind
  // (engagement.mayEngage), so no milestone and no agent-to-agent hop can take it. What is left
  // is a PERSON typing while their own agent is already in play — which is the same delivery
  // that person's untagged line in the room would get, thread tag or no thread tag.
  const engaged = agent({ status: "active", engagedAt: engagedAgo(60_000), engagedBy: PEER });
  const { h, e } = await room({ roster: [engaged], threadState: "closed" });
  const typed = msg({ authorKind: "user", authorUserId: PEER, body: "one more thing", metadata: { taskId: THREAD } });
  assert.equal(await h.routeAddressedAgent(e, typed, ME), "fed");
  assert.deepEqual(fedTo(h), [MINE]);

  // …while the same post from an AGENT in the same closed thread reaches nobody at all.
  const quiet = await room({ roster: [engaged], threadState: "closed" });
  assert.equal(await quiet.h.routeAddressedAgent(quiet.e, inThread(), ME), "");
  assert.equal(quiet.h.calls.feed.length, 0);
});

// ── 3. a server that says nothing says nothing ─────────────────────────────────

test("a task with NO status field routes exactly as it did before (legacy server)", async () => {
  const { h, e } = await room(); // cfg.threadState unset -> the field is absent from the JSON
  assert.equal(await h.routeAddressedAgent(e, inThread(), ME), "fed");
  assert.deepEqual(fedTo(h), [MINE]);
});

test("threadIsClosed: only a non-empty STRING that is not 'open' ends a thread", () => {
  const h = harness();
  for (const task of [{ status: "closed" }, { status: " closed " }, { status: "cancelled" }]) {
    assert.equal(h.threadIsClosed(task), true, JSON.stringify(task));
  }
  const openish = [{ status: "open" }, { status: " open " }, { status: "" }, { status: "   " },
    { status: null }, { status: undefined }, { status: 7 }, {}, null, undefined];
  for (const task of openish) {
    assert.equal(h.threadIsClosed(task), false, JSON.stringify(task));
  }
});

// ── 4. the cache, in both directions ──────────────────────────────────────────

test("a CLOSED verdict is cached like a failed read: it is not re-asked per message", async () => {
  const { h, e } = await room({ threadState: "closed" });
  for (let seq = 1; seq <= 6; seq++) {
    assert.equal(await h.routeAddressedAgent(e, inThread({ seq }), ME), "", `seq ${seq}`);
  }
  assert.equal(threadReads(h), 1, "six posts into a closed thread, one read");
  assert.equal(h.calls.feed.length, 0);
});

test("a REOPEN recovers after the backoff, and not before it", async () => {
  // The cost of putting the verdict in the shared cache, stated as a test: a closed thread is
  // re-read on the FAIL_BACKOFF_MS clock (30s), so reopening a room brings it back on its own.
  const cfg = { participants: PARTICIPANTS, threadState: "closed" };
  const h = harness(cfg);
  const e = entry();
  const t0 = 1_000_000;

  assert.equal(await h.participantsFor(e, THREAD, t0), null, "closed: routes nobody");
  assert.equal(threadReads(h), 1);

  cfg.threadState = "open"; // the operator reopens it, and the desktop has not looked yet
  assert.equal(await h.participantsFor(e, THREAD, t0 + h.FAIL_BACKOFF_MS - 1), null,
    "inside the backoff the remembered verdict stands");
  assert.equal(threadReads(h), 1, "…and it costs no request");

  assert.deepEqual(await h.participantsFor(e, THREAD, t0 + h.FAIL_BACKOFF_MS + 1), PARTICIPANTS,
    "past it, the room is back");
  assert.equal(threadReads(h), 2);
});

test("a CLOSE is honoured within one CACHE_TTL_MS of the last good read (the accepted lag)", async () => {
  const cfg = { participants: PARTICIPANTS, threadState: "open" };
  const h = harness(cfg);
  const e = entry();
  const t0 = 2_000_000;

  assert.deepEqual(await h.participantsFor(e, THREAD, t0), PARTICIPANTS);
  cfg.threadState = "closed"; // closed on the server, while a good set is still cached here
  assert.deepEqual(await h.participantsFor(e, THREAD, t0 + h.CACHE_TTL_MS - 1), PARTICIPANTS,
    "the documented lag: up to five minutes of stale routing, never a wrong delivery");
  assert.equal(threadReads(h), 1);

  assert.equal(await h.participantsFor(e, THREAD, t0 + h.CACHE_TTL_MS + 1), null, "then it goes quiet");
  assert.equal(threadReads(h), 2);
});

test("concurrent posts into a closed thread still JOIN one read", async () => {
  const { h, e } = await room({ threadState: "closed" });
  const all = await Promise.all([1, 2, 3, 4].map((seq) => h.routeAddressedAgent(e, inThread({ seq }), ME)));
  assert.deepEqual(all, ["", "", "", ""]);
  assert.equal(threadReads(h), 1, "single-flight per thread, unchanged");
});
