// THE ESCALATION-ANSWER DOOR — the THIRD way a message can address an agent
// (Samuel, 2026-08-31), in `main/session-dispatch.js`.
//
// ⚠ WHAT IT IS. A human pressing an option on an ESCALATION CARD posts an ordinary
// `kind: 'message'` row carrying reserved, server-stamped `metadata.escalationAnswer`. The agent
// that ASKED the question is the one that must be told, and it may by then be DORMANT — so the
// answer has to count as ADDRESSING it, exactly as `@agent-<id>` does.
//
// ⚠ WHY NOT JUST WRITE `@agent-<id>` IN THE BODY, which is the obvious question. The raw agent id
// is never user-visible chrome (INVARIANTS §11), and a PEER's machine cannot know the asking
// agent's local display NAME — so the body token is the only form available to them and it is the
// forbidden one. The metadata key is also strictly LESS forgeable: the body doors read text any
// member can type, while this key is stripped from caller input unconditionally and re-stamped
// server-side only after the caller is proved to be a member that escalation asked, with the agent
// id DERIVED from the escalation's own post stamp.
//
// ⚠ THE PROPERTY THAT MATTERS MOST IS AN ABSENCE: **THE LOOP FENCE IS UNCHANGED.** This is a door
// onto ADDRESSING, not a hole in it — the fence is asked of the MESSAGE, so an agent-authored row
// carrying the key still wakes nothing at all.
//
// ⚠ **AND IT IS THE ONE DOOR THE SERVER DELIBERATELY DOES NOT RESOLVE** (2026-09-02, B1).
// `escalationAnswer.agentId` names the agent that ASKED, which belongs to whoever posted the
// escalation — usually not the author — so `service-wake-verdict.ts` would have to answer `[]` for
// it, and `[]` is authoritative. The union happens on the machine, which is the only place the
// thread's live ids are known.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  harness, agent, idle, entry, peerMsg, ME, PEER, TASK, A1, A2,
} from "./_wake-dispatch-harness.mjs";

/** An answer naming one agent, as the server stamps it. */
const answer = (agentId, over = {}) =>
  peerMsg({
    body: "Ship now",
    metadata: { escalationAnswer: { escalationMessageId: "m-esc", optionIndex: 0, agentId } },
    ...over,
  });

test("DOOR: an escalation answer addresses the agent that asked", () => {
  const h = harness({ agents: [agent(A1), agent(A2)] });
  assert.deepEqual(h.escalationAnswerAgentIds(answer(A1), [A1, A2]), [A1]);
});

test("FENCE: it is intersected with the LIVE roster, like the other two doors", () => {
  // An answer naming an agent that is not on this thread reaches for nothing.
  const h = harness({ agents: [agent(A1)] });
  assert.deepEqual(h.escalationAnswerAgentIds(answer("zzzzzzzz"), [A1]), []);
});

test("FENCE: no roster, no door — an empty live list contributes nothing", () => {
  const h = harness({ agents: [] });
  assert.deepEqual(h.escalationAnswerAgentIds(answer(A1), []), []);
});

test("FENCE: a malformed or missing key contributes nothing, never a throw", () => {
  const h = harness({ agents: [agent(A1)] });
  for (const meta of [
    undefined,
    null,
    {},
    { escalationAnswer: null },
    { escalationAnswer: "nope" },
    { escalationAnswer: {} },
    { escalationAnswer: { agentId: "" } },
    { escalationAnswer: { agentId: 42 } },
  ]) {
    assert.deepEqual(
      h.escalationAnswerAgentIds(peerMsg({ metadata: meta }), [A1]),
      [],
      `metadata ${JSON.stringify(meta)} must address nobody`
    );
  }
});

