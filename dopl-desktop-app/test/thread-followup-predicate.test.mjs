// THE RESPONDER-SIDE BOUNDARY CONDITIONS — who may have a message claimed on their behalf,
// and where in listener-messages.js the claim is allowed to live.
//
// ⚠ THIS FILE'S SUBJECT WAS DELETED (2026-08-20, F-228). It owned route (5),
// `maybeReopenAddressedThread`: a peer's follow-up to an exchange this machine had already
// answered reopened THAT window and held the message at its in-window gate, instead of raising
// a second consent card beside it. The route, its two readers (`exchangeTag`,
// `reopenableRecord`) and its sibling file (test/thread-followup-reopen.test.mjs, which drove
// the whole trace) are all gone with the session window.
//
// ⚠ THE PREDICATES ARE NOT. Route (5) stated the responder-side predicate rather than
// inheriting it — my OWN message never answers a thread, a message addressed to somebody ELSE
// is not mine to answer, and a non-message kind / null identity / author-less post fails
// CLOSED — precisely because it had to agree with readers it did not control. Those readers
// are `session-dispatch.feedLiveSession` (the one surviving route) and `targeting.classify`,
// both untouched, and each of the three propositions is still a live rule in both. So the
// three PREDICATE tests are REWRITTEN onto the readers that survive rather than deleted:
// INVARIANTS §14, "a mixed test file whose feature is deleted is rewritten down to what
// survives". Each carries a note saying what it used to drive.
//
// THE SEAM at the foot is unmoved: it runs the REAL `dispatchMessage` against the REAL
// `classify` and measures whether the passive banner fires. That was always a listener-side
// assertion; route (5) merely happened to sit next to it.
//
// METHOD. The shared source-extraction harness this file used to import
// (test/helpers/thread-followup.mjs) is DELETED with the suite it served: it wired four real
// blocks together — the listener body, SESSION-DISPATCH-PURE, SESSION-GATE-PURE's
// `feedInboundForTask` and SESSION-PARK-PURE's `recreateParkedShell` — and the last two no
// longer exist. What is left needs two of the four, so they are sliced here, in the one file
// that reads them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const LISTENER = M("listener-messages.js");
const DISPATCH = M("session-dispatch.js");

// targeting.js is dependency-free, so `classify` and the tag readers are the REAL ones here —
// a legacy id this file and the shipped minter disagreed about is exactly the class of bug the
// deleted route existed to fix, and the minter is still the one classify reads.
const targeting = require("../main/targeting.js");
const agentHandles = require("../main/agent-handles.js"); // pure; the REAL slug rule

function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels missing or out of order`);
  return src.slice(from, to);
}

// `dispatchMessage` is an `async function`, so the keyword comes along with the body.
function extractAsyncFn(src, name) {
  const at = src.indexOf(`async function ${name}(`);
  assert.notEqual(at, -1, `async function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", at);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(at, i);
}

const DISPATCH_BLOCK = slice(DISPATCH, "SESSION-DISPATCH-PURE");

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const THIRD = "33333333-3333-3333-3333-333333333333";
const CHAN = "dba90694-1111-4222-8333-444444444444";
const UUID_THREAD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const LEGACY = targeting.legacyThreadId(CHAN, 440); // the tag this machine minted for #440
const BODY = "one more thing — can you also check the staging config?";

