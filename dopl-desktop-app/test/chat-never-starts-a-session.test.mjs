// CHAT MAY BE SEEN BY A LIVE SESSION; IT MAY NEVER START ONE.
//
// THE BUG THIS PINS (found live 2026-08-06, by a two-agent probe in a real DM). The chat
// brake lived ONLY inside `targeting.classify`, which is the LAST thing `dispatchMessage`
// runs. Three session routes short-circuit ahead of it and none of them had ever heard of
// `intent` — `grep -c intent` was 0 in both `listener-messages.js` and `session-dispatch.js`.
// So `intent="chat"` was true of the spawn path and false of the routes, and a peer's chat
// line could open a requester window (route 2) or REOPEN A SETTLED SESSION (route 3).
//
// THE OPERATOR'S RULE, and the reason this file asserts an asymmetry rather than a blanket
// refusal: chat may be SEEN by a session that is already running (route 1 feeds it), and may
// never bring one INTO existence (routes 2 and 3). A test that refused all three would pass
// against a stricter product than the one that was asked for, so route 1 is asserted
// POSITIVELY here — if somebody later "fixes" chat by silencing route 1 too, this fails.
//
// AND THE FALL-THROUGH IS PART OF THE CONTRACT. Chat from a member classifies as 'fyi', which
// drives `trigger.sendFyi` — the notification the human actually sees. The first draft of the
// fix was `if (chatIntent(m)) return`, which would have silenced chat entirely: a worse bug
// than the one being fixed, and invisible to any test that only checked the routes.
//
// WHY STUB ROUTES: the three real routes need live session state to fire at all, which would
// make this a test about `session-engine` rather than about dispatch ORDER. The stubs record
// whether they were REACHED, which is exactly the thing that regressed.

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

/** The real `dispatchMessage`, with every route replaced by a recorder. */
function harness({ feedTakes = false } = {}) {
  const seen = { feed: 0, open: 0, surface: 0, reopen: 0, trigger: [], fyi: [], taskNotify: [] };
  const sessionDispatch = {
    feedLiveSession: () => { seen.feed += 1; return feedTakes; },
    maybeOpenRequesterSession: async () => { seen.open += 1; return false; },
    maybeSurfaceRequesterReply: async () => { seen.surface += 1; return false; },
    maybeReopenAddressedThread: async () => { seen.reopen += 1; return false; },
    noteRequestLifecycle: () => false,
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

test("chat does NOT reach either session-STARTING route", async () => {
  const { dispatchMessage, seen } = harness();
  await dispatchMessage(entry(), chat(), ME);
  assert.equal(seen.open, 0, "maybeOpenRequesterSession was reached by a chat post");
  assert.equal(seen.surface, 0, "maybeSurfaceRequesterReply was reached by a chat post — it REOPENS a settled session");
});

test("chat IS still offered to an already-live session (the operator's rule)", async () => {
  const { dispatchMessage, seen } = harness();
  await dispatchMessage(entry(), chat(), ME);
  assert.equal(seen.feed, 1, "feedLiveSession was skipped — chat may be SEEN by a running session");
});

test("a live session consuming chat short-circuits, exactly as for a request", async () => {
  const { dispatchMessage, seen } = harness({ feedTakes: true });
  await dispatchMessage(entry(), chat(), ME);
  assert.equal(seen.feed, 1);
  assert.equal(seen.open, 0);
  assert.equal(seen.fyi.length, 0, "a message a live session took must not also notify");
});

test("chat still reaches classify, and still notifies the human", async () => {
  const { dispatchMessage, seen } = harness();
  await dispatchMessage(entry(), chat(), ME);
  // THE REGRESSION THE OBVIOUS FIX WOULD HAVE CAUSED. An early `return` on chat would leave
  // this at 0 and silence chat completely.
  assert.deepEqual(seen.fyi, [100], "chat from a member must still produce the fyi notification");
  assert.deepEqual(seen.trigger, [], "chat must never trigger");
});

test("THE CONTROL: an otherwise identical REQUEST does reach both starting routes", async () => {
  // Without this, "chat reached no route" is free — it would also hold for a dispatcher that
  // reached no route for anything.
  //
  // ⚠ THE CONTROL IS NOW ADDRESSED, and it has to be. It used to rely on the implicit
  // 1:1 trigger — an unaddressed human post in a 2-member channel — which retired
  // 2026-08-18 with the server's DM auto-address. Left unaddressed, this control would
  // classify 'fyi', reach no starting route, and quietly make every assertion above
  // vacuous: the exact failure this test exists to prevent, aimed at itself.
  const { dispatchMessage, seen } = harness();
  await dispatchMessage(entry(), msg({ metadata: { to_user_id: ME } }), ME);
  assert.equal(seen.open, 1, "the control request did not reach maybeOpenRequesterSession");
  assert.equal(seen.surface, 1, "the control request did not reach maybeSurfaceRequesterReply");
  assert.deepEqual(seen.trigger, [100], "an ADDRESSED peer request should trigger");
});

test("only the exact string is chat — a padded or cased variant is a REQUEST", async () => {
  // Matches the server's enum rather than being lenient: `isChatIntent` reads raw, so ' chat'
  // and 'Chat' are not the marker. Fails toward today's behaviour.
  for (const intent of [" chat", "Chat", "CHAT", "request", undefined]) {
    const { dispatchMessage, seen } = harness();
    await dispatchMessage(entry(), msg({ metadata: intent === undefined ? {} : { intent } }), ME);
    assert.equal(seen.open, 1, `intent=${JSON.stringify(intent)} was treated as chat`);
  }
});

test("the guard sits between route 1 and route 2 in the shipped source", async () => {
  // The whole bug was an ORDERING one, and the assertions above would still pass if the guard
  // were moved above feedLiveSession (route 1 would just stop being reached — which the
  // second test catches) or below route 3 (which nothing above catches, because the stubs all
  // return false). Pin the order in the source itself.
  const feed = LISTENER.indexOf("feedLiveSession(entry, m, myUserId)");
  const guard = LISTENER.indexOf("targeting.isChatIntent(m)");
  const open = LISTENER.indexOf("maybeOpenRequesterSession(entry, m, myUserId)");
  const surface = LISTENER.indexOf("maybeSurfaceRequesterReply(entry, m, myUserId)");
  assert.ok(feed !== -1 && guard !== -1 && open !== -1 && surface !== -1, "a dispatch route was renamed");
  assert.ok(feed < guard, "the chat guard must sit AFTER feedLiveSession — chat may be seen by a live session");
  assert.ok(guard < open, "the chat guard must sit BEFORE maybeOpenRequesterSession");
  assert.ok(guard < surface, "the chat guard must sit BEFORE maybeSurfaceRequesterReply");
});
