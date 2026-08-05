// A PEER'S FOLLOW-UP REOPENS THE WINDOW THAT ANSWERED IT (2026-08-02, route 6).
//
// THE INCIDENT, from a real DM transcript on 1.7.23. The peer's external session posted an
// UNTAGGED request; this machine minted the ad-hoc thread tag `task-<channel>-<seq>`, raised
// consent, and a pair session answered and posted task_finished. The calm close SETTLED that
// session and destroyed its window, keeping the durable record. The peer then posted a
// FOLLOW-UP correctly tagged with that same thread (the MCP copy tells them to keep the tag,
// and the server lets it stand because they opened the exchange) — and this machine raised a
// BRAND NEW consent window for it, next to the window that had just answered.
//
// The tag was doubly invisible. targeting.firstClassTaskId is UUID-gated, so routes (1) and (3)
// saw no thread at all; and the task-scoped reopen machinery was wired only to the requester
// side and to the operator's own reopen click. So the follow-up reached classify -> 'trigger' ->
// a fresh consent, every time.
//
// THE FIX is route (6), the ONE post-classify route: inside the listener's 'trigger' branch,
// look the exchange up in the durable session records and, when one is there, recreate that
// shell through the existing parked-shell machinery and deliver the message through the
// IN-WINDOW INBOUND GATE. No consent row on this path — the gate IS the decision surface, the
// same one a live session's inbound uses — and no agent is started.
//
// The composed harness (four real blocks, the real reducer, fakes only at the leaves) lives in
// test/helpers/thread-followup.mjs; test/thread-followup-predicate.test.mjs owns the predicate
// truth tables, the Q3b directions and the seam pins. Two files, one harness, both under the
// §2 500-line cap.

import { test } from "node:test";
import {
  assert, harness, withRecord, record, followUp, dm, pushed,
  targeting, DISPATCH_BLOCK, CHAN, OTHER_CHAN, PEER, THIRD, UUID_THREAD, AGENT_ROW, LEGACY, BODY,
} from "./helpers/thread-followup.mjs";

// The routing block stays electron-free with the new route in it (§H-8).
for (const banned of ["require(", "electron", "fs.", "path.", "child_process", "@anthropic", "process."]) {
  assert.ok(!DISPATCH_BLOCK.includes(banned), `SESSION-DISPATCH-PURE must not reference ${banned}`);
}

// ── 1. THE REPRODUCTION ──────────────────────────────────────────────────────────

test("REPRO: a LEGACY-tagged follow-up reopens the window that answered — and raises NO consent", async () => {
  const h = withRecord(record());
  await h.dispatch(dm(), followUp(LEGACY));

  assert.deepEqual(h.calls.trigger, [], "no second consent window next to the one that answered");
  assert.deepEqual([h.calls.fyi, h.calls.taskNotify, h.calls.escalate], [[], [], []], "and no other verdict fired");

  // The shell was recreated on the EXCHANGE's own slot, from its own record.
  assert.equal(h.calls.startSession.length, 1, "exactly one shell");
  const spec = h.calls.startSession[0];
  assert.equal(spec.key, `${CHAN}:${LEGACY}`, "the (channel, thread) slot the pair session ran under");
  assert.equal(spec.taskId, LEGACY);
  assert.equal(spec.channelId, CHAN);
  assert.equal(spec.counterpartyId, PEER, "FIX L1: still bound to the member this exchange ran against");
  assert.equal(spec.profile, "full", "the stored profile, restored");
  assert.deepEqual([spec.turns, spec.costUsd], [3, 0.21], "and the spent budget, rehydrated");
});

test("REPRO: the message is HELD at the in-window gate, and the agent is never started", async () => {
  const h = withRecord(record());
  await h.dispatch(dm(), followUp(LEGACY));

  // NO AGENT. `parkedShell` is the one flag that suppresses the query, and the shell boots parked.
  assert.equal(h.calls.startSession[0].parkedShell, true, "the recreate opens a window and starts nothing");
  const s = h.shellFor(`${CHAN}:${LEGACY}`);
  assert.equal(s.state.parked, true);
  assert.deepEqual(pushed(h.calls), [], "nothing reached the agent");
  assert.ok(!h.calls.effects.some((e) => e.type === "resumeQuery"), "and no query was rebuilt for it");

  // HELD. The card is the head of the real FIFO, and the pill says a message waits.
  assert.equal(s.pendingInbound.length, 1);
  assert.equal(s.pendingInbound[0].message, BODY);
  assert.equal(s.pendingInbound[0].authorName, `name:${PEER}'s agent`, "the AUTHOR, not the peer's account name");
  assert.equal(s.state.hasPendingInbound, true);
  assert.equal(s.state.phase, "awaiting_inbound");
  assert.equal(h.calls.notices.length, 1, "and the operator is told, once");

  // FIX F1: the body that popped the gate is recorded, so the window's history fetch and the
  // fresh run's seed both exclude it — it appears exactly once, as the card.
  assert.ok(s.gatedBodies.includes(BODY));
});

