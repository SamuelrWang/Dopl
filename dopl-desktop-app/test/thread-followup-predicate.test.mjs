// Route (6) — the RESPONDER-SIDE predicate, the two readers behind it, and the seam it sits in.
//
// The sibling file (test/thread-followup-reopen.test.mjs) drives the whole trace: a peer's
// follow-up to an exchange this machine already answered reopens THAT window and holds the
// message at its in-window gate. This one owns the boundary conditions — who may take that
// path, what counts as an exchange tag, which durable records qualify, and where in
// listener-messages.js the check is allowed to live.
//
// THE BOUNDARY THAT MATTERS MOST is Q3b, and it is a boundary in the other direction. The
// requester-side routes (2) and (4) turn on MY OWN authorship; this route turns on the peer's.
// No message can satisfy both predicates, and the three Q3b directions are re-driven here
// through the composed harness to prove the new route did not perturb them.

import { test } from "node:test";
import {
  assert, harness, withRecord, record, followUp, dm,
  targeting, LISTENER, DISPATCH, PARK,
  ME, PEER, THIRD, CHAN, OTHER_CHAN, UUID_THREAD, AGENT_ROW, LEGACY,
} from "./helpers/thread-followup.mjs";

// ── 1. THE RESPONDER-SIDE PREDICATE ──────────────────────────────────────────────

test("PREDICATE: my OWN message never takes this path, whatever it carries", async () => {
  const h = withRecord(record());
  const mine = followUp(LEGACY, { authorUserId: ME, authorKind: "user" });
  assert.equal(await h.routes.maybeReopenAddressedThread(dm(), mine, ME), false);
  assert.deepEqual(h.calls.recordReads, [], "authorship is checked before any lookup");
});

test("PREDICATE: a message addressed to somebody ELSE never takes this path", async () => {
  const h = withRecord(record());
  const forThird = followUp(LEGACY, { metadata: { to_user_id: THIRD } });
  assert.equal(await h.routes.maybeReopenAddressedThread(dm(), forThird, ME), false);
  assert.deepEqual(h.calls.recordReads, []);
  // An ABSENT addressee is still ALLOWED by the predicate, though the reason it used to
  // be reachable is gone: DM auto-address and the implicit 1:1 trigger both retired
  // 2026-08-18, so an unaddressed post no longer earns the 'trigger' this route runs
  // under. The tolerance is kept for STORED pre-retirement messages and installed
  // desktops' addressee-less lifecycle posts — narrowing it is a floor-raise, not a
  // cleanup (INVARIANTS §13).
  const g = withRecord(record());
  const unaddressed = followUp(LEGACY, { metadata: { to_user_id: undefined } });
  assert.equal(await g.routes.maybeReopenAddressedThread(dm(), unaddressed, ME), true);
});

test("PREDICATE: a non-message kind, a null identity and an author-less post fail closed", async () => {
  const h = withRecord(record());
  assert.equal(await h.routes.maybeReopenAddressedThread(dm(), followUp(LEGACY, { kind: "task_started" }), ME), false);
  assert.equal(await h.routes.maybeReopenAddressedThread(dm(), followUp(LEGACY), null), false);
  assert.equal(await h.routes.maybeReopenAddressedThread(dm(), followUp(LEGACY, { authorUserId: null }), ME), false);
  assert.equal(await h.routes.maybeReopenAddressedThread(dm(), null, ME), false);
  assert.deepEqual(h.calls.recordReads, []);
});

// ── 2. Q3b — THE REQUESTER SIDE, UNPERTURBED ─────────────────────────────────────

const myCreate = (over = {}) => ({
  kind: "message", seq: 41, authorUserId: ME, body: "please look at X",
  authorKind: over.authorKind || "agent",
  metadata: {
    taskId: UUID_THREAD, taskCreatedBy: ME, taskTarget: PEER, to_user_id: PEER,
    ...(over.runtime ? { runtime: over.runtime } : {}),
  },
});

test("Q3b DIRECTION 1 — an EXTERNAL, UNSTAMPED create still opens NOTHING", async () => {
  // Whatever author kind it declares: since 2026-08-05 (rollback §3.4) the runtime STAMP is
  // the whole of what routes a self-authored create, and an external session has none.
  for (const authorKind of ["agent", "user"]) {
    const h = withRecord(record());
    await h.dispatch(dm(), myCreate({ authorKind }));
    assert.deepEqual([h.calls.launch, h.calls.arm, h.calls.startSession], [[], [], []], authorKind);
    assert.deepEqual([h.calls.trigger, h.calls.fyi, h.calls.taskNotify], [[], [], []], authorKind);
  }
});

