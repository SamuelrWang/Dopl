// `classify()` and the LEGACY-THREAD REGISTRY — split out of `classify.test.mjs` (§2, F-146).
//
// These cases are the one group in the classify suite that is NOT about a message's own
// fields. They turn on PROVENANCE THIS MACHINE RECORDED — a module-scope Map that classify
// writes when the operator opens a thread and reads when a reply claims one — so every case
// has to build its OWN scope (`build()`), which is exactly the seam the split was taken on.
// The shared harness is `_classify-harness.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";

import { build, makeEntry, ME, U2, U3 } from "./_classify-harness.mjs";

// ── LEGACY thread replies (incident 2026-07-31) ──────────────────────────────
// A request that arrives WITHOUT create_thread gets a deterministic legacy id
// (`task-<channel>-<seq>`) minted by the responder's desktop. That id is not a UUID,
// so it resolves to no channel_tasks row and the server stamps NONE of the task keys
// the branch above needs (service-writes-metadata.ts deletes taskMode /
// taskCreatedBy / taskTitle / taskTarget unconditionally and re-adds them only from a
// resolved task). The reply therefore carried metadata.taskId and nothing else — and
// once it did not even carry that, it read as a brand-new request and the requester
// spawned a counter-session against the answer to its own question.
//
// Provenance comes from THIS MACHINE instead: classify records the legacy id of every
// thread the operator OPENS (their own addressed message, which no peer can author),
// and only a reply tagged with one of those ids, from the member it addressed, is
// passive news. Everything else falls through to the addressed rule -> 'trigger'.
const CHAN = "chan-abcdef01"; // the id makeEntry() builds
const legacyId = (seq) => `task-${CHAN}-${seq}`;
// MY OWN outbound request at `seq`, addressed to `to` (the shape that records).
const myAsk = (seq, to = U2, over = {}) => ({
  id: "o", seq, kind: "message", body: "please do X", authorKind: "agent",
  authorUserId: ME, metadata: { to_user_id: to, ...over },
});
// The peer's reply, tagged with the legacy id of MY message at `openerSeq`.
const legacyReply = (openerSeq, over = {}) => ({
  id: "r", seq: 20, kind: "message", body: "here is the answer", authorKind: "agent",
  authorUserId: U2, metadata: { to_user_id: ME, taskId: legacyId(openerSeq), ...over },
});
const chan = () => makeEntry({ memberCount: 2, isMember: true });
// A fresh scope per test: the registry is module state, so no test may inherit another's.
const fresh = () => build().classify;

test("(legacy-a) THE INCIDENT: my ask, then the peer's legacy-tagged reply -> task-reply", () => {
  const c = fresh();
  assert.equal(c(myAsk(7), chan(), ME), "ignore", "my own message is still 'ignore' for targeting");
  // No taskMode, no taskCreatedBy, no taskTarget: exactly what the server stores for a
  // legacy id. The first-class branch cannot fire here; the local record is what does.
  assert.equal(c(legacyReply(7), chan(), ME), "task-reply");
  // Explicitly addressed, so member count / membership / mute do not change it.
  assert.equal(c(legacyReply(7), makeEntry({ memberCount: 5, isMember: false }), ME), "task-reply");
});

test("(legacy-b) a legacy tag this machine does NOT know -> trigger (unchanged)", () => {
  // Never seen at all.
  assert.equal(fresh()(legacyReply(7), chan(), ME), "trigger");
  // Known thread, WRONG seq — one id per opening message, not per channel.
  const c = fresh();
  c(myAsk(7), chan(), ME);
  assert.equal(c(legacyReply(8), chan(), ME), "trigger");
  // Known seq, WRONG channel — the id embeds the channel, so a tag minted elsewhere misses.
  const d = fresh();
  d(myAsk(7), chan(), ME);
  assert.equal(d({ ...legacyReply(7), metadata: { to_user_id: ME, taskId: "task-other-7" } }, chan(), ME), "trigger");
});

test("(legacy-c) an UNTAGGED addressed message -> trigger (unchanged), even on a known thread", () => {
  const c = fresh();
  c(myAsk(7), chan(), ME);
  const untagged = { ...legacyReply(7), metadata: { to_user_id: ME } };
  assert.equal(c(untagged, chan(), ME), "trigger");
  // An empty / non-string tag is the same as no tag.
  assert.equal(c({ ...legacyReply(7), metadata: { to_user_id: ME, taskId: "  " } }, chan(), ME), "trigger");
  assert.equal(c({ ...legacyReply(7), metadata: { to_user_id: ME, taskId: 7 } }, chan(), ME), "trigger");
});

test("(legacy-d) only the member I ADDRESSED can answer my thread", () => {
  const c = fresh();
  c(myAsk(7, U2), chan(), ME); // I addressed U2
  const fromThird = { ...legacyReply(7), authorUserId: U3 };
  assert.equal(c(fromThird, makeEntry({ memberCount: 3, isMember: true }), ME), "trigger");
});

test("(legacy-e) a HUMAN reply on a thread I opened suppresses too (widened 2026-08-20)", () => {
  // The AGENT-ONLY conjunct existed for the session window's inbound Accept; with window
  // mode retired there is nothing to claim the reply, and 'trigger' meant a consent card
  // against the requester's own thread. The kind guard still wins.
  const c = fresh();
  c(myAsk(7), chan(), ME);
  assert.equal(c({ ...legacyReply(7), authorKind: "user" }, chan(), ME), "task-reply");
  assert.equal(c({ ...legacyReply(7), authorKind: "system" }, chan(), ME), "ignore"); // guard wins
});

// What DOES and does not open a thread this machine will trust (the recorder's own
// rules), plus the cap and the operator binding, live in legacy-thread-reply.test.mjs.

test("(legacy-f) the kind guard still wins over a known legacy thread", () => {
  const c = fresh();
  c(myAsk(7), chan(), ME);
  assert.equal(c({ ...legacyReply(7), kind: "task_finished" }, chan(), ME), "ignore");
});


// The CHANNELS ROLLBACK's own regressions — the two D2 rules `classify` lost, pinned as
// absences — live in `classify-rollback.test.mjs`. Split off at the §2 500-line cap rather
// than trimmed: they are about a behaviour CHANGE where everything above is about the
// standing truth table, which is a real reason to change and not arithmetic.