test("ROUTE: the answer WAKES the dormant agent that asked", async () => {
  // ⚠ THE WHOLE FEATURE. Without this door the asking agent — parked while it waited for a
  // human — is not woken by the answer it was waiting for, and the operator's click reaches it
  // only when they next type something.
  //
  // ⚠ TWO AGENTS, NOT ONE, AND THAT IS THE DIFFERENCE BETWEEN A PIN AND A VACUOUS CASE — it was
  // the deleted solo tier that made a one-agent fixture vacuous here, and the DEGRADE case below
  // is what keeps the comparison honest now.
  const h = harness({ agents: [idle(A1), idle(A2)] });
  h.feedLiveSession(entry, answer(A1), ME);
  assert.equal(h.calls.feedInbound.length, 1, "the asking agent was fed");
  assert.equal(h.calls.feedInbound[0].agentId, A1);
});

test("ROUTE: it addresses ONLY the agent it names — a sibling is not woken", async () => {
  const h = harness({ agents: [idle(A1), idle(A2)] });
  await h.feedLiveSession(entry, answer(A1), ME);
  const woken = h.calls.feedInbound.map((c) => c.agentId);
  assert.ok(woken.includes(A1), "the asking agent was fed");
  assert.ok(!woken.includes(A2), "a sibling agent was not woken by somebody else's answer");
});

test("FENCE: THE LOOP FENCE IS UNCHANGED — an AGENT-authored answer wakes nothing", async () => {
  // ⚠ This is the assertion that would go red if the door were added to `wakeEligibility` instead
  // of to the addressing derivation. An agent cannot answer an escalation (the server refuses it),
  // but the fence must not depend on that being true somewhere else.
  const h = harness({ agents: [idle(A1)] });
  await h.feedLiveSession(
    entry,
    answer(A1, { authorKind: "agent", authorUserId: PEER }),
    ME
  );
  assert.equal(h.calls.feedInbound.length, 0, "an agent-authored answer woke a dormant agent");
});

test("FENCE: a lifecycle kind carrying the key still wakes nothing", async () => {
  const h = harness({ agents: [idle(A1)] });
  await h.feedLiveSession(entry, answer(A1, { kind: "task_progress" }), ME);
  assert.equal(h.calls.feedInbound.length, 0);
});

test("ORDER: an explicit @-mention still sorts ahead of the answer's id", () => {
  // `out` is the addressee list and downstream readers (the framing, `firstClaim`) read its ORDER.
  const h = harness({ agents: [agent(A1), agent(A2)] });
  const ids = h.mentionedAgentIds(`@agent-${A2} take a look`, [A1, A2], null);
  assert.deepEqual(ids, [A2], "the body door answers on its own");
});

test("DEGRADE: an ordinary post with no key wakes nobody — the door is the only difference", () => {
  // ⚠ **REPOINTED 2026-09-02 (ruling B6).** This asserted `length === 1`, because TIER 2 (the
  // solo room) woke the one agent in a channel on EVERY human message. That heuristic is deleted
  // — `wake_verdict: "responder"` answers it on the row now — so the comparison this case exists
  // to make is sharper than it was: with the key, the asking agent wakes; without it, nothing
  // does, and the door is the whole of the difference.
  const h = harness({ agents: [idle(A1)] });
  h.feedLiveSession(entry, peerMsg({ body: "just talking" }), ME);
  assert.equal(h.calls.feedInbound.length, 0);
});

// ── THE OUTBOUND LANE FOR THE DECISION CARD ITSELF ───────────────────────────
//
// ⚠ `escalate` IS `send(kind="decision")` SINCE 2026-09-02 (F-578). The lane, its argument and
// its own gate-diag ALLOW code are unchanged; only the spelling moved.
const ESCALATE = { op: "send", kind: "decision" };

// ── (the original section header) ────────────────────────────────────────────
//
// ⚠ SEPARATE FROM THE ANSWER DOOR ABOVE, and the two are opposite directions of one feature: the
// door lets an ANSWER reach the asking agent, and this lets the QUESTION leave the machine at all.
//
// ⚠ WHAT LEAVING IT OFF WOULD HAVE COST is F-320/F-321's defect class twice over. Unclassified,
// `escalate` falls to the AXIS-A gate and a windowless session answers a gate with `deny`; and a
// gated one that did not take the OUTBOUND payload would raise the dock's `permission_request`,
// which `claimGate` also denies outright. Either way the op whose whole purpose is to reach a
// human would be auto-refused with "this session has no surface to show one on".