test("Q3b DIRECTION 2 — a DESKTOP-STAMPED create still launches its requester session", async () => {
  const h = withRecord(record());
  await h.dispatch(dm(), myCreate({ runtime: "desktop-session" }));
  assert.equal(h.calls.launch.length, 1, "route (2) still claims it");
  assert.deepEqual([h.calls.arm, h.calls.startSession, h.calls.trigger], [[], [], []],
    "and a spawned session's create arms no request strip");
});

test("Q3b DIRECTION 3 — the operator's TYPED create takes that same route, plus the strip", async () => {
  // Rollback §3.4: one initiating behaviour. The dormant shell is gone; `desktop-ui` is a
  // server-written stamp, so this is a full requester session like any other.
  const h = withRecord(record());
  await h.dispatch(dm(), myCreate({ authorKind: "user", runtime: "desktop-ui" }));
  assert.equal(h.calls.launch.length, 1, "route (2) claims it too");
  assert.equal(h.calls.arm.length, 1, "and the request strip opens at 'sent'");
  assert.deepEqual([h.calls.startSession, h.calls.trigger], [[], []]);
});

test("Q3b DIRECTION 4 — an EXTERNAL create that DECLARES handoff opens the session HERE", async () => {
  // Rollback §3.5 inverts DIRECTION 1: the SAME unstamped external create, but with the
  // server-stamped handoff flag, is the operator handing the thread to a window on this
  // machine. Route (2) claims it and launches — and, like a spawned create, arms no strip.
  const h = withRecord(record());
  const m = myCreate();
  m.metadata.handoff = true;
  await h.dispatch(dm(), m);
  assert.equal(h.calls.launch.length, 1, "the requester session opens on this machine");
  assert.deepEqual([h.calls.arm, h.calls.startSession, h.calls.trigger], [[], [], []],
    "a handoff is not the operator typing — no strip, and it is not a fresh consent either");
});

// ── 3. THE TAG READER + THE RECORD TEST, as truth tables ─────────────────────────

test("exchangeTag: the two spellings, and nothing else", () => {
  const { exchangeTag } = harness().routes;
  const tagged = (taskId) => ({ metadata: { taskId } });
  assert.equal(exchangeTag(tagged(UUID_THREAD), CHAN), UUID_THREAD, "a first-class id");
  assert.equal(exchangeTag(tagged(LEGACY), CHAN), LEGACY, "and this channel's legacy id");
  for (const junk of [
    "", "   ", "task-", `task-${CHAN}-`, `task-${CHAN}-0`, `task-${CHAN}-x`, `task-${CHAN}-1.5`,
    `task-${CHAN}-01`, `task-${OTHER_CHAN}-440`, `${CHAN}-440`, "3f2504e0-4f89-41d3-9a0c",
  ]) {
    assert.equal(exchangeTag(tagged(junk), CHAN), "", `tag ${JSON.stringify(junk)}`);
  }
  assert.equal(exchangeTag(tagged(LEGACY), ""), "", "a channel-less entry resolves nothing");
  assert.equal(exchangeTag({}, CHAN), "", "and so does a message with no metadata bag");
});

test("exchangeTag agrees with the shipped minter, byte for byte", () => {
  // Matching is a plain string lookup against a key some earlier run wrote, so this reader and
  // trigger.js's taskIdFor / futureTaskId have to spell the id identically. legacyThreadId is
  // the canonical one (test/legacy-thread-reply pins IT against trigger.js), so agreeing with
  // it is agreeing with all three.
  const { exchangeTag } = harness().routes;
  for (const seq of [1, 7, 440, 99999]) {
    const id = targeting.legacyThreadId(CHAN, seq);
    assert.equal(exchangeTag({ metadata: { taskId: id } }, CHAN), id, `seq ${seq}`);
  }
});

