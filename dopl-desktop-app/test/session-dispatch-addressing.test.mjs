// THE 2026-09-18 ADDRESSING WAVE'S DELIVERY TABLE — `main/session-dispatch.js`, the same sliced
// `SESSION-DISPATCH-PURE` block `session-dispatch.test.mjs` and `wake-routing.test.mjs` drive.
//
// ⚠ ITS OWN FILE at the 500-line `test/**` cap, on `wake-routing.test.mjs`'s precedent and with
// the same discipline: ONE route under three tables, through ONE shared harness
// (`_wake-dispatch-harness.mjs`), rather than three harnesses drifting apart. The seam is the
// RULING: that file is the standing delivery table, this one is what Samuel's addressing ruling
// changed about it.
//
// THREE CLAIMS, AND EACH IS A DIFFERENT FAILURE IF IT SLIPS:
//   1. an UNADDRESSED agent post feeds NOBODY — the wake-all report itself, pinned as an absence;
//   2. a verdict may name SEVERAL agents, and each is fed and woken exactly ONCE;
//   3. the OLD-SERVER row still fans out — ruling 4, kept whole, asserted here so the narrowing
//      above cannot be mistaken for a change to it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, agent, idle, entry, peerMsg, verdictMsg, ME, PEER, A1, A2 } from "./_wake-dispatch-harness.mjs";

const both = () => [agent(A1), agent(A2)];
const fedIds = (h) => h.calls.feedInbound.map((c) => c.agentId);

test("verdict `reciprocal`: an UNADDRESSED agent post feeds NOBODY, N siblings included", () => {
  // 🔒 **THE WAKE-ALL BUG, PINNED AS ITS ABSENCE** (2026-09-18, Samuel's report: *"when one
  // agent posts to a channel it wakes up all the other agents … they just end up saying, oh
  // this was not addressed for me"*). RR2 repairs an unaddressed agent post's address to the
  // OPERATOR, and `reciprocal` naming this operator used to make `context` true — which, on a
  // MAIN-ROOM post, is every main-room session in the channel, one full model turn each.
  // ⚠ FOUR SIBLINGS, NOT TWO: the cost this closes is linear in the room, and a two-agent
  // fixture makes a fan-out look like a pair.
  const siblings = [agent(A1), agent(A2), agent("c3d4e5f6"), agent("d4e5f6g7")];
  for (const who of [ME, PEER]) {
    const h = harness({ agents: siblings.map((s) => ({ ...s })) });
    const m = verdictMsg("reciprocal", {
      authorKind: "agent",
      authorUserId: ME,
      recipientUserIds: [who],
      body: "done with the migration pass",
    });
    assert.equal(h.feedLiveSession(entry, m, ME), false, `reciprocal -> ${who}`);
    assert.deepEqual(fedIds(h), [], `reciprocal -> ${who}: nobody hears it`);
    assert.deepEqual(h.calls.acks, [], "nothing was aimed here, so nothing was refused or held");
  }
});

test("a verdict may name SEVERAL agents, and each is fed and woken exactly once", () => {
  // ⚠ **THE MULTI-RECIPIENT RULING** (Samuel, 2026-09-18): *"agents might need to respond to
  // multiple agents, not necessarily to only one agent."* `recipient_agent_ids` was always a
  // column of ids; what is asserted here is that naming two of them feeds two and no more —
  // the third sibling is the mutation that matters.
  const h = harness({ agents: [idle(A1), idle(A2), agent("c3d4e5f6")] });
  const m = verdictMsg("agent", {
    recipientAgentIds: [A1, A2],
    recipientUserIds: [ME],
    body: "both of you, please reconcile",
  });
  assert.equal(h.feedLiveSession(entry, m, ME), true);
  assert.deepEqual(fedIds(h), [A1, A2], "🔒 the third session is not fed");
  assert.deepEqual(h.calls.feedInbound.map((c) => c.wake), [true, true], "one wake each");
  assert.deepEqual(h.calls.feedInbound[0].addressing, { me: true, ids: [A1, A2] });
  assert.deepEqual(h.calls.feedInbound[1].addressing, { me: true, ids: [A1, A2] });
});

test("an OLD-SERVER row (no verdict at all) still fans out — ruling 4, kept whole", () => {
  // ⚠ **THE STALE-PAYLOAD LANE, ASSERTED EXPLICITLY** so the narrowing above cannot be mistaken
  // for a change to it. `storedVerdict` answers `''` for a row a pre-`20260912120000` server
  // wrote, and the honest reading of such a row is still 2026-08-21's: everybody on the thread
  // hears it, and `mayWake` is what stops a peer's agent starting anything.
  const h = harness({ agents: both() });
  assert.equal(h.feedLiveSession(entry, peerMsg({ body: "anyone about?" }), ME), true);
  assert.deepEqual(fedIds(h), [A1, A2], "the old server's answer is the fan-out");
  assert.deepEqual(h.calls.feedInbound.map((c) => c.wake), [false, false]);

  // ⚠ AND A ROW WHOSE VERDICT THIS BUILD DOES NOT KNOW takes the same lane, deliberately: a
  // newer server may add a word, and an installed desktop must degrade to today rather than to
  // silence.
  const unknown = harness({ agents: both() });
  assert.equal(unknown.feedLiveSession(entry, peerMsg({ wakeVerdict: "some_new_word" }), ME), true);
  assert.deepEqual(fedIds(unknown), [A1, A2]);
});
