// CHAT MAY BE SEEN BY A LIVE SESSION; IT MAY NEVER START ONE.
//
// ⚠ HALF OF THIS FILE IS AN EXCISION (2026-08-20, F-228), AND THE HALF THAT WENT IS THE HALF
// THE TITLE NAMES. See the block below: the two session-STARTING routes were deleted, and the
// CHAT BRAKE that guarded them was deleted with them. What is left is the asymmetry's LIVE
// side — chat may be SEEN by a session that is already running — plus the fall-through that
// was always the subtler half of the contract.
//
// THE BUG THIS ONCE PINNED (found live 2026-08-06, by a two-agent probe in a real DM). The chat
// brake lived ONLY inside `targeting.classify`, which is the LAST thing `dispatchMessage`
// runs. Three session routes short-circuited ahead of it and none of them had ever heard of
// `intent` — `grep -c intent` was 0 in both `listener-messages.js` and `session-dispatch.js`.
// So `intent="chat"` was true of the spawn path and false of the routes, and a peer's chat
// line could open a requester window (route 2) or REOPEN A SETTLED SESSION (route 3).
//
// THE OPERATOR'S RULE, and the reason this file asserted an asymmetry rather than a blanket
// refusal: chat may be SEEN by a session that is already running (route 1 feeds it), and may
// never bring one INTO existence. A test that refused both would pass against a stricter
// product than the one that was asked for, so route 1 is asserted POSITIVELY here — if
// somebody later "fixes" chat by silencing route 1 too, this fails. ⚠ THAT IS NOW THE WHOLE
// LOAD THIS FILE CARRIES ON THE ROUTING SIDE, and it is why the file is rewritten rather than
// removed: route 1 is unguarded on purpose, and a positive pin is the only thing standing
// between "deliberately ungated" and "somebody assumed it was an oversight".
//
// AND THE FALL-THROUGH IS PART OF THE CONTRACT. Chat from a member THAT @-TAGS ME classifies
// as 'fyi', which drives `trigger.sendFyi` — the notification the human actually sees. The
// first draft of the 2026-08-06 fix was `if (chatIntent(m)) return`, which would have silenced
// chat entirely: a worse bug than the one being fixed, and invisible to any test that only
// checked the routes. ⚠ THAT RISK OUTLIVED THE ROUTES. Chat still reaches classify, and an
// early return on chat is still the wrong fix — so this half is asserted unchanged.
// ⚠ THE TAG QUALIFIER ARRIVED 2026-08-18 (wiring plan Phase 7) and it does NOT retire the
// contract — it moves which fixture demonstrates it. Untagged chat classifies 'ignore' now, so
// a test that only used untagged chat would go green against the very `return` this file
// exists to forbid. The tagged line is the one that can still tell the difference.
//
// WHY A STUB ROUTE: the real route needs live session state to fire at all, which would make
// this a test about `session-engine` rather than about dispatch ORDER. The stub records
// whether it was REACHED, which is exactly the thing that regressed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const LISTENER = readFileSync(join(HERE, "..", "main", "listener-messages.js"), "utf8");

// The REAL targeting module — `isChatIntent` and `classify` as shipped, not a copy.
const targeting = require("../main/targeting.js");

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

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const CHAN = "dba90694-1111-4222-8333-444444444444";

/** The real `dispatchMessage`, with the one surviving route replaced by a recorder. */
function harness({ feedTakes = false } = {}) {
  const seen = { feed: 0, trigger: [], fyi: [], taskNotify: [] };
  // ⚠ ONE KEY, NOT FIVE. This object used to carry `maybeOpenRequesterSession`,
  // `maybeSurfaceRequesterReply`, `maybeReopenAddressedThread` and `noteRequestLifecycle`
  // beside it. session-dispatch.js exports `{ feedLiveSession }` and nothing else now, so a
  // stub for any of the others would be a fake the product cannot call — which is exactly how
  // a mirror drifts into asserting a dispatcher that no longer exists.
  const sessionDispatch = {
    feedLiveSession: () => { seen.feed += 1; return feedTakes; },
  };
  const { dispatchMessage } = new Function(
    "versionSkew", "sessionDispatch", "targeting", "trigger", "taskNotify", "diag",
    `${extractAsyncFn(LISTENER, "dispatchMessage")}\n return { dispatchMessage };`
  )(
    { observe: () => {} },
    sessionDispatch,
    targeting,
    {
      handleTrigger: async (e, m) => seen.trigger.push(m.seq),
      sendFyi: (e, m) => seen.fyi.push(m.seq),
    },
    { notifyTaskReply: (e, m) => seen.taskNotify.push(m.seq) },
    () => {}
  );
  return { dispatchMessage, seen };
}

const entry = () => ({
  channel: { id: CHAN, name: "Direct message", memberCount: 2, isMember: true },
  workspaceId: "ws",
});

/** A peer-authored post. `intent` omitted entirely is a REQUEST, which is the control. */
const msg = (over = {}) => ({
  id: "m1",
  seq: 100,
  body: "hi",
  kind: "message",
  authorKind: "user",
  authorUserId: PEER,
  metadata: {},
  ...over,
});

const chat = (over = {}) => msg({ metadata: { intent: "chat" }, ...over });

test("chat IS still offered to an already-live session (the operator's rule)", async () => {
  const { dispatchMessage, seen } = harness();
  await dispatchMessage(entry(), chat(), ME);
  assert.equal(seen.feed, 1, "feedLiveSession was skipped — chat may be SEEN by a running session");
});