test("reopenableRecord: every conjunct fails CLOSED", () => {
  const { reopenableRecord } = harness().routes;
  const ok = (over) => reopenableRecord({ ...record(), ...over }, CHAN, LEGACY, PEER);
  assert.equal(ok({}), true, "the canonical record");
  assert.equal(ok({ channelId: OTHER_CHAN }), false, "a record claiming another channel");
  assert.equal(ok({ taskId: targeting.legacyThreadId(CHAN, 7) }), false, "or another thread");
  assert.equal(ok({ agentId: AGENT_ROW }), false, "a TEAM record is not a thread's shell");
  assert.equal(ok({ counterpartyId: THIRD }), false, "the author must be the stored counterparty");
  assert.equal(ok({ counterpartyId: null }), false, "and an unbound record qualifies nobody");
  for (const junk of [null, undefined, "rec", 7, []]) {
    assert.equal(reopenableRecord(junk, CHAN, LEGACY, PEER), false, `record ${JSON.stringify(junk)}`);
  }
});

// ── 4. THE SEAM ──────────────────────────────────────────────────────────────────

test("SEAM: route (6) runs AFTER classify, inside the 'trigger' branch, and guards handleTrigger", () => {
  const at = (needle) => {
    const i = LISTENER.indexOf(needle);
    assert.notEqual(i, -1, `missing from listener-messages.js: ${needle}`);
    return i;
  };
  const classify = at("const verdict = targeting.classify(m, entry, myUserId);");
  const reopen = at("sessionDispatch.maybeReopenAddressedThread(entry, m, myUserId)");
  assert.ok(classify < reopen, "it is the ONE post-classify route — classify still runs first");
  // And the other verdicts are dispatched exactly as before — the route cannot reach them.
  // There was a fourth, 'agent-escalation', and it is gone with the named agents whose
  // `author_agent_id` stamp was its whole trigger (channels rollback §1).
  assert.match(LISTENER, /else if \(verdict === 'fyi'\) trigger\.sendFyi\(entry, m\);/);
  assert.match(LISTENER, /else if \(verdict === 'task-reply'\) taskNotify\.notifyTaskReply\(entry, m\);/);
  assert.ok(!/notifyAgentEscalation/.test(LISTENER), "the escalation dispatch is gone");
});

// THE EXACT SEAM — "the fresh consent runs ONLY when the reopen declined the message" —
// ASSERTED BEHAVIOURALLY (2026-08-08, F-108).
//
// It used to be a regex over the shipped source text:
//   /if \(!\(await sessionDispatch\.maybeReopenAddressedThread\(…\)\)\) await trigger\.handleTrigger\(…\);/
// That pinned today's SHAPE rather than the behaviour, and it broke on a refactor that
// changed nothing it was protecting: C-3 made `handleTrigger` ANSWER whether the listener's
// cursor may advance past this message, so the call site became `return trigger.handleTrigger(
// entry, m)` and the assertion went red over a passing product. F-108 is the standing finding
// about this class of desktop test; this is one instance paid off.
//
// The harness already runs the REAL dispatchMessage over the REAL routes and the REAL
// classify, so the invariant can simply be exercised in both directions — which is a stronger
// pin than the regex was, because it would also catch a route that returned true and raised
// consent anyway (a shape the regex could not see).
test("SEAM: a CLAIMED follow-up raises no consent; a DECLINED one raises exactly one", async () => {
  // Claimed: this machine has the settled pair session's durable record, so route (6) reopens
  // that window and holds the message at its in-window gate.
  const claimed = withRecord(record());
  await claimed.dispatch(dm(), followUp(LEGACY));
  assert.equal(claimed.calls.startSession.length, 1, "the exchange's own window is reopened");
  assert.deepEqual(claimed.calls.trigger, [], "a claimed message must not ALSO raise consent");

  // Declined: no record for the tag, so the route answers false and the ordinary consent path
  // runs byte-for-byte as before.
  const declined = harness();
  await declined.dispatch(dm(), followUp(LEGACY));
  assert.deepEqual(declined.calls.startSession, [], "nothing to reopen");
  assert.deepEqual(declined.calls.trigger, [443], "…so the follow-up gets a fresh consent card");
});

test("SEAM: the reopen spends no consent-entry arm — it is a recreate, not an adoption", () => {
  // FIX 1b's single-setter rule: launch()'s own adopt test is the ONLY site that may hand
  // `adoptsConsent` in, and this path reaches startSession through session-park, which the pin
  // in session-posture-sticks already forbids from setting it. Neither file on this route may.
  assert.ok(!/adoptsConsent/.test(DISPATCH), "session-dispatch must never hand the flag in");
  assert.ok(!/adoptsConsent/.test(LISTENER), "and neither may the listener");
  assert.ok(!/adoptsConsent/.test(PARK), "the recreate machinery it uses does not set it either");
});