test("the same follow-up carrying a FIRST-CLASS (UUID) thread tag takes the same path", async () => {
  const rec = record({ key: `${CHAN}:${UUID_THREAD}`, taskId: UUID_THREAD });
  const h = withRecord(rec);
  await h.dispatch(dm(), followUp(UUID_THREAD));

  assert.deepEqual(h.calls.trigger, [], "no fresh consent for a first-class follow-up either");
  assert.equal(h.calls.startSession.length, 1);
  assert.equal(h.calls.startSession[0].key, `${CHAN}:${UUID_THREAD}`);
  assert.equal(h.shellFor(`${CHAN}:${UUID_THREAD}`).pendingInbound.length, 1);
});

// ── 2. THE POSTURE DECIDES, NOT THE ROUTE ────────────────────────────────────────

test("POSTURE: a recreated shell starts at manual/ask — the reopen widens nothing", async () => {
  const h = withRecord(record());
  await h.dispatch(dm(), followUp(LEGACY));
  const s = h.shellFor(`${CHAN}:${LEGACY}`);
  assert.deepEqual({ t: s.state.toolMode, m: s.state.messageMode }, { t: "manual", m: "ask" },
    "a wake nobody approved must never come back on a widened posture");
  assert.equal(s.state.inboundForTask, false, "and no standing inbound grant either");
});

test("POSTURE: auto_inbound FEEDS the follow-up instead of holding it", async () => {
  // AXIS B is the whole difference. The route delivers to the same gate either way; what the
  // gate does with it is the operator's setting, exactly as for a live session's inbound.
  const h = withRecord(record(), { messageMode: "auto_inbound" });
  await h.dispatch(dm(), followUp(LEGACY));
  const s = h.shellFor(`${CHAN}:${LEGACY}`);
  assert.equal(s.pendingInbound.length, 0, "nothing is held");
  assert.equal(pushed(h.calls).length, 1, "the turn is fed");
  assert.equal(pushed(h.calls)[0].message, BODY);
  assert.ok(h.calls.effects.some((e) => e.type === "resumeQuery"), "and the dormant shell wakes to take it");
  assert.deepEqual(h.calls.trigger, [], "still no consent card");
  assert.deepEqual(h.calls.notices, [], "and no gate banner for a message that was never held");
});

// ── 3. EVERY MISS FALLS BACK TO TODAY'S BEHAVIOR ─────────────────────────────────

test("NO RECORD: this machine never worked the exchange -> the fresh consent, unchanged", async () => {
  const h = harness(); // no records at all
  await h.dispatch(dm(), followUp(LEGACY));
  assert.deepEqual(h.calls.trigger, [443], "handleTrigger runs exactly as it did before route (6)");
  assert.deepEqual(h.calls.startSession, [], "and nothing was opened on the way");
  assert.ok(h.calls.recordReads.includes(`${CHAN}:${LEGACY}`), "the route did ask");
});

test("EXPIRED / PRUNED: a record aged out by the TTL or dropped by the LRU is simply absent", async () => {
  // session-store's retention policy drops an unprotected record after 30 days, and the oldest
  // unprotected ones past 200. Both leave getRecord answering null, which is this case — the
  // exchange is unreopenable and the consent card is the honest surface for it.
  const h = harness({ records: { [`${CHAN}:${targeting.legacyThreadId(CHAN, 12)}`]: record() } });
  await h.dispatch(dm(), followUp(LEGACY));
  assert.deepEqual(h.calls.trigger, [443]);
  assert.deepEqual(h.calls.startSession, []);
});

