// WAKE-V1 — the EXTERNAL-requester fallback. A thread opened by the operator's own
// external Claude Code session must open NO desktop session, and the peer's reply must
// still surface as the passive OS notification.
//
// WHY THIS FILE EXISTS. WAKE-V1 makes an external session await its own reply (a
// long-held MCP call that wakes it when the peer answers), so targeting.requesterTaskOpen
// demanded a `desktop-*` runtime stamp before auto-opening a requester window — otherwise a
// desktop window raced the waiting session for the same reply. Removing that window removed
// the ONE route that used to claim these messages, which put the whole burden on the
// listener's remaining dispatch order. The risk this file closes: a reply that is no longer
// claimed by a window and is ALSO swallowed by another pre-classify route would reach neither
// agent nor operator — silently lost, with the listener's cursor already advanced past it. So
// both halves are pinned: the ORDER (statically, against listener-messages.js) and the OUTCOME
// (behaviorally, through the real routing + the real classify).
//
// ⚠ THE FALLBACK IS NOW THE ONLY PATH (2026-08-20, F-228). Four of the five pre-classify
// routes are deleted, so what this file used to prove about ONE thread shape — that nothing on
// this machine claims it, and the passive banner is what the operator gets — is simply how
// every requester-side thread behaves. F-228 names these truth tables as "the record that the
// guards still hold", so the file is rewritten down to the guards that are still there rather
// than removed (INVARIANTS §14). The excision blocks below name what went and why.
//
// THE TRACE this file locks in, for a thread an EXTERNAL session created:
//   listener-messages.js versionSkew.observe        — diagnostic, before any route can claim it
//   listener-messages.js noteMyLegacyThread         — the registry, also ahead of every route
//   listener-messages.js feedLiveSession            -> false (no session was ever spawned,
//                                                     so no live session for this task)
//   listener-messages.js classify                   -> 'task-reply'
//   listener-messages.js taskNotify.notifyTaskReply — the passive silent banner.
//
// METHOD: the repo's source-extraction idiom. targeting.js is dependency-free so it is
// required for real (the runtime gate must be the REAL one here, not a fake); the
// SESSION-DISPATCH-PURE block is sliced and driven with fakes standing in for the
// electron-bound engine; the dispatch body is mirrored and the mirror is pinned
// against the real source below, so a reordering of listener-messages.js fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const LISTENER = M("listener-messages.js");
const LOOP = M("channel-listener.js");
const DISPATCH = M("session-dispatch.js");
const TARGETING = M("targeting.js");
// §2 SPLIT (2026-07-31): the LEGACY-THREADS registry moved out of targeting.js when that
// file went past the 500-line cap; classify still calls into it as free variables.
const LEGACY_SRC = M("legacy-threads.js");

const require = createRequire(import.meta.url);
const targeting = require("../main/targeting.js"); // dependency-free; the REAL gate
const wakeTiers = require("../main/session-wake-tiers.js"); // pure; the REAL tier rule
const agentHandles = require("../main/agent-handles.js"); // pure; the REAL slug rule

// ── STATIC PIN 1: the listener's dispatch ORDER ──────────────────────────────────
// The mirror below is only meaningful if it matches the real loop. These pin the surviving
// call site, that it SHORT-CIRCUITS classify, and that the verdicts are wired as the mirror
// wires them.

