// D2 — THE ARRIVAL. What `/new-agent` actually does now: it posts ONE canned message.
//
// WHAT IS PINNED HERE, in the order the summon happens:
//   CANNED     the greeting is a CONSTANT. No room is read, no turn is run, no window opens,
//              nothing is spent. The operator cut the read-the-room turn the first cut ran
//              ("we don't need to do a first turn"), so the ABSENCE of a spawn is the
//              behaviour under test, not an implementation detail.
//   THE HANDLE it names the handle, because the arrival message is the ONLY place the room
//              is told what to type to address this agent.
//   ONE POST   exactly one channel message, authored as the agent (top-level authorAgentId,
//              which is the only thing the server will stamp `metadata.author_agent_id`
//              from), and UNADDRESSED — which is what the loop brake reads.
//   THE DM     the one channel shape where the server addresses the post for us, and what
//              the greeting does about it. LOAD-BEARING: verified against the REAL classify,
//              not against a copy of its rules.
//   RETRY      a failed post is a retryable skip, and the id is deterministic so the retry
//              cannot double-greet.
//
// METHOD: the session-team / session-dispatch idiom. The SESSION-GREETING-PURE block is
// sliced and driven with fakes for its module-top requires (channelPost, framing, diag), so
// the truth table drives the REAL shipped policy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "session-greeting.js"), "utf8");
const TARGETING = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");
// §2 SPLIT (2026-07-31): the LEGACY-THREADS registry classify calls into moved to its own
// module when targeting.js went past the 500-line cap. classify's body did not change.
const LEGACY_SRC = readFileSync(join(HERE, "..", "main", "legacy-threads.js"), "utf8");
const FRAMING = readFileSync(join(HERE, "..", "main", "prompt-framing.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN SESSION-GREETING-PURE");
const to = SRC.indexOf("// ─── END SESSION-GREETING-PURE");
if (from === -1 || to === -1 || to <= from) throw new Error("SESSION-GREETING-PURE sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

test("the sliced block is host-free: no require, no electron, no fs", () => {
  for (const banned of ["require(", "electron", "fs.", "child_process"]) {
    assert.ok(!BLOCK.includes(banned), `SESSION-GREETING-PURE must not reference ${banned}`);
  }
});

// THE REVERSAL, ASSERTED AGAINST THE SOURCE ITSELF. A greeting that quietly regained a spawn
// would still pass every behavioural test below if a fake spawner were reintroduced with it,
// so the module is ALSO pinned to have no spawn lane and no room read at all.
test("the module runs NO turn and reads NO room: the apparatus is gone, not disabled", () => {
  for (const gone of [
    "session-spawner", "runForChannel", "budgetUsd", "timeoutMs", "toolProfile",
    "buildGreetingPrompt", "cleanGreeting", "roomLines", "fetchRoomLines", "listener-io", "apiFetch",
  ]) {
    assert.ok(!SRC.includes(gone), `session-greeting.js must not reference ${gone} any more`);
  }
});

const CH = "chan-1";
const AGENT = "agent-1";
const ME = "me-uuid";

function harness(cfg = {}) {
  const calls = { posted: [], diag: [] };
  const channelPost = {
    postAgentMessage: async (entry, a) => {
      calls.posted.push({ entry, ...a });
      return cfg.postFails !== true;
    },
  };
  // The REAL sanitizer, so the name rules the greeting relies on are the shipped ones.
  const framing = new Function(
    `${fnOf(FRAMING, "stripFenceTokens")}\n${fnOf(FRAMING, "sanitizeName")}\n return { sanitizeName };`
  )();
  const diag = (...a) => calls.diag.push(a.join(" "));

  const api = new Function(
    "channelPost", "framing", "diag",
    `${BLOCK}\n return { greet, cannedGreeting, directAddressee, greetingMsgId };`
  )(channelPost, framing, diag);
  return { ...api, calls };
}

const spec = (over = {}) => ({
  channelId: CH, workspaceId: "ws-1", agentId: AGENT, agentName: "quartz",
  ownerName: "Samuel", channelName: "Ops", ownerUserId: ME, agentStamp: "2026-07-31T10:00:00.000Z",
  ...over,
});

// ── 1. the arrival lands, once, as the agent, and says nothing clever ──────────

test("a summon posts EXACTLY ONE channel message, attributed to the agent, unaddressed", async () => {
  const h = harness();
  const res = await h.greet(spec());
  assert.deepEqual(res, { greeted: true }, "no `fallback` flag: there is no other branch to report");
  assert.equal(h.calls.posted.length, 1, "one arrival, not one per anything");
  const post = h.calls.posted[0];
  assert.equal(post.agentId, AGENT, "authorAgentId is the TOP-LEVEL field the server stamps from");
  assert.equal(post.toUserId, "", "UNADDRESSED: the loop brake is what keeps this from triggering anybody");
  assert.equal(post.text, "@quartz here. How can I help?", "THE greeting, verbatim");
  assert.equal(post.entry.channel.id, CH);
  assert.equal(post.entry.workspaceId, "ws-1");
});

test("the greeting is the SAME string whatever the room has been saying", async () => {
  // The property the operator asked for, stated as a test: nothing about the channel, the
  // owner or the moment can change what is posted. Only the handle can.
  const a = harness();
  await a.greet(spec({ channelName: "Ops", ownerName: "Samuel" }));
  const b = harness();
  await b.greet(spec({ channelName: "A totally different room", ownerName: "David", direct: true }));
  assert.equal(a.calls.posted[0].text, b.calls.posted[0].text);
});

test("the greeting names the handle, and degrades honestly when it has none", () => {
  const h = harness();
  assert.equal(h.cannedGreeting("quartz"), "@quartz here. How can I help?");
  assert.equal(h.cannedGreeting(""), "This agent is here. How can I help?");
  assert.equal(h.cannedGreeting(null), "This agent is here. How can I help?");
  assert.ok(!h.cannedGreeting("quartz").includes("—"), "product copy carries no em dash");
  // A handle is caller-controlled text, so it goes through the shared sanitizer like any
  // other name — a summoner cannot smuggle a new line into the room through it.
  assert.equal(h.cannedGreeting("quartz\nsecond line"), "@quartz second line here. How can I help?");
});

test("the message id is deterministic per (channel, agent, row stamp), so a retry cannot double-post", async () => {
  const h = harness();
  assert.equal(h.greetingMsgId(spec()), `agent-greeting-${CH}-${AGENT}-20260731T100000000Z`);
  assert.equal(h.greetingMsgId(spec()), h.greetingMsgId(spec()), "same row, same id: the server dedupes a retry");
  assert.notEqual(
    h.greetingMsgId(spec({ agentStamp: "2026-08-01T09:00:00.000Z" })),
    h.greetingMsgId(spec()),
    "a row summoned again carries a new stamp, so it greets again instead of deduping into silence"
  );
  assert.equal(h.greetingMsgId(spec({ agentStamp: "" })), `agent-greeting-${CH}-${AGENT}`, "a DTO with no stamp still keys");
  const posted = harness();
  await posted.greet(spec());
  assert.equal(posted.calls.posted[0].clientMsgId, posted.greetingMsgId(spec()), "…and it is what the post carries");
});

// ── 2. the failure surface, which is now exactly one thing ─────────────────────

test("only a failed POST leaves the room quiet, and it is a retryable skip", async () => {
  const h = harness({ postFails: true });
  assert.deepEqual(await h.greet(spec()), { skipped: "post-failed" });
  assert.ok(h.calls.diag.some((d) => d.includes("stays summoned")), "…and the log says why the row stays put");
});

test("a summon with no channel or no agent is refused before it posts anything", async () => {
  const h = harness();
  assert.deepEqual(await h.greet(spec({ channelId: "" })), { skipped: "disabled" });
  assert.deepEqual(await h.greet(spec({ agentId: "" })), { skipped: "disabled" });
  assert.equal(h.calls.posted.length, 0);
});

// ── 3. the loop brake, verified against targeting.classify itself ──────────────
// LOAD-BEARING AND UNCHANGED BY THE CANNING. The arrival is still an agent-authored post,
// so it is still the message that must not start anything on anybody's machine.

test("the greeting triggers NOBODY on the receiving side: classify says 'fyi', never 'trigger'", () => {
  const classify = loadClassify();
  const greeting = {
    kind: "message", authorKind: "agent", authorUserId: "peer-uuid", seq: 7,
    body: "@quartz here. How can I help?",
    metadata: {}, // UNADDRESSED — no to_user_id, no to_agent_id
  };
  // A 2-member channel is the WORST case for the brake: it is the one shape where an
  // unaddressed message can imply a target at all.
  const two = { channel: { id: CH, memberCount: 2, isMember: true } };
  assert.equal(classify(greeting, two, ME), "fyi", "an UNADDRESSED agent post can never trigger");
  assert.equal(classify(greeting, { channel: { id: CH, memberCount: 5, isMember: true } }, ME), "fyi");
  assert.equal(classify({ ...greeting, authorUserId: ME }, two, ME), "ignore", "and my own arrival is nothing at all");
  // The escalation branch needs an addressee too, so a greeting is not one of those either.
  assert.notEqual(classify(greeting, two, ME), "agent-escalation");
});

test("the DM shape: the greeting names the summoner, and classify reads that as noise", () => {
  // In a DIRECT channel the server stamps `to_user_id` from the resolved peer whenever the
  // caller named nobody, so an unaddressed arrival would land on the peer's machine looking
  // exactly like a fresh addressed request -> 'trigger' -> a consent card and a counter
  // session. directAddressee names the SUMMONER instead, and an agent id supplements the
  // author rather than replacing it, so the post is authored BY the person it names.
  const h = harness();
  assert.equal(h.directAddressee(spec({ direct: true })), ME);
  assert.equal(h.directAddressee(spec()), "", "a group channel stays genuinely unaddressed");
  assert.equal(h.directAddressee(spec({ direct: "yes" })), "", "the flag must say DIRECT exactly");
  assert.equal(h.directAddressee(spec({ direct: true, ownerUserId: "" })), "", "and it needs somebody to name");

  const classify = loadClassify();
  const dm = { channel: { id: CH, memberCount: 2, isMember: true, isDirect: true } };
  const selfAddressed = {
    kind: "message", authorKind: "agent", authorUserId: ME, seq: 8, body: "@quartz here. How can I help?",
    metadata: { to_user_id: ME, author_agent_id: AGENT },
  };
  // On the PEER's machine (their id is not ME): to_user_id === the author -> self-addressed noise.
  assert.equal(classify(selfAddressed, dm, "peer-uuid"), "ignore");
  // And the failure this avoids, stated as a fact about the classifier: the SAME message
  // addressed to the peer instead WOULD have triggered a consent card on their machine.
  const autoAddressed = { ...selfAddressed, metadata: { to_user_id: "peer-uuid", author_agent_id: AGENT } };
  assert.equal(classify(autoAddressed, dm, "peer-uuid"), "trigger");
});

test("the DM addressee really is what greet() posts, not just what the helper answers", async () => {
  const h = harness();
  await h.greet(spec({ direct: true }));
  assert.equal(h.calls.posted[0].toUserId, ME);
});

// ── helpers ────────────────────────────────────────────────────────────────────

// The REAL classify, with its LEGACY-THREADS block (it carries module state, so it is
// sliced whole between its sentinels — the classify.test.mjs idiom).
function loadClassify() {
  const legacy = LEGACY_SRC.slice(
    LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
    LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
  );
  assert.ok(legacy.length > 0, "LEGACY-THREADS sentinels missing");
  return new Function(
    `${fnOf(TARGETING, "metaStr")}\n${legacy}\n${fnOf(TARGETING, "classify")}\n return classify;`
  )();
}

// Brace-balanced extraction of a top-level function (the classify.test.mjs idiom).
function fnOf(src, name) {
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
