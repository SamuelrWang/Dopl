// D2 — THE ADDRESSING LAW, as classify() actually implements it.
//
// Multiplayer adds two rules to the targeting classifier and both of them move in the same
// direction: LESS spawning, never more.
//
//   1. ADDRESSING REQUIRED WHILE MY AGENTS ARE PRESENT. The implicit 2-member trigger (a DM
//      where anything a person says is for me) is DISABLED while this operator has team
//      agents in the channel. Explicit addressing still triggers — that is the whole point:
//      address to act.
//   2. AGENT -> HUMAN IS AN ESCALATION. An agent that addresses ME, the person, produces a
//      NOTIFICATION and never a spawn. Answering a question meant for a human with another
//      machine's agent is exactly the loop the law forbids.
//
// And the pre-multiplayer LOOP BRAKE has to survive both: an UNADDRESSED agent-authored
// message still triggers nobody, at any member count, with or without agents present.
//
// METHOD: the repo's source-extraction idiom (test/classify.test.mjs). targeting.js is
// CommonJS and `classify` is private, so the real definitions are read out of the source and
// evaluated verbatim — a rule that changes in prod changes here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "main", "targeting.js"), "utf8");

function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found in targeting.js`);
  let depth = 0;
  let i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}" && --depth === 0) {
      i++;
      break;
    }
  }
  return SRC.slice(start, i);
}

function extractBlock(begin, end) {
  const a = SRC.indexOf(begin);
  const b = SRC.indexOf(end);
  assert.notEqual(a, -1, `block sentinel ${begin} not found`);
  assert.ok(b > a, `block sentinel ${end} not found after ${begin}`);
  return SRC.slice(a, b);
}
const LEGACY = extractBlock("// ─── BEGIN LEGACY-THREADS", "// ─── END LEGACY-THREADS");

const build = () =>
  new Function(
    `${extractFn("metaStr")}\n${LEGACY}\n${extractFn("classify")}\n` +
      `return { classify };`
  )();

const ME = "me-uuid";
const PEER = "peer-uuid";
const AGENT_ROW = "agent-uuid-1"; // a channel_agents id, not a user id

// A DM (exactly two members) — the only shape where the implicit trigger ever fired.
const dm = (over = {}) => ({
  channel: { id: "c1", name: "Ops", memberCount: 2, isMember: true, ...over },
  ...(over.teamAgents === undefined ? {} : { teamAgents: over.teamAgents }),
});
const entryWith = (teamAgents, over = {}) => ({
  channel: { id: "c1", name: "Ops", memberCount: 2, isMember: true, ...over },
  teamAgents,
});
const msg = (over = {}) => ({ kind: "message", authorUserId: PEER, authorKind: "user", seq: 5, body: "hi", ...over });

// ── 1. addressing required while my agents are in the room ───────────────────────

test("with NO team agents the implicit 2-member trigger is exactly what it was", () => {
  const { classify } = build();
  assert.equal(classify(msg(), dm(), ME), "trigger", "no field at all");
  assert.equal(classify(msg(), entryWith(0), ME), "trigger", "an explicit zero");
});

test("while MY team agents are present an UNADDRESSED human message triggers NOBODY", () => {
  const { classify } = build();
  const verdict = classify(msg(), entryWith(1), ME);
  assert.equal(verdict, "fyi", "the room is notified, and nothing spawns");
  assert.notEqual(verdict, "trigger");
  // More agents does not change it, and neither does an odd/negative count that reads truthy.
  assert.equal(classify(msg(), entryWith(4), ME), "fyi");
});

test("EXPLICIT addressing still triggers with agents present — that is the whole rule", () => {
  const { classify } = build();
  const addressed = msg({ metadata: { to_user_id: ME } });
  assert.equal(classify(addressed, entryWith(3), ME), "trigger");
  assert.equal(classify(addressed, entryWith(0), ME), "trigger", "and it is unchanged without them");
});

test("a junk teamAgents value can only ever read as ZERO (it cannot silently mute a DM)", () => {
  const { classify } = build();
  for (const junk of [undefined, null, "", "two", NaN, {}, []]) {
    assert.equal(classify(msg(), entryWith(junk), ME), "trigger", JSON.stringify(junk));
  }
});

test("the mute + the agent rule compose: 'none' scope still wins, and neither invents a trigger", () => {
  const { classify } = build();
  assert.equal(classify(msg(), entryWith(0, { myNotifyScope: "none" }), ME), "ignore");
  assert.equal(classify(msg(), entryWith(2, { myNotifyScope: "none" }), ME), "fyi");
});

// ── 2. the loop brake, unchanged in every combination ────────────────────────────

test("LOOP BRAKE: an UNADDRESSED agent message triggers nobody, agents present or not", () => {
  const { classify } = build();
  const agentMsg = msg({ authorKind: "agent" });
  for (const n of [0, 1, 5]) {
    assert.equal(classify(agentMsg, entryWith(n), ME), "fyi", `teamAgents=${n}`);
  }
  // …and in a 3+ member channel, with an author_agent_id on it, it is STILL not a trigger.
  const named = msg({ authorKind: "agent", metadata: { author_agent_id: AGENT_ROW } });
  assert.equal(classify(named, entryWith(2, { memberCount: 5 }), ME), "fyi");
});

// ── 3. agent -> human escalation ─────────────────────────────────────────────────

test("an AGENT addressing me as a HUMAN is an escalation: notify, never spawn", () => {
  const { classify } = build();
  const escalation = msg({ authorKind: "agent", metadata: { to_user_id: ME, author_agent_id: AGENT_ROW } });
  assert.equal(classify(escalation, entryWith(0), ME), "agent-escalation");
  assert.equal(classify(escalation, entryWith(3), ME), "agent-escalation", "unaffected by my own roster");
  // It is NOT the trigger it used to be, which is the behavior change.
  assert.notEqual(classify(escalation, entryWith(0), ME), "trigger");
});

test("a message for MY AGENT is NOT an escalation, even though the owner bridge names me", () => {
  const { classify } = build();
  // THE OWNER BRIDGE (service-writes-metadata.ts): addressing an agent also stamps
  // to_user_id = that agent's OWNER, so this message names me as the user AND names an
  // agent. It belongs to the agent, so classify must not turn it into a human escalation.
  // (The agent route in channel-agents.js claims it before classify ever runs; the verdict
  // here is the fallback for when that route refuses.)
  const forMyAgent = msg({
    authorKind: "agent",
    metadata: { to_user_id: ME, to_agent_id: AGENT_ROW, author_agent_id: "their-agent" },
  });
  assert.equal(classify(forMyAgent, entryWith(1), ME), "trigger");
});

test("a HUMAN addressing me is never an escalation (no author_agent_id -> today's trigger)", () => {
  const { classify } = build();
  const human = msg({ metadata: { to_user_id: ME } });
  assert.equal(classify(human, entryWith(2), ME), "trigger");
  // An agent author with no stamped agent id is a pre-multiplayer agent: unchanged.
  const legacyAgent = msg({ authorKind: "agent", metadata: { to_user_id: ME } });
  assert.equal(classify(legacyAgent, entryWith(2), ME), "trigger");
});

test("an escalation aimed at SOMEBODY ELSE is not mine to be notified about", () => {
  const { classify } = build();
  const forPeer = msg({
    authorKind: "agent",
    metadata: { to_user_id: "third-uuid", author_agent_id: AGENT_ROW },
  });
  assert.equal(classify(forPeer, entryWith(1), ME), "fyi");
});

// ── 3b. FIX S1: in a DIRECT channel `to_user_id` is not evidence of anything ─────

test("S1: a peer AGENT's ordinary post in a DM is NOT an escalation", () => {
  const { classify } = build();
  // The server auto-addresses every post in a direct channel (service-writes-metadata
  // resolvePostMetadata falls back to the resolved direct peer), and a team session always
  // posts as_agent — so this shape IS an ordinary reply, not somebody asking for a human.
  // It used to satisfy all four escalation conjuncts and fire a NON-silent "needs you"
  // notification per message, with copy that was simply false.
  const ordinary = msg({ authorKind: "agent", metadata: { to_user_id: ME, author_agent_id: AGENT_ROW } });
  const direct = entryWith(0, { isDirect: true });
  assert.notEqual(classify(ordinary, direct, ME), "agent-escalation");
  // It falls through to the addressed rule, i.e. today's consent-gated handling, unchanged.
  assert.equal(classify(ordinary, direct, ME), "trigger");
});

test("S1: the SAME message in a GROUP channel is still an escalation", () => {
  const { classify } = build();
  // In a non-direct channel `to_user_id` is stamped only from an explicit address, so it IS
  // the evidence the rule needs. The fix narrows the rule; it does not remove it.
  const escalation = msg({ authorKind: "agent", metadata: { to_user_id: ME, author_agent_id: AGENT_ROW } });
  assert.equal(classify(escalation, entryWith(1, { memberCount: 5 }), ME), "agent-escalation");
  assert.equal(classify(escalation, entryWith(1, { isDirect: false }), ME), "agent-escalation");
  for (const junk of [undefined, null, 0, "", "true", 1]) {
    assert.equal(classify(escalation, entryWith(1, { isDirect: junk }), ME), "agent-escalation",
      `only an exact boolean true is a direct channel: ${JSON.stringify(junk)}`);
  }
});

test("S1: a task-reply in a DM is still claimed BEFORE any of this (no regression)", () => {
  const { classify } = build();
  const reply = msg({
    authorKind: "agent",
    metadata: {
      to_user_id: ME, taskId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", taskMode: "interactive",
      taskCreatedBy: ME, taskTarget: PEER, author_agent_id: AGENT_ROW,
    },
  });
  assert.equal(classify(reply, entryWith(0, { isDirect: true }), ME), "task-reply");
});

// ── 4. the verdicts are WIRED, behaviorally, through the real dispatch body ──────
// This used to be a set of greps over listener-messages.js, which is exactly the kind of
// probe that survives a semantic break: deleting a `return` (double-dispatching a message
// into two outcomes) left every regex matching. The dispatch body is now EXTRACTED and RUN
// with fakes, so what is pinned is the outcome, not the text.

const LISTENER = readFileSync(join(HERE, "..", "main", "listener-messages.js"), "utf8");

// `dispatchMessage` is an `async function`, so the `async` keyword has to come along or the
// `await`s inside it are a syntax error in the evaluated scope.
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

// The REAL dispatch body, driven with fakes for its five module-top requires. Every outcome
// is recorded, so a test can assert on the WHOLE result of one message rather than on the
// one branch it expected to fire.
function dispatcher(cfg = {}) {
  const calls = { routed: [], feed: [], open: [], surface: [], trigger: [], fyi: [], reply: [], escalate: [], dismissed: [], diag: [] };
  const { classify } = build();
  const api = new Function(
    "versionSkew", "channelAgents", "sessionDispatch", "targeting", "trigger", "taskNotify", "diag",
    `${extractAsyncFn(LISTENER, "dispatchMessage")}\n return { dispatchMessage };`
  )(
    { observe: () => {} },
    {
      routeAddressedAgent: async (e, m) => { calls.routed.push(m.seq); return cfg.routed === undefined ? "" : cfg.routed; },
      handleFor: () => cfg.handle || "quartz",
    },
    {
      feedLiveSession: (e, m) => { calls.feed.push(m.seq); return cfg.live === true; },
      maybeOpenRequesterSession: async (e, m) => { calls.open.push(m.seq); return false; },
      maybeSurfaceRequesterReply: async (e, m) => { calls.surface.push(m.seq); return false; },
    },
    { classify, metaStr: (m, k) => (m && m.metadata && typeof m.metadata[k] === "string" ? m.metadata[k].trim() : "") },
    { handleTrigger: async (e, m) => calls.trigger.push(m.seq), sendFyi: (e, m) => calls.fyi.push(m.seq) },
    {
      notifyTaskReply: (e, m) => calls.reply.push(m.seq),
      notifyAgentEscalation: (e, m, handle) => calls.escalate.push({ seq: m.seq, handle }),
      notifyAgentDismissed: (e, m, handle) => calls.dismissed.push({ seq: m.seq, handle }),
    },
    (...a) => calls.diag.push(a.join(" "))
  );
  return { dispatch: (e, m) => api.dispatchMessage(e, m, ME), calls };
}

const listenerEntry = (over = {}) => ({
  channel: { id: "cccccccc-1111-2222-3333-444444444444", name: "Ops", memberCount: 5, isMember: true, ...over },
  workspaceId: "ws-1", rosterKnown: true, teamAgents: 1,
});

test("an escalation reaches the passive notifier and NOTHING else fires", async () => {
  const d = dispatcher();
  const escalation = msg({ authorKind: "agent", metadata: { to_user_id: ME, author_agent_id: AGENT_ROW } });
  await d.dispatch(listenerEntry(), escalation);
  assert.deepEqual(d.calls.escalate, [{ seq: 5, handle: "quartz" }], "named, off the authenticated roster");
  assert.deepEqual([d.calls.trigger, d.calls.fyi, d.calls.reply], [[], [], []], "no consent, no spawn, no other banner");
});

test("the agent route CLAIMS a message: no other route or verdict sees it", async () => {
  // The double-dispatch guard. Dropping the `return` after routeAddressedAgent used to leave
  // every static probe green while the message ALSO ran the live-session feed and classify.
  const d = dispatcher({ routed: "fed" });
  const addressed = msg({ metadata: { to_user_id: ME, to_agent_id: AGENT_ROW } });
  await d.dispatch(listenerEntry(), addressed);
  assert.deepEqual(d.calls.routed, [5], "addressing is checked FIRST");
  assert.deepEqual(d.calls.feed, [], "…and it short-circuits the thread-keyed live-session feed");
  assert.deepEqual([d.calls.open, d.calls.surface], [[], []]);
  assert.deepEqual([d.calls.trigger, d.calls.fyi, d.calls.escalate, d.calls.dismissed], [[], [], [], []]);
});

test("S2: a REFUSED agent message starts nothing — it never reaches classify -> trigger", async () => {
  // Without the fix this exact message classified 'trigger' (the owner bridge stamps
  // to_user_id = me), so a refusal produced a consent card and a pair ASSIST spawn.
  const d = dispatcher({ routed: "refused" });
  const addressed = msg({ metadata: { to_user_id: ME, to_agent_id: AGENT_ROW } });
  await d.dispatch(listenerEntry(), addressed);
  assert.deepEqual(d.calls.trigger, [], "no consent card, no spawn");
  assert.deepEqual([d.calls.feed, d.calls.fyi, d.calls.dismissed], [[], [], []]);
});

test("S2: a DISMISSED agent's message starts nothing and produces the passive notice", async () => {
  const d = dispatcher({ routed: "dismissed" });
  const addressed = msg({ metadata: { to_user_id: ME, to_agent_id: AGENT_ROW } });
  await d.dispatch(listenerEntry(), addressed);
  assert.deepEqual(d.calls.dismissed, [{ seq: 5, handle: "quartz" }]);
  assert.deepEqual([d.calls.trigger, d.calls.feed, d.calls.fyi], [[], [], []], "retired means retired");
});

test("an EMPTY verdict is the only one that falls through to the ordinary dispatch", async () => {
  const d = dispatcher({ routed: "" });
  await d.dispatch(listenerEntry({ memberCount: 2 }), msg({ metadata: { to_user_id: ME } }));
  assert.deepEqual(d.calls.feed, [5], "the routes below still run");
  assert.deepEqual(d.calls.trigger, [5], "and the verdict is reached");
});

test("B1: dispatch says so when the law is evaluated against an UNREAD roster", async () => {
  const d = dispatcher({ routed: "" });
  const unread = { channel: { id: "cccccccc-1111-2222-3333-444444444444", name: "Ops", memberCount: 2, isMember: true }, rosterKnown: false, teamAgents: 2 };
  await d.dispatch(unread, msg());
  assert.ok(d.calls.diag.some((l) => l.includes("UNKNOWN roster") && l.includes("last known teamAgents 2")));
  // …and the seeded count is what the law actually used: an unaddressed DM message with
  // agents believed present is FYI, not the pre-multiplayer 'trigger'.
  assert.deepEqual([d.calls.trigger, d.calls.fyi], [[], [5]]);
});