test("the listener runs THE route, and classify still runs LAST", () => {
  const at = (needle) => {
    const i = LISTENER.indexOf(needle);
    assert.notEqual(i, -1, `dispatch site missing from listener-messages.js: ${needle}`);
    return i;
  };
  // ⚠ AWAITED SINCE 2026-08-28 (Samuel's TIERED WAKE ruling): TIER 3's claim/pass pass makes the
  // route asynchronous, and the pin moves with it. The ORDER property this file exists for is
  // unchanged — the route still runs first and classify still runs LAST — but an `await` that
  // went missing here would make `feedLiveSession` return a Promise, which is always truthy, and
  // EVERY message would short-circuit classify. That is why the pin names the exact call.
  const feed = at("if (await sessionDispatch.feedLiveSession(entry, m, myUserId)) return;");
  const classify = at("const verdict = targeting.classify(m, entry, myUserId);");
  assert.ok(feed < classify, "feedLiveSession runs first, and classify LAST");
  // ⚠ THIS PIN USED TO COMPARE FIVE POSITIONS — three routes plus the chat guard between
  // routes 1 and 2. Two of the five sites are all that is left, so what it can still measure
  // is exactly the property it was built for: nothing may be inserted between a message
  // arriving and classify seeing it that could claim the message first.
  //
  // Q10's skew read and the legacy-thread registry both happen BEFORE the route can claim the
  // message. The skew read because a reply consumed by a live session is exactly the one whose
  // sender's version explains a gap; the registry because an untagged line of mine taken by an
  // engaged session short-circuits above classify, and the opener it would have recorded is
  // lost — costing a spurious consent prompt on the peer's eventual reply.
  assert.ok(at("versionSkew.observe(entry, m, myUserId);") < feed, "skew is observed first");
  assert.ok(at("targeting.noteMyLegacyThread(m, entry, myUserId);") < feed,
    "and the legacy-thread registry is recorded ahead of the route too");
  // …and the page drain still AWAITS that dispatch, so a trigger's consent + spawn keeps
  // serializing ahead of the next message in the page (it used to be inline; C-3 moved the
  // per-page loop out of channel-listener.js and into drainPage, beside the dispatch it
  // gates the cursor on — the transport loop now only asks "was the page finished?").
  assert.match(LISTENER, /deferred = await dispatchMessage\(entry, m, myUserId\);/);
  assert.match(LOOP, /await messages\.drainPage\(entry, msgs, myUserId\)/);
});

test("the post-classify branch is plain: trigger, fyi, task-reply, and no route among them", () => {
  // ⚠ NEW PIN, AND IT REPLACES A DELETED ONE (2026-08-20, F-228). Route (5),
  // `maybeReopenAddressedThread`, ran HERE — inside the 'trigger' branch, diverting a peer's
  // follow-up into the window that had answered it rather than raising a second consent card
  // beside it. It is deleted with the window, so every 'trigger' reaches `handleTrigger`,
  // which is what the route fell through to on every miss anyway. What the old pin protected
  // is the thing worth keeping: NOTHING may sit between the verdict and the action, because a
  // route there can divert a message classify already decided.
  assert.match(LISTENER, /if \(verdict === 'trigger'\) return trigger\.handleTrigger\(entry, m\);/);
  assert.match(LISTENER, /if \(verdict === 'fyi'\) trigger\.sendFyi\(entry, m\);/);
  assert.ok(!/maybeReopenAddressedThread/.test(LISTENER), "no post-classify route survives");
});

test("a 'task-reply' verdict reaches the passive notifier, with no consent or spawn", () => {
  // ⚠ AND ONLY WHEN IT @-TAGS ME (2026-08-18, wiring plan Phase 7) — OR A HUMAN TYPED IT
  // (2026-08-20 review: the widened suppression removed its consent card, and a person's
  // addressed words must not become invisible; agent replies stay mention-gated). The
  // conjunct is asserted IN this pin rather than beside it, because the wiring and its gate
  // are one statement: a future edit that drops the gate would otherwise satisfy a pin
  // written before it existed.
  assert.match(
    LISTENER,
    /else if \(verdict === 'task-reply' && \(m\.authorKind === 'user' \|\| targeting\.mentionsMe\(m, myUserId\)\)\) taskNotify\.notifyTaskReply\(entry, m\);/
  );
  // The passive path is exactly that: no consent row, no watcher record, no spawn. The
  // strongest available pin is the module's DEPENDENCY set — it cannot reach the consent,
  // spawner or engine machinery because it does not require any of it.
  const NOTIFY = M("task-notify.js");
  const deps = [...NOTIFY.matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]).sort();
  assert.deepEqual(deps, ["./diag", "./listener-io", "./targeting", "electron"],
    "task-notify reaches nothing that could spawn, gate or record a consent");
  // D2 added a SECOND passive verdict on the same module, 'agent-escalation', with the agent
  // handle resolved by the CALLER and passed in precisely so the dependency set above could
  // not grow. It is gone with named agents (channels rollback §1); the DEPENDENCY PIN is what
  // mattered and it still holds.
  assert.ok(!/notifyAgentEscalation/.test(LISTENER), "the escalation dispatch is gone");
});

