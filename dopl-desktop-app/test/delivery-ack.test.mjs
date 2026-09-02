// THE RECEIPT BUFFER — `main/delivery-ack.js` (2026-09-02, v2 wave A slice A9).
//
// ⚠ IT IS DRIVEN AS THE REAL MODULE, not sliced, because it holds MODULE STATE by design and
// that state IS the subject: what it keeps, what it evicts, and what it hands back when a push
// fails. Every case starts with `reset()` for the same reason.
//
// ⚠ THE THREE RULES IT ENFORCES, and each has a failure that is silent without it:
//   1. ONE RECEIPT PER MESSAGE, strengthening only — a busy thread touches many sessions and
//      would otherwise queue one entry per session, all about one message.
//   2. A BOUND that evicts the OLDEST — the server validates the ARRAY, so an oversized list
//      400s the WHOLE push, sessions included, unretryably.
//   3. RESTORE after a failed send — a receipt taken and dropped is one this machine forgot
//      it owed, and nothing ever asks again.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const acks = require(join(HERE, "..", "main", "delivery-ack.js"));

const WS = "ws-1";
const CH = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ME = "user-a";

test.beforeEach(() => acks.reset());

test("PURE: the block reaches nothing — no require, no clock, no store, no network", () => {
  const src = readFileSync(join(HERE, "..", "main", "delivery-ack.js"), "utf8");
  const from = src.indexOf("// ─── BEGIN DELIVERY-ACK-PURE");
  const to = src.indexOf("// ─── END DELIVERY-ACK-PURE");
  assert.ok(from > -1 && to > from, "the sentinels must stay sliceable");
  const block = src.slice(from, to);
  for (const banned of ["require(", "electron", "fetch(", "Date.", "process."]) {
    assert.ok(!block.includes(banned), `the pure block must not reference ${banned}`);
  }
});

test("VOCABULARY: exactly the four words a MACHINE may report", () => {
  // ⚠ The server's set has two more — `none` and `unreachable` — and they are ITS answers
  // about a message it resolved. Sending one 400s the whole push.
  assert.deepEqual(acks.DELIVERY_RANK, ["refused", "idle", "delivered", "woken"]);
  assert.equal(acks.note(WS, CH, 1, "none", ME), false);
  assert.equal(acks.note(WS, CH, 1, "unreachable", ME), false);
  assert.equal(acks.note(WS, CH, 1, "nonsense", ME), false);
  assert.deepEqual(acks.take(WS, ME), []);
});

test("ONE RECEIPT PER MESSAGE, and it only ever strengthens", () => {
  assert.equal(acks.note(WS, CH, 7, "idle", ME), true);
  assert.equal(acks.note(WS, CH, 7, "woken", ME), true);
  // ⚠ THE CASE THE RANK EXISTS FOR: a later, weaker report must not undo a wake.
  assert.equal(acks.note(WS, CH, 7, "refused", ME), false);
  assert.deepEqual(acks.take(WS, ME), [{ channelId: CH, seq: 7, delivery: "woken" }]);
});

test("a different seq, and a different channel, are different messages", () => {
  acks.note(WS, CH, 1, "idle", ME);
  acks.note(WS, "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", 1, "woken", ME);
  acks.note(WS, CH, 2, "refused", ME);
  assert.equal(acks.take(WS, ME).length, 3);
});

test("SCOPE: receipts are per workspace, and `take` empties only that one", () => {
  acks.note(WS, CH, 1, "woken", ME);
  acks.note("ws-2", CH, 2, "idle", ME);
  assert.deepEqual(acks.pendingWorkspaces(ME).sort(), ["ws-1", "ws-2"]);
  assert.equal(acks.take(WS, ME).length, 1);
  assert.deepEqual(acks.pendingWorkspaces(ME), ["ws-2"]);
});

test("BOUND: the oldest news is evicted, never the newest", () => {
  // ⚠ A bound that dropped the NEWEST would make this module quietest exactly when the machine
  // is busiest — i.e. when an orchestrator is most likely to be waiting on a receipt.
  for (let seq = 1; seq <= acks.MAX_PENDING + 3; seq += 1) acks.note(WS, CH, seq, "idle", ME);
  const out = acks.take(WS, ME);
  assert.equal(out.length, acks.MAX_PENDING);
  assert.equal(out[0].seq, 4);
  assert.equal(out[out.length - 1].seq, acks.MAX_PENDING + 3);
});

test("BOUND: re-noting an old message makes it NEW, so it is not evicted next", () => {
  for (let seq = 1; seq <= acks.MAX_PENDING; seq += 1) acks.note(WS, CH, seq, "idle", ME);
  acks.note(WS, CH, 1, "woken", ME); // strengthened, and therefore re-inserted at the end
  acks.note(WS, CH, 999, "idle", ME); // pushes the bound over by one
  const out = acks.take(WS, ME);
  assert.equal(out.length, acks.MAX_PENDING);
  assert.ok(out.some((a) => a.seq === 1 && a.delivery === "woken"), "seq 1 survived as woken");
  assert.ok(!out.some((a) => a.seq === 2), "seq 2 was the oldest and went");
});

test("RESTORE: a failed send puts them back, without clobbering newer news", () => {
  acks.note(WS, CH, 7, "idle", ME);
  const taken = acks.take(WS, ME);
  assert.deepEqual(acks.pendingWorkspaces(ME), []);
  // …the agent woke while the POST was in flight…
  acks.note(WS, CH, 7, "woken", ME);
  acks.restore(WS, taken, ME);
  // ⚠ RESTORE GOES THROUGH `note`, so the in-flight loss cannot walk a stronger answer back.
  assert.deepEqual(acks.take(WS, ME), [{ channelId: CH, seq: 7, delivery: "woken" }]);
});

test("IDENTITY: another operator's receipts are invisible, and are not destroyed either", () => {
  // ⚠ THE CROSS-ACCOUNT RULE. Signing out does not end engine sessions, so operator A's
  // dispatch can file a receipt that is still buffered when B signs in on the same Mac —
  // posting it under B's credential would attribute A's delivery to B. The stamp holds whether
  // or not anything NOTICED the handover, which is why it is a stamp and not a clear.
  acks.note(WS, CH, 1, "woken", ME);
  assert.deepEqual(acks.pendingWorkspaces("user-b"), []);
  assert.deepEqual(acks.take(WS, "user-b"), []);
  // ⚠ …AND A's IS STILL THERE. Signing back in as A must not have cost them a receipt.
  assert.deepEqual(acks.take(WS, ME).length, 1);
});

test("IDENTITY: a receipt with no operator is refused rather than buffered unreachably", () => {
  assert.equal(acks.note(WS, CH, 1, "woken", ""), false);
  assert.deepEqual(acks.pendingWorkspaces(ME), []);
});

test("RESET: the suite hook clears module state so cases cannot leak into each other", () => {
  acks.note(WS, CH, 1, "woken", ME);
  acks.reset();
  assert.deepEqual(acks.pendingWorkspaces(ME), []);
});

test("a malformed receipt is dropped rather than queued for a 400", () => {
  assert.equal(acks.note("", CH, 1, "woken", ME), false);
  assert.equal(acks.note(WS, "", 1, "woken", ME), false);
  assert.equal(acks.note(WS, CH, 0, "woken", ME), false);
  assert.equal(acks.note(WS, CH, "seven", "woken", ME), false);
  assert.deepEqual(acks.pendingWorkspaces(ME), []);
});