// The REAL routing block plus the REAL listener body, wired to each other as the app wires
// them, so a test can assert on the WHOLE trace of one inbound message. FAKES ONLY AT THE
// LEAVES: the session registry, the display-name lookup, the consent/notify sinks. Nothing
// here can open a window, start a query or touch disk.
//
// ⚠ The one piece of shared state is the REAL targeting module's legacy-thread registry. Every
// fixture below carries a thread tag, which `noteMyLegacyThread` refuses to record ("openers
// only"), so no test can write to it.
function harness(over = {}) {
  const cfg = { live: false, counterparty: PEER, ...over };
  const calls = { feed: [], trigger: [], fyi: [], taskNotify: [], diag: [] };
  // ⚠ THE FEED IS A FAN-OUT SINCE 2026-08-21 (Samuel's multiplayer ruling): the route asks the
  // engine for EVERY live agent on the thread and feeds each of them, rather than resolving one
  // session and checking its counterparty. `cfg.live` now means "is one of my agents on this
  // thread"; `counterpartyFor` is not consulted by this route at all any more.
  const sessionEngine = {
    liveOnThread: () => (cfg.live ? [{ agentId: "a1b2c3d4", ownPostIds: new Set() }] : []),
    // The tier rule (2026-08-28) counts the CHANNEL's agents; here that is the same one session.
    agentIdsInChannel: () => (cfg.live ? ["a1b2c3d4"] : []),
    feedInbound: (a) => { calls.feed.push(a); return true; },
  };
  // ⚠ THE REAL ROUTE, NO WAKE STUBS (2026-09-02) — the fixtures below are all RUNNING sessions,
  // which no wake rule governs, and the route reads its verdict off the message.
  const routes = new Function(
    // ⚠ `deliveryAck` joined the block's free vars with the wake ack (2026-09-02, A9). A no-op
    // recorder is enough here: this suite asserts routing, and `delivery-ack.test.mjs` owns
    // the buffer.
    "targeting", "sessionEngine", "io", "agentHandles", "deliveryAck", "diag",
    `${DISPATCH_BLOCK}\n return { feedLiveSession };`
  )(targeting, sessionEngine, { displayNameFor: (id) => `name:${id}` },
    agentHandles, { note: () => true, verdictFor: () => '' }, () => {});

  const api = new Function(
    "versionSkew", "sessionDispatch", "targeting", "trigger", "taskNotify", "diag",
    `${extractAsyncFn(LISTENER, "dispatchMessage")}\n return { dispatchMessage };`
  )(
    { observe: () => {} },
    routes, targeting,
    { handleTrigger: async (e, m) => calls.trigger.push(m.seq), sendFyi: (e, m) => calls.fyi.push(m.seq) },
    { notifyTaskReply: (e, m) => calls.taskNotify.push(m.seq) },
    (...a) => calls.diag.push(a.join(" "))
  );

  return { dispatch: (entry, m) => api.dispatchMessage(entry, m, ME), routes, calls, cfg };
}

/** The DM the incident happened in. */
const dm = (over = {}) => ({
  channel: { id: CHAN, name: "David", memberCount: 2, isMember: true, isDirect: true, ...over },
  workspaceId: "w1", rosterKnown: true, teamAgents: 0,
});

/** The peer's follow-up: their agent, addressed back to me, carrying the exchange's tag. */
const followUp = (tag, over = {}) => {
  const { metadata, ...rest } = over;
  return {
    kind: "message", seq: 443, authorUserId: PEER, authorKind: "agent", body: BODY,
    metadata: { to_user_id: ME, taskId: tag, ...(metadata || {}) },
    ...rest,
  };
};

// ── 1. THE RESPONDER-SIDE PREDICATE, ON THE READERS THAT SURVIVE ─────────────────

test("PREDICATE: my OWN message TRIGGERS nothing, but it does reach my own agents", async () => {
  // ⚠ REPOINTED TWICE. It first read `maybeReopenAddressedThread(...) === false` (route 5,
  // deleted 2026-08-20). It then asserted that route (1) refused my own message too — and THAT
  // half is reversed by Samuel's fan-out ruling (2026-08-21): the operator posting into their
  // own thread is how they steer their agents in the open, so the words are fed.
  //
  // ⚠ THE PROPOSITION THIS FILE IS ABOUT SURVIVES INTACT, and it is the one that matters: my own
  // message never has a claim made ON MY BEHALF. It raises no consent, starts no session and
  // notifies nobody, because `classify` still answers 'ignore' for it. FEEDING a session that
  // already exists is not a claim — nothing is brought into being — which is the same
  // distinction route (1) has always rested on.
  const mine = followUp(LEGACY, { authorUserId: ME, authorKind: "user" });

  const h = harness({ live: true, counterparty: ME });
  assert.equal(await h.routes.feedLiveSession(dm(), mine, ME), true, "my agents hear me");
  assert.equal(h.calls.feed.length, 1);

  // classify: my own message is 'ignore', full stop — the fail-closed rule at the top of the
  // table. My messages OPEN threads; they never answer them.
  assert.equal(targeting.classify(mine, dm(), ME), "ignore");

  // …and end to end, the ONLY thing that happens is the feed: no trigger, no banner, no notice.
  const fresh = harness({ live: true, counterparty: ME });
  await fresh.dispatch(dm(), mine);
  assert.equal(fresh.calls.feed.length, 1);
  assert.deepEqual([fresh.calls.trigger, fresh.calls.fyi, fresh.calls.taskNotify], [[], [], []]);
});