// ⚠ STATIC PIN 2 STOOD HERE AND IS GONE (2026-08-20, F-228) —
// "with no durable record the gate refuses: recreateParkedShell -> {ok:false} -> false".
//
// It bottomed the claim "a reply about a task nothing on this machine remembers is DECLINED,
// not swallowed" out in three source lines: `session-park.recreateParkedShell` answering
// `{ ok: false }` for an absent record, `session-gate.feedInboundForTask` turning that into
// `false`, and `session-dispatch.maybeSurfaceRequesterReply` returning the gate's verdict
// verbatim with nothing in between. All three are deleted: route (3) with the window it
// gated, and both engine entry points with it.
//
// ⚠ WHAT IT PROTECTED IS NOW TRUE BY CONSTRUCTION, which is the only reason it is safe to
// drop rather than repoint. The pin existed because a route stood between the reply and
// classify and could have claimed it while being unable to show it anywhere. There is no such
// route: `feedLiveSession` is the only one left, it claims a message ONLY when a live session
// for that exact (channel, task) exists AND the author is its bound counterparty, and the
// behavioral tests below drive that miss end-to-end to the banner.

// ── The behavioral mirror ────────────────────────────────────────────────────────

const BEGIN = "// ─── BEGIN SESSION-DISPATCH-PURE";
const END = "// ─── END SESSION-DISPATCH-PURE";
const from = DISPATCH.indexOf(BEGIN);
const to = DISPATCH.indexOf(END);
assert.ok(from !== -1 && to > from, "SESSION-DISPATCH-PURE sentinels missing");
const BLOCK = DISPATCH.slice(from, to);

