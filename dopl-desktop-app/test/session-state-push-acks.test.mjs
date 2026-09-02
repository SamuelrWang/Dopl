// THE WAKE ACK RIDING THE SESSION-STATE PUSH (2026-09-02, v2 wave A slice A9).
//
// ⚠ ITS OWN FILE, on `_session-state-push-harness.mjs`'s own argument: the writer's suites are
// already split by SUBJECT (what it sends / what it refuses to send) under the §2 500-line cap,
// and this is a third subject — what it carries FOR ANOTHER MODULE.
//
// ⚠ WHY THE RECEIPTS CANNOT POST THEMSELVES, which is what every case here is downstream of:
// `/api/channels/sessions` is a WHOLE-SET REPLACE, so `{ sessions: [] }` DELETES this machine's
// rows. A receipt module posting on its own would wipe the projection every time it spoke. So
// `delivery-ack.js` holds them and this writer drains them into the payload it was going to
// send anyway — one credential path, one retry policy, one thing to keep alive.

import test from "node:test";
import assert from "node:assert/strict";
import {
  armed, deliveryAck, drained, entry, CHAN_A, KEY_A,
} from "./_session-state-push-harness.mjs";

const acksOf = (m) => m.posts.map((p) => p.options.body.acks);

test.beforeEach(() => deliveryAck.reset());

test("ACK: receipts ride the payload beside the session set", async () => {
  const { m, summary } = armed();
  deliveryAck.note("ws-1", CHAN_A, 7, "woken", "user-a", KEY_A);
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.deepEqual(m.posts[0].options.body.acks, [
    { sessionKey: KEY_A, channelId: CHAN_A, seq: 7, delivery: "woken" },
  ]);
  // …and the projection is unaffected: the ack is a passenger, never a substitute.
  assert.equal(m.posts[0].options.body.sessions.length, 1);
});

test("ACK: the key is OMITTED when there is nothing to say", async () => {
  // ⚠ Every build in the field posts without it, and the server's field is optional. An empty
  // array on every push would put a field on the wire that says nothing.
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  assert.deepEqual(acksOf(m), [undefined]);
});

test("ACK: a pending receipt FORCES a push the digest gate would have skipped", async () => {
  const { m, summary } = armed();
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);

  // The same set again: the digest has not moved, so nothing would normally be sent.
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1, "an unmoved set is not pushed on its own");

  // ⚠ A receipt is NEWS, and a field an orchestrator polls must not sit behind a gate built to
  // swallow churn.
  deliveryAck.note("ws-1", CHAN_A, 9, "idle", "user-a", KEY_A);
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 2);
  assert.deepEqual(m.posts[1].options.body.acks, [
    { sessionKey: KEY_A, channelId: CHAN_A, seq: 9, delivery: "idle" },
  ]);
});

test("ACK: a workspace with receipts and NO live sessions is still pushed", async () => {
  // The empty set is the DELETE half of this endpoint and is a truthful statement here — the
  // machine really has no sessions in that workspace — so the receipt does not need a session
  // to travel with.
  const { m, summary } = armed();
  deliveryAck.note("ws-1", CHAN_A, 4, "refused", "user-a", KEY_A);
  summary.emit([]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.deepEqual(m.posts[0].options.body.sessions, []);
  assert.deepEqual(m.posts[0].options.body.acks, [
    { sessionKey: KEY_A, channelId: CHAN_A, seq: 4, delivery: "refused" },
  ]);
});

test("ACK: a failed send PUTS THEM BACK, and the next push carries them", async () => {
  // ⚠ A receipt taken and dropped is one this machine forgot it owed, and nothing ever asks
  // again. Same bargain the digest makes: not recorded, so the next real change retries.
  const { m, summary } = armed({ answers: [{ ok: false, status: 400 }] });
  deliveryAck.note("ws-1", CHAN_A, 7, "woken", "user-a", KEY_A);
  summary.emit([entry()]);
  await drained();
  assert.equal(m.posts.length, 1);
  assert.deepEqual(deliveryAck.pendingWorkspaces("user-a"), ["ws-1"]);

  m.setAnswers([{ ok: true, status: 200 }]);
  summary.emit([entry({ state: "idle" })]);
  await drained();
  const last = m.posts[m.posts.length - 1];
  assert.deepEqual(last.options.body.acks, [
    { sessionKey: KEY_A, channelId: CHAN_A, seq: 7, delivery: "woken" },
  ]);
  assert.deepEqual(deliveryAck.pendingWorkspaces("user-a"), []);
});

test("ACK: a NEW operator's push never carries the previous one's receipts", async () => {
  // ⚠ The cross-account guard the origin stamps already apply to the ROWS; a receipt is the
  // same kind of claim — "a turn was fed" — and filing one operator's under another's
  // credential is the same defect. The fence is the identity STAMP on each receipt
  // (`delivery-ack.js`), so it holds even on a handover this writer never observed.
  const { m, summary, who } = armed();
  deliveryAck.note("ws-1", CHAN_A, 7, "woken", "user-a", KEY_A);
  who.id = "user-b";
  summary.emit([entry()]);
  await drained();
  assert.deepEqual(acksOf(m), [undefined], "user-b's push carries nothing of user-a's");
  // ⚠ AND A'S RECEIPT SURVIVES. Signing back in as A must not have cost them a claim nothing
  // will ever repeat.
  assert.deepEqual(deliveryAck.pendingWorkspaces("user-a"), ["ws-1"]);
});