import { createRequire } from "node:module";
import path from "node:path";

const req = createRequire(import.meta.url);
const M = (f) => path.join(import.meta.dirname, "..", "main", f);
const profiles = req(M("session-profiles.js"));
const outboundTag = req(M("session-outbound-tag.js"));
const { DOPL_CHANNEL_TOOL } = req(M("tool-profiles.js"));

const CH = "ch1";

test("LANE: an own-channel escalate is on the OUTBOUND half", () => {
  // ⚠ A SHAPE OF `send`, NOT AN OP (2026-09-02, F-578): the collapse folded `escalate` into
  // `send(kind="decision")`, and the constant is the KIND that tells it from a milestone.
  assert.equal(profiles.OWN_CHANNEL_ESCALATE_KIND, "decision");
  assert.ok(profiles.isOwnChannelEscalate(ESCALATE, CH));
  assert.ok(profiles.isOwnChannelOutbound(ESCALATE, CH));
  assert.ok(profiles.OWN_CHANNEL_OUTBOUND_OPS.includes("send"));
  // …and an ordinary message is NOT one: the kind is half the predicate.
  assert.ok(!profiles.isOwnChannelEscalate({ op: "send" }, CH));
});

test("LANE: it is admitted under auto_outbound and GATES under ask", () => {
  const decide = (messageMode) => profiles.grantDecision({
    profile: "full", channelId: CH, toolName: DOPL_CHANNEL_TOOL,
    input: { ...ESCALATE, channel: CH }, messageMode,
  });
  assert.equal(decide("auto_both"), "allow");
  assert.equal(decide("auto_outbound"), "allow");
  assert.equal(decide("ask"), "gate");
  assert.equal(decide("auto_inbound"), "gate");
});

test("FENCE: a SLUG is another channel and gates, like every own-channel predicate", () => {
  assert.equal(profiles.isOwnChannelEscalate({ ...ESCALATE, channel: "general" }, CH), false);
  assert.equal(
    profiles.grantDecision({
      profile: "full", channelId: CH, toolName: DOPL_CHANNEL_TOOL,
      input: { ...ESCALATE, channel: "general" }, messageMode: "auto_both",
    }),
    "gate"
  );
});

test("BRIDGE: a gated escalate takes the OUTBOUND payload, not the dock's request", () => {
  // ⚠ On a windowless session this IS the difference between the operator being shown the
  // question and the agent being told there is no surface to show one on.
  assert.ok(outboundTag.outboundConsentShape(DOPL_CHANNEL_TOOL, ESCALATE, CH));
  assert.ok(!outboundTag.outboundConsentShape(DOPL_CHANNEL_TOOL, { ...ESCALATE, channel: "general" }, CH));
  assert.ok(!outboundTag.outboundConsentShape("Bash", ESCALATE, CH));
});

test("ALLOW CODE: it says which allow this was, not just that it was one", () => {
  const d = profiles.grantDecisionDetail({
    profile: "full", channelId: CH, toolName: DOPL_CHANNEL_TOOL,
    input: { ...ESCALATE, channel: CH }, messageMode: "auto_both",
  });
  assert.equal(d.reason, "auto-outbound-escalate");
});

test("FENCE: `escalationAnswer` IS NOT on the lane — an agent may not answer a human's question", () => {
  // ⚠ THE POINT OF THE WHOLE CARD. It rides an ordinary `post` and hits that gate like any other.
  assert.ok(!profiles.OWN_CHANNEL_OUTBOUND_OPS.includes("escalationAnswer"));
  assert.equal(profiles.isOwnChannelEscalate({ op: "escalationAnswer" }, CH), false);
});