// classify / metaStr are private in targeting.js — brace-balance them out (the
// classify.test.mjs idiom) so the mirror runs the REAL verdict logic.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(start, i);
}
// classify also calls the LEGACY-THREADS registry, which carries module state and so is
// sliced whole between its sentinels rather than brace-balanced out function by function.
const LEGACY = LEGACY_SRC.slice(
  LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
);
assert.ok(LEGACY.includes("function knownLegacyReply"), "LEGACY-THREADS sentinels missing");
// ⚠ classify's TWO free variables come along with it. `isChatIntent` (2026-08-06) and
// `mentionsMe` (2026-08-18) are hoisted out of its body so listener-messages.js could ask the
// same questions; omitting either builds a classify that throws a ReferenceError the moment a
// fixture reaches that line — a red this file would only ever see by accident. ⚠ `mentionsMe`
// was MISSING here until 2026-08-20 and no fixture had reached it; the fixtures below do.
const { classify } = new Function(
  `${extractFn(TARGETING, "metaStr")}\n${LEGACY}\n${extractFn(TARGETING, "isChatIntent")}\n` +
    `${extractFn(TARGETING, "mentionsMe")}\n${extractFn(TARGETING, "classify")}\nreturn { classify };`
)();

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const TASK = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// The listener's loop body, mirrored. Returns everything that happened to one message so a
// test can assert on the WHOLE outcome, not just the route that fired.
function harness(over = {}) {
  const cfg = { live: false, ...over };
  const calls = { feed: [], notifyLocal: [], taskNotify: [], trigger: [], fyi: [], diag: [] };
  // ⚠ FAN-OUT SHAPE (2026-08-21): the route asks for every live agent on the thread. `cfg.live`
  // means "one of my agents is on this thread"; the counterparty fence this used to model was
  // replaced by the thread itself.
  const sessionEngine = {
    liveOnThread: () => (cfg.live ? [{ agentId: "a1b2c3d4", ownPostIds: new Set() }] : []),
    // The tier rule counts the CHANNEL's agents; here that is the same one session.
    agentIdsInChannel: () => (cfg.live ? ["a1b2c3d4"] : []),
    feedInbound: (a) => { calls.feed.push(a); return true; },
  };
  const io = { displayNameFor: (id) => `name:${id}` };
  // 2026-08-01: a fed message is titled with its AUTHOR, which is not the same string as the
  // account's display name when an AGENT wrote the post. The resolver (`authorLabel`) lives
  // inside the sliced block, so it needs no injection.
  // ⚠ THE REAL TIER MODULE (pure), A STUB ROUTER (2026-08-28). This file measures the listener's
  // dispatch ORDER and the OUTCOME of a message nothing on this machine claims, so the wake rule
  // must be the shipped one and the model call must not happen. The stub never claims: an
  // external-requester thread has no dormant agent of mine to wake in the first place.
  const routes = new Function(
    // ⚠ `deliveryAck` joined the block's free vars with the wake ack (2026-09-02, A9). A no-op
    // recorder is enough here: this suite asserts routing, and `delivery-ack.test.mjs` owns
    // the buffer.
    "targeting", "sessionEngine", "io", "wakeTiers", "sessionTriage", "agentHandles", "deliveryAck", "diag",
    `${BLOCK}\n return { feedLiveSession };`
  )(targeting, sessionEngine, io, wakeTiers, { claim: async () => "" }, agentHandles, { note: () => true, verdictFor: () => '' }, () => {});

  // listener-messages.dispatchMessage verbatim in SHAPE (pinned by STATIC PIN 1 above).
  //
  // ⚠ THE CHAT GUARD IS NO LONGER PART OF THAT SHAPE. This mirror carried one — `const chat =
  // targeting.isChatIntent(m); if (!chat) { …routes 2, 3… }` — because a mirror MORE PERMISSIVE
  // than prod is how a dispatcher divergence stays green here (found by audit 2026-08-07). The
  // guard is deleted from prod with the two session-STARTING routes it guarded, so carrying it
  // now would make the mirror STRICTER than prod instead — the same failure, mirrored.
  // test/chat-never-starts-a-session.test.mjs owns that contract and evaluates the REAL
  // dispatchMessage source for it.
  async function dispatch(entry, m) {
    if (await routes.feedLiveSession(entry, m, ME)) return "feedLiveSession";
    const verdict = classify(m, entry, ME);
    if (verdict === "trigger") calls.trigger.push(m);
    else if (verdict === "fyi") calls.fyi.push(m);
    // ⚠ THE NOTICE GATE IS PART OF THE SHAPE TOO (2026-08-18 Phase 7, widened 2026-08-20), for
    // the same reason: without it this mirror would be MORE PERMISSIVE than prod and every
    // "the operator gets the banner" assertion below would stay green against a listener that
    // had stopped sending it. ⚠ The `authorKind === 'user'` half was MISSING from this mirror
    // until 2026-08-20, making it stricter than prod for a HUMAN-typed reply — restated here
    // byte-for-byte off the pin above.
    else if (verdict === "task-reply" && (m.authorKind === "user" || targeting.mentionsMe(m, ME))) calls.taskNotify.push(m);
    return `classify:${verdict}`;
  }
  return { dispatch, calls, cfg };
}

const entry = { channel: { id: "c1", name: "General", memberCount: 2, isMember: true }, workspaceId: "w1" };

