// F1 — EVERY IN-THREAD AGENT UPDATE WAS SILENTLY UNDELIVERABLE (incident 2026-08-01).
//
// WHAT HAPPENED. `routeAddressedAgent` opened with `if (!m || m.kind !== 'message') return ''`,
// in FRONT of the addressed lane, the thread lane and the engaged lane. Meanwhile the MCP tool
// description (`channel-description.ts`) and this app's own spawn prompt
// (`prompt-framing.milestoneGuidance`) both tell every agent to log its progress as
// `kind="task_progress"`. So the product asked for a kind the product then refused to deliver:
// across seq 340-368 of the two-agent run, EVERY undelivered message was a task_* and EVERY
// delivered one was a 'message', with no counterexample in either direction. Nine posts queued
// for the other agent — three of them carrying `metadata.to_agent_ids` — started nothing, and
// both agents concluded the transport was broken.
//
// WHY A GREEN SUITE MISSED IT, which is the reusable half: every existing fixture in this tree
// builds `kind: "message"` (helpers/channel-agents.mjs `msg`), so 1780 passing tests said
// nothing at all about the one field the router was gating on. THIS FILE CONSTRUCTS task_*
// KINDS ON PURPOSE, and that is the whole reason it exists as its own file.
//
// WHAT IS PINNED HERE:
//   ADDRESSED   a task_* naming one of my agents is DELIVERED — the F1 headline.
//   IN THREAD   a task_* inside a room my agent participates in is DELIVERED.
//   CHATTER     a task_* that names nobody and is in no thread of mine reaches NOBODY, even
//               with an ENGAGED agent sitting right there — and the control proves the room
//               would have fed a 'message' of the same shape, so the refusal is about kind.
//   SELF        an agent's OWN lifecycle post never echoes back into its own session, in the
//               main room (`myOwnAgentSpoke`) or inside a thread (`channel-deliver.selfEcho`),
//               attributed or not.
//   BRAKES      a milestone is never gate-bypassed (`selfAuthored`) and never slides the
//               engagement window (`noteAgentActed`) — the auto-posture bound is unchanged.
//   UNCHANGED   'message' takes all three lanes exactly as before, and 'system' (or a kind
//               from a build this one does not know) still routes nobody.
//
// METHOD: test/helpers/channel-agents.mjs, the same wiring the other three routing suites use
// — the REAL channel-agents / channel-deliver / channel-roster / channel-engagement /
// channel-threads blocks, with fakes only at HTTP and the session engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ME, PEER, CH, MINE, MINE2, THEIRS, THREAD,
  agent, entry, msg, harness, routed, engagedAgo,
} from "./helpers/channel-agents.mjs";

// ── fixtures ───────────────────────────────────────────────────────────────────

/** The four postable milestone kinds, restated from the server's own enum (schema.ts
 *  PostableMessageKindSchema / channel-schema.ts `kind`). A kind that is in the product's
 *  vocabulary and not in this list is a routing hole, which is exactly what F1 was. */
const MILESTONES = ["task_started", "task_progress", "task_finished", "task_failed"];

/** A PEER AGENT's milestone — the shape the tool description asks every agent to post. */
const peerMilestone = (over = {}) => msg({
  kind: "task_progress",
  authorKind: "agent",
  body: "schema half landed",
  ...over,
  metadata: { author_agent_id: THEIRS, ...(over.metadata || {}) },
});

/** ONE of my agents' own milestone: my account, agent-authored, `as_agent` stamped. */
const myMilestone = (over = {}) => msg({
  kind: "task_started",
  authorKind: "agent",
  authorUserId: ME,
  body: "picking this up",
  ...over,
  metadata: { author_agent_id: MINE, ...(over.metadata || {}) },
});

const asAgent = (id) => ({ kind: "agent", agentId: id, userId: null });
const asUser = (id) => ({ kind: "user", userId: id, agentId: null });
const fedTo = (h) => h.calls.feed.map((f) => f.agentId);

