// THREAD MENTION REACH FIX, STEP 2 (2026-10-29; KB Audits/Thread Mention Reach Audit + Fix).
//
// The server resolves `to=` CHANNEL-wide; this machine fed THREAD-scoped, so an addressee working
// another scope was dropped. Both directions are pinned here, plus the reply framing and the
// outbound tag each direction needs, plus the negative claims (context never widens; prose never
// widens; on-scope behaviour unchanged).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { harness, agent, entry, verdictMsg, ME, THREAD, A1, A2 } from "./_wake-dispatch-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const seed = require(join(HERE, "..", "main", "session-seed.js"));
const tag = require(join(HERE, "..", "main", "session-outbound-tag.js"));

const U = "99999999-2222-4333-8444-555555555555";
const mainAgent = (id) => ({ agentId: id, key: `c1::${id}`, threadId: "", ownPostIds: new Set() });
const threadAgent = (id, t) => ({ agentId: id, key: `c1:${t}:${id}`, threadId: t, ownPostIds: new Set() });

test("thread post → main-room agent: fed under ITS slot, framed from the thread", () => {
  const room = mainAgent(A2);
  const h = harness({ agents: [agent(A1)], channelAgents: [agent(A1), room] });
  const m = verdictMsg("agent", { authorUserId: ME, recipientAgentIds: [A2], threadId: THREAD });
  assert.equal(h.feedLiveSession(entry, m, ME), true);
  assert.equal(h.calls.feedInbound.length, 1, "the on-thread sibling is not fed");
  const c = h.calls.feedInbound[0];
  assert.equal(c.agentId, A2);
  assert.equal(c.threadId, "", "fed under its own main-room slot");
  assert.deepEqual(c.fromScope, { threadId: THREAD });
  assert.equal(c.wake, true);
  assert.deepEqual(c.addressing, { me: true, ids: [A2] });
});

test("main-room post → thread-bound agent: fed, framed from the main room", () => {
  const worker = threadAgent(A1, U);
  const h = harness({ agents: [], channelAgents: [worker] });
  const m = verdictMsg("agent", { authorUserId: ME, recipientAgentIds: [A1], threadId: undefined });
  assert.equal(h.feedLiveSession(entry, m, ME), true);
  const c = h.calls.feedInbound[0];
  assert.equal(c.threadId, U);
  assert.deepEqual(c.fromScope, { threadId: "" });
});

test("context never widens, and prose never does: only the SERVER's to= list crosses scopes", () => {
  const room = mainAgent(A2);
  // unaddressed thread post: the main-room agent hears nothing
  const h1 = harness({ agents: [agent(A1)], channelAgents: [agent(A1), room] });
  h1.feedLiveSession(entry, verdictMsg("thread", { authorUserId: ME }), ME);
  assert.deepEqual(h1.calls.feedInbound.map((c) => c.agentId), [A1]);
  // a server that did not answer (null) widens nothing
  const h2 = harness({ agents: [agent(A1)], channelAgents: [agent(A1), room] });
  h2.feedLiveSession(entry, verdictMsg("agent", { authorUserId: ME, recipientAgentIds: null, body: `@agent-${A2}` }), ME);
  assert.ok(!h2.calls.feedInbound.some((c) => c.agentId === A2));
});

test("an on-scope addressee is unchanged: no fromScope", () => {
  const h = harness({ agents: [agent(A1)] });
  h.feedLiveSession(entry, verdictMsg("agent", { authorUserId: ME, recipientAgentIds: [A1] }), ME);
  assert.equal(h.calls.feedInbound[0].fromScope, undefined);
  assert.equal(h.calls.feedInbound[0].threadId, THREAD);
});

test("reply framing: the call answers WHERE the post was", () => {
  const base = { channelId: "c1", workspaceId: "w1", doplToolSet: undefined };
  const fromThread = seed.replyFor({ ...base, threadId: "" }, "", { threadId: THREAD });
  assert.match(fromThread, new RegExp(`thread "${THREAD}"`));
  const fromRoom = seed.replyFor({ ...base, threadId: U }, ME, { threadId: "" });
  assert.match(fromRoom, /thread "main"/);
  assert.match(fromRoom, new RegExp(`to "${ME}"`));
  assert.deepEqual(seed.originLines(null), []);
  assert.match(seed.originLines({ threadId: THREAD }).join("\n"), new RegExp(`thread="${THREAD}"`));
  assert.match(seed.originLines({ threadId: "" }).join("\n"), /MAIN ROOM/);
});

test("outbound tag: thread=\"main\" is stripped, never tagged over; a foreign thread is left alone", () => {
  const out = tag.threadTagFor({ channel: "c1", thread: "main", to: ME, body: "x" }, U, "stamp-1");
  assert.equal(out.action, "inject");
  assert.equal("thread" in out.input, false);
  assert.equal(out.input.to, ME);
  assert.equal(out.input.client_msg_id, "stamp-1");
  const foreign = tag.threadTagFor({ channel: "c1", thread: THREAD, body: "x" }, U, "stamp-2");
  assert.equal(foreign.action, "conflict", "an explicit other thread is posted as written");
});