// My own thread-opening message. `runtime` is the ONE difference between the two
// runtimes: the server stamps it only for a session this app spawned.
const createMsg = (runtime) => ({
  kind: "message", seq: 41, authorUserId: ME, authorKind: "agent", body: "please look at X",
  metadata: {
    taskId: TASK, taskMode: "interactive", taskCreatedBy: ME, taskTarget: PEER, to_user_id: PEER,
    ...(runtime ? { runtime } : {}),
  },
});

// The peer's agent replying in that thread — the message that must not get lost.
//
// ⚠ IT CARRIES THE SERVER'S MENTION STAMP (2026-08-18, wiring plan Phase 7), because the
// BANNER is what most of this file asserts and an AGENT's reply is mention-gated. The verdict is
// not: `classify` still answers 'task-reply' either way, which is what stops the reply
// spawning a counter-session, and `replyUntagged` below is the fixture that proves the two
// halves came apart cleanly rather than the gate having eaten the routing.
const replyMsg = () => ({
  kind: "message", seq: 42, authorUserId: PEER, authorKind: "agent", body: "here is the answer",
  metadata: {
    taskId: TASK, taskMode: "interactive", taskCreatedBy: ME, taskTarget: PEER, to_user_id: ME,
    mentionedUserIds: [ME],
  },
});

const replyUntagged = () => {
  const m = replyMsg();
  const metadata = { ...m.metadata };
  delete metadata.mentionedUserIds;
  return { ...m, metadata };
};

test("EXTERNAL create: nothing is started, and nothing else fires either", async () => {
  const h = harness();
  assert.equal(await h.dispatch(entry, createMsg(null)), "classify:ignore");
  assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length, h.calls.taskNotify.length], [0, 0, 0]);
  assert.equal(h.calls.feed.length, 0, "no session on this machine to feed my own create to");
  assert.equal(h.calls.notifyLocal.length, 0, "and no local notice for my own message");
});

test("a DESKTOP-STAMPED create now starts nothing either — that IS the retirement", async () => {
  // ⚠ THE INVERSION, RECORDED (2026-08-20, F-228). A test stood in this position asserting the
  // OPPOSITE — "DESKTOP-spawned create still launches its requester window (the gate is not a
  // mute)" — and it was the control that proved the runtime gate was a discriminator rather
  // than a blanket refusal. Route (2) is deleted, so the discrimination is gone and both
  // stamps land in the same place. The stamp itself is untouched and `requesterTaskOpen`
  // still reads it (test/operator-typed-request.test.mjs owns that table); what changed is
  // that nothing on this machine acts on the answer.
  for (const runtime of ["desktop-session", "desktop-ui", null]) {
    const h = harness();
    assert.equal(await h.dispatch(entry, createMsg(runtime)), "classify:ignore", String(runtime));
    assert.deepEqual([h.calls.feed.length, h.calls.trigger.length, h.calls.fyi.length], [0, 0, 0]);
  }
});

test("EXTERNAL reply: no session, no record -> the PASSIVE notification, not a swallow", async () => {
  const h = harness({ live: false });
  await h.dispatch(entry, createMsg(null)); // the external create, ignored as above
  assert.equal(await h.dispatch(entry, replyMsg()), "classify:task-reply");
  assert.equal(h.calls.taskNotify.length, 1, "the operator gets the silent banner");
  assert.equal(h.calls.taskNotify[0].seq, 42);
  // The reply reaches the EXTERNAL agent through its own armed await; this machine must
  // not have spawned or gated anything on its behalf.
  assert.equal(h.calls.feed.length, 0, "no live session to feed");
  assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length], [0, 0], "no consent prompt either");
});