/** A breakout room holding two agents of mine and one of the peer's, all live. */
async function room(over = {}) {
  const h = harness({
    roster: [
      agent({ status: "active" }),
      agent({ id: MINE2, name: "onyx", status: "active" }),
      agent({ id: THEIRS, ownerUserId: PEER, name: "slate", status: "active" }),
    ],
    participants: [asUser(ME), asUser(PEER), asAgent(MINE), asAgent(MINE2), asAgent(THEIRS)],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
    ...over,
  });
  const e = entry();
  await h.reconcileChannel(e, ME);
  h.calls.feed.length = 0;
  h.calls.wake.length = 0;
  return { h, e };
}

// ── 1. THE HEADLINE: an ADDRESSED milestone is delivered ───────────────────────

test("an ADDRESSED task_progress from a peer's agent is DELIVERED (F1)", async () => {
  // The exact undelivered shape: a peer agent logging a milestone and naming my agent on it.
  // Before the fix this returned '' before `addressedAgentIds` was ever read.
  const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const m = peerMilestone({ metadata: { to_agent_ids: [MINE], to_agent_id: MINE, to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed");
  assert.deepEqual(fedTo(h), [MINE]);
  assert.equal(h.calls.feed[0].message, "schema half landed");
  assert.equal(h.calls.feed[0].selfAuthored, false, "a milestone is never gate-bypassed");
});

test("ALL FOUR task_* kinds route; 'system' and an unknown kind still route nobody", async () => {
  // The kind gate did not disappear, it narrowed. A server-emitted kind, or one from a build
  // this one does not know, is still refused whole — so this is a differential, not a widening.
  for (const kind of MILESTONES) {
    const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
    const m = peerMilestone({ kind, metadata: { to_agent_ids: [MINE], to_user_id: ME } });
    assert.equal(await h.routeAddressedAgent(e, m, ME), "fed", kind);
    assert.deepEqual(fedTo(h), [MINE], kind);
  }
  for (const kind of ["system", "task_whatever_next", "", null, undefined]) {
    const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
    const m = peerMilestone({ kind, metadata: { to_agent_ids: [MINE], to_user_id: ME } });
    assert.equal(await h.routeAddressedAgent(e, m, ME), "", String(kind));
    assert.equal(h.calls.feed.length, 0, String(kind));
  }
});

test("an addressed milestone WAKES a parked shell, exactly as an addressed message does", async () => {
  const { h, e } = await routed({ roster: [agent({ status: "active" })] }); // active, nothing running
  const m = peerMilestone({ metadata: { to_agent_ids: [MINE], to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed");
  assert.deepEqual(h.calls.wake.map((w) => w.agentId), [MINE], "being named is what opens the session");
  assert.equal(h.calls.summon.length, 0, "and the room is not greeted again to do it");
});

test("a milestone naming an agent that is NOT mine falls through, as a message would", async () => {
  const { h, e } = await routed({ roster: [agent(), agent({ id: THEIRS, ownerUserId: PEER, name: "slate" })] });
  const m = peerMilestone({ metadata: { to_agent_ids: [THEIRS], to_user_id: PEER } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "");
  assert.equal(h.calls.feed.length, 0);
  assert.equal(h.calls.wake.length, 0, "a peer cannot start a session here with a milestone either");
});

// ── 2. THE THREAD LANE carries milestones too ──────────────────────────────────

test("a THREAD-ROUTED task_progress reaches every one of my participating agents", async () => {
  // No addressing anywhere on the post — THE LAW's "inside a thread everyone in it hears
  // everything" applied to the milestone stream, which is what the thread lane is for.
  const { h, e } = await room();
  const m = peerMilestone({ metadata: { taskId: THREAD } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed");
  assert.deepEqual(fedTo(h).sort(), [MINE, MINE2].sort());
  assert.ok(h.calls.feed.every((f) => f.selfAuthored === false), "and every one of them stays gated");
});

test("a LEGACY task-<channel>-<seq> tag selects no lane for a milestone either", async () => {
  // targeting.firstClassTaskId is UUID-gated: a legacy id resolves to no participant set and
  // is the one id shape a peer can set freely. Widening the kinds must not widen that.
  const { h, e } = await room();
  const m = peerMilestone({ metadata: { taskId: `task-${CH}-345` } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "");
  assert.equal(h.calls.feed.length, 0);
});

// ── 3. CHATTER: an unaddressed milestone in the main room wakes nobody ─────────

test("an UNADDRESSED milestone reaches nobody — and the CONTROL proves it is the kind", async () => {
  // "Nothing happened" is free in a room where nothing could happen, so the room is ARMED:
  // one of my agents is ENGAGED by this very author, and the identical post as a 'message'
  // must be fed. Only the DIFFERENCE is evidence about the kind.
  const engagedRow = agent({ status: "active", engagedAt: engagedAgo(60_000), engagedBy: PEER });
  const shape = { authorKind: "user", authorUserId: PEER, body: "step two is done" };

  const control = await routed({ roster: [engagedRow], live: [`${CH}:${MINE}`] });
  assert.equal(await control.h.routeAddressedAgent(control.e, msg({ ...shape }), ME), "fed",
    "THE ENGAGED LANE NEVER ARMED — the refusal below would prove nothing");
  assert.deepEqual(fedTo(control.h), [MINE]);

  for (const kind of MILESTONES) {
    const { h, e } = await routed({ roster: [engagedRow], live: [`${CH}:${MINE}`] });
    assert.equal(await h.routeAddressedAgent(e, msg({ ...shape, kind }), ME), "", kind);
    assert.equal(h.calls.feed.length, 0, `${kind}: milestone chatter must not wake an engaged agent`);
  }
});

test("an unaddressed AGENT milestone with no thread reaches nobody (the peer's noise)", async () => {
  const { h, e } = await room({ participants: undefined });
  assert.equal(await h.routeAddressedAgent(e, peerMilestone(), ME), "");
  assert.equal(h.calls.feed.length, 0);
});

// ── 4. THE SELF BRAKES, verified against the task_* path rather than assumed ────

test("my own agent's task_started addressed to my OTHER agent does not route in the main room", async () => {
  // `myOwnAgentSpoke` is the main-room brake and it reads `!humanAuthored`, which is FALSE for
  // every non-'message' kind — so it catches milestones. The CONTROL is the same post from the
  // PEER's account, which must be fed: the refusal is the SELF brake, not the kind.
  const cfg = {
    roster: [agent({ status: "active" }), agent({ id: MINE2, name: "onyx", status: "active" })],
    live: [`${CH}:${MINE}`, `${CH}:${MINE2}`],
  };
  const mine = await routed(cfg);
  const own = myMilestone({ metadata: { to_agent_ids: [MINE2], to_agent_id: MINE2, to_user_id: ME } });
  assert.equal(await mine.h.routeAddressedAgent(mine.e, own, ME), "");
  assert.equal(mine.h.calls.feed.length, 0, "one of my agents cannot drive another in the open room");

  const peer = await routed(cfg);
  const theirs = peerMilestone({
    kind: "task_started",
    metadata: { author_agent_id: THEIRS, to_agent_ids: [MINE2], to_agent_id: MINE2, to_user_id: ME },
  });
  assert.equal(await peer.h.routeAddressedAgent(peer.e, theirs, ME), "fed", "the control: a PEER's does");
  assert.deepEqual(fedTo(peer.h), [MINE2]);
});

test("inside a thread, an agent's own lifecycle post feeds its SIBLING and never itself", async () => {
  const { h, e } = await room();
  const own = myMilestone({ metadata: { taskId: THREAD } });
  assert.equal(await h.routeAddressedAgent(e, own, ME), "fed");
  assert.deepEqual(fedTo(h), [MINE2], "the other agent in the room hears it");
  assert.ok(!fedTo(h).includes(MINE), "…and the author never hears its own task_started");
});

test("an UNATTRIBUTED milestone of mine is refused for ALL of my agents", async () => {
  // A post made without `as_agent` carries no `author_agent_id`, so nothing on the wire says
  // WHICH agent wrote it — it could be either of them, and the self-echo filter answers on
  // what it knows. Losing a hop costs a resend; feeding one costs a loop with no second party.
  const { h, e } = await room();
  const unattributed = msg({
    kind: "task_finished", authorKind: "agent", authorUserId: ME, metadata: { taskId: THREAD },
  });
  assert.equal(await h.routeAddressedAgent(e, unattributed, ME), "");
  assert.equal(h.calls.feed.length, 0);
});

test("a delivered milestone does NOT slide the engagement window (only a human's post does)", async () => {
  // `noteAgentActed` is conjuncted on `humanAuthored`, so the sliding half of the window can
  // never be driven by the milestone stream — which is what keeps "60 minutes, not forever"
  // true now that agent-authored task_* traffic reaches an agent at all.
  const engagedRow = agent({ status: "active", engagedAt: engagedAgo(60_000), engagedBy: PEER });
  const { h, e } = await routed({ roster: [engagedRow], live: [`${CH}:${MINE}`] });
  const floor = Date.parse(engagedRow.engagedAt);
  const m = peerMilestone({ metadata: { to_agent_ids: [MINE], to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, m, ME), "fed");
  assert.equal(h.engagedAtFor(CH, engagedRow), floor, "the server floor, untouched by a milestone");

  const human = msg({ authorKind: "user", authorUserId: PEER, metadata: { to_agent_ids: [MINE], to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, human, ME), "fed");
  assert.ok(h.engagedAtFor(CH, engagedRow) > floor, "the control: a person's post still slides it");
});

// ── 5. 'message' IS BYTE FOR BYTE WHAT IT WAS ──────────────────────────────────

test("kind='message' still takes all three lanes, unchanged", async () => {
  // ADDRESSED, including the operator's own typed sentence (the primary flow) with its gate
  // bypass; IN THREAD; and ENGAGED. If the F1 narrowing cost any of these, it is a regression.
  const addressed = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  assert.equal(await addressed.h.routeAddressedAgent(addressed.e, msg({ metadata: { to_agent_id: MINE } }), ME), "fed");
  assert.equal(addressed.h.calls.feed[0].selfAuthored, false, "a peer's words are still gated");

  const own = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const typed = msg({ authorUserId: ME, metadata: { to_agent_ids: [MINE], to_agent_id: MINE, to_user_id: ME } });
  assert.equal(await own.h.routeAddressedAgent(own.e, typed, ME), "fed");
  assert.equal(own.h.calls.feed[0].selfAuthored, true, "…and the operator is not asked to approve their own sentence");

  const thread = await room();
  const inThread = msg({ authorKind: "agent", metadata: { taskId: THREAD, author_agent_id: THEIRS } });
  assert.equal(await thread.h.routeAddressedAgent(thread.e, inThread, ME), "fed");
  assert.deepEqual(fedTo(thread.h).sort(), [MINE, MINE2].sort());
});

test("window-mode OFF still short-circuits every kind", async () => {
  const off = harness({ windowMode: false });
  const e = entry();
  await off.reconcileChannel(e, ME);
  for (const kind of ["message", ...MILESTONES]) {
    const m = peerMilestone({ kind, metadata: { to_agent_ids: [MINE], to_user_id: ME } });
    assert.equal(await off.routeAddressedAgent(e, m, ME), "", kind);
  }
  assert.equal(off.calls.feed.length, 0);
});

test("no identity resolved: a milestone routes nowhere, the same as a message", async () => {
  const { h, e } = await routed({ roster: [agent({ status: "active" })], live: [`${CH}:${MINE}`] });
  const m = peerMilestone({ metadata: { to_agent_ids: [MINE], to_user_id: ME } });
  assert.equal(await h.routeAddressedAgent(e, m, null), "");
  assert.equal(h.calls.feed.length, 0);
});