test("PREDICATE: a message addressed to somebody ELSE never takes this path", async () => {
  // ⚠ REPOINTED (2026-08-20). The route read `to_user_id` itself — an explicit addressee that
  // is not me is a message I watch, not one I owe an answer to — and refused before any
  // lookup. classify states the same rule and is now its only reader: an explicitly
  // third-party-addressed post can be 'fyi' (it tagged me) or 'ignore', and NEVER 'trigger'.
  const forThird = followUp(LEGACY, { metadata: { to_user_id: THIRD } });
  assert.equal(targeting.classify(forThird, dm(), ME), "ignore");
  const h = harness();
  await h.dispatch(dm(), forThird);
  assert.deepEqual([h.calls.trigger, h.calls.taskNotify], [[], []], "nothing is owed and nothing fires");

  // Tagging me inside somebody else's request is still a tag — an escalation, never a
  // decision. This is the boundary the route could not see and classify always could.
  const tagged = harness();
  await tagged.dispatch(dm(), followUp(LEGACY, { metadata: { to_user_id: THIRD, mentionedUserIds: [ME] } }));
  assert.deepEqual([tagged.calls.fyi, tagged.calls.trigger], [[443], []]);

  // ⚠ AN ABSENT ADDRESSEE. The route TOLERATED one, and the note beside it said the tolerance
  // was for STORED pre-retirement messages and addressee-less lifecycle posts — narrowing it
  // would be a floor-raise, not a cleanup (INVARIANTS §13). With the route gone the tolerance
  // has no reader at all, and classify's own answer is the strict one: DM auto-address and the
  // implicit 1:1 trigger both retired 2026-08-18, so an unaddressed post reaches nobody.
  const unaddressed = followUp(LEGACY, { metadata: { to_user_id: undefined } });
  assert.equal(targeting.classify(unaddressed, dm(), ME), "ignore",
    "an ask that names nobody reaches nobody, in a DM exactly as in a group channel");
});

test("PREDICATE: a non-message kind, a null identity and an author-less post fail closed", async () => {
  // ⚠ REPOINTED (2026-08-20) onto both surviving readers. These were the route's guard clause
  // and they are, word for word, `feedLiveSession`'s and `classify`'s: the `kind !== 'message'`
  // filter (a lifecycle marker or a milestone is a statement ABOUT a session, not a person
  // speaking), the unresolved identity the listener has not supplied yet, and a post with no
  // author. Every one fails toward doing nothing.
  const h = harness({ live: true, counterparty: PEER });
  // ⚠ AWAITED SINCE 2026-08-28: the route is async (TIER 3's claim/pass pass).
  const feeds = (m, me) => h.routes.feedLiveSession(dm(), m, me);
  assert.equal(await feeds(followUp(LEGACY, { kind: "task_started" }), ME), false, "a lifecycle kind");
  assert.equal(await feeds(followUp(LEGACY), null), false, "identity not resolved yet");
  assert.equal(await feeds(followUp(LEGACY, { authorUserId: null }), ME), false, "an author-less post");
  assert.equal(await feeds(null, ME), false, "and no message at all");
  assert.equal(h.calls.feed.length, 0);

  assert.equal(targeting.classify(followUp(LEGACY, { kind: "task_started" }), dm(), ME), "ignore");
  assert.equal(targeting.classify(followUp(LEGACY), dm(), null), "ignore");
  assert.equal(targeting.classify(followUp(LEGACY, { authorUserId: null }), dm(), ME), "ignore");
  assert.equal(targeting.classify(null, dm(), ME), "ignore");
});

// ── 2. THE SEAM ──────────────────────────────────────────────────────────────────