test("a live session consuming chat short-circuits, exactly as for a request", async () => {
  const { dispatchMessage, seen } = harness({ feedTakes: true });
  await dispatchMessage(entry(), chat(), ME);
  assert.equal(seen.feed, 1);
  // ⚠ REPOINTED, NOT WEAKENED. This used to read `seen.open === 0` — route 2 never reached —
  // which measured the short-circuit through a route that no longer exists. The short-circuit
  // itself is unchanged and is now measured where it still shows: a message route 1 claimed
  // never reaches classify, so no verdict is dispatched for it.
  assert.deepEqual([seen.fyi, seen.trigger, seen.taskNotify], [[], [], []],
    "a message a live session took must not also notify, trigger or banner");
});

test("chat still reaches classify, and a chat line that @-tags me still notifies the human", async () => {
  // THE REGRESSION THE OBVIOUS FIX WOULD HAVE CAUSED. An early `return` on chat would leave
  // this at 0 and silence chat completely.
  //
  // ⚠ RE-AIMED 2026-08-18 (wiring plan Phase 7), NOT WEAKENED. The notification is now
  // MENTION-GATED, so the fixture that proves chat still reaches the notifier has to be a chat
  // line that TAGS me — which is also the case the policy names explicitly (human-to-human
  // mentions notify, in a DM as in a channel). Untagged chat is asserted silent right below,
  // and the two together are what "reaches classify" means now: an early return would kill the
  // first, and a missing gate would break the second.
  const taggedChat = chat({ metadata: { intent: "chat", mentionedUserIds: [ME] } });
  const h = harness();
  await h.dispatchMessage(entry(), taggedChat, ME);
  assert.deepEqual(h.seen.fyi, [100], "a chat line tagging me must still produce the notification");
  assert.deepEqual(h.seen.trigger, [], "chat must never trigger, tagged or not");

  const quiet = harness();
  await quiet.dispatchMessage(entry(), chat(), ME);
  assert.deepEqual(quiet.seen.fyi, [], "untagged chat raises no banner — the retired per-message notice");
  assert.deepEqual(quiet.seen.trigger, []);
});

test("only the exact string is chat — a padded or cased variant is a REQUEST", async () => {
  // Matches the server's enum rather than being lenient: `isChatIntent` reads raw, so ' chat'
  // and 'Chat' are not the marker. Fails toward today's behaviour.
  //
  // ⚠ REPOINTED (2026-08-20). The reading used to be `seen.open === 1` — a near-miss intent
  // reached the session-STARTING route — and that route is deleted. The PREDICATE is untouched
  // (`targeting.isChatIntent`, still read by classify), so the same truth table is driven
  // through the surviving reader: an ADDRESSED post whose intent is not the exact string is a
  // request and TRIGGERS; the exact string does not. The fixture had to gain `to_user_id`,
  // because an unaddressed post classifies 'ignore' either way and would make this vacuous.
  for (const intent of [" chat", "Chat", "CHAT", "request", undefined]) {
    const { dispatchMessage, seen } = harness();
    const metadata = intent === undefined ? { to_user_id: ME } : { intent, to_user_id: ME };
    await dispatchMessage(entry(), msg({ metadata }), ME);
    assert.deepEqual(seen.trigger, [100], `intent=${JSON.stringify(intent)} was treated as chat`);
  }
  // THE CONTROL, and it is load bearing: without it "every near miss triggers" would also hold
  // for a build that had lost the chat brake entirely.
  const { dispatchMessage, seen } = harness();
  await dispatchMessage(entry(), msg({ metadata: { intent: "chat", to_user_id: ME } }), ME);
  assert.deepEqual(seen.trigger, [], "the exact marker still triggers nobody, addressed or not");
});

// ⚠ THREE TESTS STOOD BELOW AND ARE GONE (2026-08-20, F-228). All three measured the CHAT
// BRAKE — `const chat = targeting.isChatIntent(m); if (!chat) { …routes 2, 3… }` — and the
// brake is deleted because everything it guarded is:
//
//   "chat does NOT reach either session-STARTING route"
//       Pinned that `maybeOpenRequesterSession` (route 2, which minted a REQUESTER WINDOW) and
//       `maybeSurfaceRequesterReply` (route 3, which REOPENED A SETTLED SESSION at its inbound
//       gate) were both skipped for a chat post. Both routes are deleted.
//   "THE CONTROL: an otherwise identical REQUEST does reach both starting routes"
//       The anti-vacuity control for the above. It measured the same two deleted routes; its
//       surviving half — an ADDRESSED peer request triggers — is now the control inside "only
//       the exact string is chat" above, where it does the same job.
//   "the guard sits between route 1 and route 2 in the shipped source"
//       An indexOf ordering pin over `feedLiveSession` < `isChatIntent` < the two routes.
//       There is no guard and no route 2 to order it against.
//
// ⚠ THIS IS A DELETION, NOT A RELAXATION, and the difference matters if anyone reads the brake
// as a safety net that was removed. The brake existed because routes 2 and 3 could claim a
// peer's chat line and bring a session INTO existence BEFORE classify's own chat brake ran.
// Route 1 was DELIBERATELY above the brake and is unguarded for the same reason it always was:
// it feeds a session that is ALREADY RUNNING, which is "seen", not "started". classify's chat
// brake — the original one, `targeting.classify`'s `isChatIntent` branch — is untouched and is
// now the only one, which is where this file's remaining assertions read it.