test("EXTERNAL reply that tags NOBODY: still routed as a task-reply, but silent", async () => {
  // The Phase 7 half. The verdict — and therefore the SUPPRESSION that keeps this reply from
  // looking like a fresh request — is unchanged; only the banner is gone. This is the case the
  // policy is aimed at: an agent answering in a thread, turn after turn, with nothing in it
  // the operator has to act on. The reply still reaches the EXTERNAL agent through its own
  // armed await, and the Tags inbox still records the thread on the web.
  const h = harness({ live: false });
  assert.equal(await h.dispatch(entry, replyUntagged()), "classify:task-reply");
  assert.equal(h.calls.taskNotify.length, 0, "no per-message banner for untagged thread traffic");
  assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length, h.calls.feed.length], [0, 0, 0]);

  // …and the 2026-08-20 counter-rule, in the same breath: a HUMAN's untagged reply DOES
  // banner. Same verdict, same absent tag, different author kind.
  const human = harness({ live: false });
  const typed = { ...replyUntagged(), authorKind: "user" };
  assert.equal(await human.dispatch(entry, typed), "classify:task-reply");
  assert.equal(human.calls.taskNotify.length, 1, "a person's addressed words are never invisible");
});

test("a DESKTOP-owned thread is unaffected: a live session still eats the reply", async () => {
  // The counter-case that proves the passive path is a FALLBACK, not the new default:
  // when this machine does own the session, the reply is still fed to it.
  // ⚠ THE SECOND HALF OF THIS TEST IS GONE — "a settled-but-recorded desktop thread still
  // reopens and gates it", route (3), which reopened the settled window at its inbound gate.
  // A settled thread now takes the passive path above, exactly like the external one.
  const live = harness({ live: true });
  assert.equal(await live.dispatch(entry, replyMsg()), "feedLiveSession");
  assert.equal(live.calls.feed.length, 1);
  assert.equal(live.calls.taskNotify.length, 0, "a fed reply must not ALSO banner");

  const settled = harness({ live: false });
  assert.equal(await settled.dispatch(entry, replyMsg()), "classify:task-reply");
  assert.equal(settled.calls.taskNotify.length, 1, "settled now means the banner, like external");
});

test("the runtime stamp cannot be forged by the peer into anything on my machine", async () => {
  // A counterparty stamping runtime on THEIR message changes nothing: `requesterTaskOpen`
  // still requires the message to be MINE and the task to be mine, and the peer's reply
  // classifies 'task-reply' either way. (The stamp is server-written anyway; this pins that
  // the gate is an AND, not a shortcut.)
  // ⚠ REPOINTED (2026-08-20): the old reading was "and no window was launched". There is no
  // launch to count, so the predicate is asked DIRECTLY — it is untouched and still exported —
  // alongside the verdict the message actually gets.
  const h = harness();
  const forged = { ...replyMsg(), metadata: { ...replyMsg().metadata, runtime: "desktop-session" } };
  assert.equal(targeting.requesterTaskOpen(forged, ME), false, "a peer's create, stamp or not");
  assert.equal(await h.dispatch(entry, forged), "classify:task-reply");
  assert.equal(h.calls.feed.length, 0, "and no live session claims it");
});

// ⚠ THE FIX-L3 DIAG BLOCK STOOD HERE AND IS GONE (2026-08-20, F-228). Two tests —
// "a create refused ONLY by the runtime stamp says so in the diag" and "the L3 diag fires ONLY
// for the runtime conjunct, never for the others".
//
// They pinned `diagRuntimeGateSkip`, a helper of route (2): the runtime refusal was the one
// gate rejection with NO other symptom (every other conjunct describes a message that was
// never mine to drive), so a server that stopped stamping — version skew — would silently
// stop opening desktop requester windows with nothing in the logs. The diag named the stamp it
// actually saw, `(absent)` or the wrong value verbatim, which is what distinguished skew from
// a genuine external create.
//
// ⚠ THE SYMPTOM IT WATCHED FOR NO LONGER EXISTS, which is why this is an excision and not a
// loss. Nothing opens a requester window on any stamp, so there is no behaviour for a missing
// stamp to silently switch off. `desktopRuntime` / `requesterTaskOpen` survive untouched and
// their truth table is test/operator-typed-request.test.mjs; what is gone is the ROUTE that
// read the answer, and with it the only thing skew could have broken quietly.