// THE GATE, ASSERTED BEHAVIOURALLY — because a source regex pins a SHAPE, not an outcome. This
// harness runs the REAL `dispatchMessage` against the REAL `classify`, so what it measures is
// whether the banner fires.
//
// ⚠ F-108 IS WHY IT IS SHAPED THIS WAY. The sibling assertion here used to be a regex over the
// shipped source text and it broke on a refactor that changed nothing it was protecting: C-3
// made `handleTrigger` ANSWER whether the listener's cursor may advance, so the call site
// became `return trigger.handleTrigger(entry, m)` and the assertion went red over a passing
// product. F-108 is the standing finding about this class of desktop test.
test("SEAM: the passive task-reply notice is MENTION-GATED, and the verdict behind it is not", async () => {
  // The requester-side shape classify answers 'task-reply' for: the peer's AGENT replying in
  // an interactive thread I created, addressed back to me.
  const reply = (metadata = {}) => ({
    kind: "message", seq: 77, authorUserId: PEER, authorKind: "agent", body: "here is the answer",
    metadata: {
      taskId: UUID_THREAD, taskMode: "interactive", taskCreatedBy: ME, taskTarget: PEER,
      to_user_id: ME, ...metadata,
    },
  });

  const quiet = harness();
  await quiet.dispatch(dm(), reply());
  assert.deepEqual(quiet.calls.taskNotify, [], "untagged thread traffic raises no banner");
  // ⚠ AND NOTHING ELSE CLAIMED IT INSTEAD. Without this, "no banner" would also be true of a
  // dispatcher that had started spawning against its own reply — the failure the 'task-reply'
  // verdict exists to prevent, wearing the same green.
  assert.deepEqual([quiet.calls.trigger, quiet.calls.fyi, quiet.calls.feed], [[], [], []]);

  const tagged = harness();
  await tagged.dispatch(dm(), reply({ mentionedUserIds: [ME] }));
  assert.deepEqual(tagged.calls.taskNotify, [77], "a reply that @-tags me still escalates");
  assert.deepEqual([tagged.calls.trigger, tagged.calls.fyi], [[], []], "and still never triggers");

  // ⚠ THE 2026-08-20 COUNTER-RULE, in the same test because it is the same gate: a HUMAN-typed
  // reply notifies UNTAGGED. The widened suppression removed its consent card, and a person's
  // addressed words must not become invisible; agent replies stay mention-gated.
  const human = harness();
  await human.dispatch(dm(), { ...reply(), authorKind: "user" });
  assert.deepEqual(human.calls.taskNotify, [77], "a person's untagged reply still banners");
  assert.deepEqual([human.calls.trigger, human.calls.fyi], [[], []]);
});

// ⚠ SEVEN TESTS STOOD IN THIS FILE AND ARE GONE (2026-08-20, F-228). Every one of them drove
// route (5) or a helper only route (5) had.
//
// §2 Q3b — THE REQUESTER SIDE, UNPERTURBED — four tests. The boundary that mattered most, and
//   it ran in the other direction: the requester-side routes (2) and (4) turned on MY OWN
//   authorship, route (5) on the PEER's, and no message could satisfy both. DIRECTION 1 an
//   EXTERNAL unstamped create opened nothing; DIRECTION 2 a `desktop-session` create launched
//   its requester session; DIRECTION 3 the operator's `desktop-ui` create took that same route
//   PLUS the request strip; DIRECTION 4 an external create DECLARING handoff opened the session
//   here. ⚠ The PREDICATE half of all four survives untouched in
//   test/operator-typed-request.test.mjs, which is `targeting.requesterTaskOpen`'s own table;
//   what is deleted is only the dispatch each direction ended in.
//
// §3 THE TAG READER + THE RECORD TEST — three tests. "exchangeTag: the two spellings, and
//   nothing else" and "exchangeTag agrees with the shipped minter, byte for byte" pinned the
//   reader that resolved a message's (channel, thread) STORAGE TAG — a first-class UUID, or
//   this channel's legacy id re-derived through the canonical minter and compared for EQUALITY
//   so the reader could never disagree with the writer, with the channel as a cross-channel
//   fence. "reopenableRecord: every conjunct fails CLOSED" pinned the durable-record test: the
//   record must claim this channel and this thread, must not be a TEAM record (keyed
//   (channel, AGENT) in the same key space, and an agent id is a UUID like a thread id), and
//   its stored counterparty must be the author. Both helpers are deleted with the route.
//   ⚠ NOT ORPHANED: `legacyThreadId` — the minter both readers agreed with — is pinned against
//   trigger.js in test/legacy-thread-reply.test.mjs, which is the file that owns the agreement.
//
// §4 THE OTHER TWO SEAM CASES. "SEAM: route (6) runs AFTER classify, inside the 'trigger'
//   branch, and guards handleTrigger" — the position pin; the branch is plain now and
//   test/wake-external-requester.test.mjs pins that it is. "SEAM: a CLAIMED follow-up raises no
//   consent; a DECLINED one raises exactly one" — the F-108 payoff, exercising the invariant in
//   both directions instead of regexing the call site; there is no claimant left to exercise.
//   "SEAM: the reopen spends no consent-entry arm" — FIX 1b's single-setter rule, that neither
//   session-dispatch nor listener-messages nor session-park may hand `adoptsConsent` in. ⚠ THE
//   RULE ITSELF WENT IN THE SAME WAVE, and this file is not where to read about it: FIX 1b's
//   own five tests are excised in test/session-posture-sticks.test.mjs §2b, which records that
//   the defect is UNREACHABLE rather than fixed (no consent registry, so no arm to spend) and
//   that `session-engine.js › launch` still passes `adoptsConsent` on a name nothing reads —
//   filed as a finding there, not patched. This file only ever asserted the rule for one more
//   path, and that path is gone.