test("CROSS-CHANNEL: a legacy tag minted in ANOTHER channel is not this channel's thread", async () => {
  const foreign = targeting.legacyThreadId(OTHER_CHAN, 440);
  // Even with a record parked under this channel's slot for that exact string, the tag never
  // resolves: a legacy id names its channel inline, so the reader refuses it before any lookup.
  const h = harness({ records: { [`${CHAN}:${foreign}`]: record({ key: `${CHAN}:${foreign}`, taskId: foreign }) } });
  await h.dispatch(dm(), followUp(foreign));
  assert.deepEqual(h.calls.trigger, [443], "the fresh consent, unchanged");
  assert.deepEqual(h.calls.startSession, []);
  assert.deepEqual(h.calls.recordReads, [], "no lookup was even attempted for a foreign tag");
});

test("CROSS-CHANNEL: a UUID thread whose record belongs to another channel never matches", async () => {
  // A first-class id carries no channel, so the slot key is the fence — and the record is
  // re-checked against the channel it claims, so a store hand-edited onto the wrong slot fails too.
  const rec = record({ key: `${CHAN}:${UUID_THREAD}`, taskId: UUID_THREAD, channelId: OTHER_CHAN });
  const h = withRecord(rec);
  await h.dispatch(dm(), followUp(UUID_THREAD));
  assert.deepEqual(h.calls.trigger, [443]);
  assert.deepEqual(h.calls.startSession, []);
});

test("A THIRD MEMBER stamping the tag gets the consent card, never somebody else's window", async () => {
  // `metadata.taskId` is caller-settable for a legacy id, so the record's stored counterparty is
  // the binding — the FIX L1 rule, read off the record instead of off a live session object.
  const group = dm({ memberCount: 3, isDirect: false });
  const h = withRecord(record());
  await h.dispatch(group, followUp(LEGACY, { authorUserId: THIRD, authorKind: "user" }));
  assert.deepEqual(h.calls.trigger, [443], "a stranger's request is a request");
  assert.deepEqual(h.calls.startSession, [], "and it opens nobody else's exchange");
});

test("A TEAM record is never reopened by a thread tag, though it shares the key space", async () => {
  // A summoned agent's session is keyed (channel, AGENT) and an agent id is a UUID like a
  // first-class thread id, so a tag naming one of my agents would otherwise resolve to its slot.
  const team = record({ key: `${CHAN}:${AGENT_ROW}`, taskId: "", agentId: AGENT_ROW, bind: "room" });
  const h = withRecord(team);
  await h.dispatch(dm(), followUp(AGENT_ROW));
  assert.deepEqual(h.calls.trigger, [443]);
  assert.deepEqual(h.calls.startSession, [], "the agent's session is not this thread's shell");
});

test("WINDOW-MODE OFF short-circuits the route before it reads anything", async () => {
  const h = withRecord(record(), { windowMode: false });
  await h.dispatch(dm(), followUp(LEGACY));
  assert.deepEqual(h.calls.trigger, [443], "the legacy classify path is byte-for-byte itself");
  assert.deepEqual(h.calls.recordReads, [], "no store read, no engine call");
});

// ── 4. THE WINDOW BUDGET ─────────────────────────────────────────────────────────

test("BUDGET: at the cap with nothing to free, the reopen refuses and consent takes over", async () => {
  const h = withRecord(record(), { capAt: 0 }); // at the cap from the start, no shell to evict
  await h.dispatch(dm(), followUp(LEGACY));
  assert.deepEqual(h.calls.startSession, [], "fail-restrictive: no window is forced open");
  assert.deepEqual(h.calls.trigger, [443], "and the operator still hears about the message");
});

test("BUDGET: an UNTOUCHED parked shell is evicted first — the existing atCapAfterEvict path", async () => {
  const h = withRecord(record(), { capAt: 1 });
  // One dormant, untouched shell already owns the budget.
  h.sessions.set("other:thread", {
    key: "other:thread", settled: false, startedAt: 1, pendingInbound: [],
    state: { parked: true, hasPendingInbound: false },
  });
  await h.dispatch(dm(), followUp(LEGACY));
  assert.deepEqual(h.calls.evicted, ["other:thread"], "the LRU idle shell makes room");
  assert.equal(h.calls.startSession.length, 1, "and the follow-up's own window opens");
  assert.deepEqual(h.calls.trigger, []);
});
