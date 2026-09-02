// THE TOOL NAME IN THE PROMPT MUST BE THE ONE IN THE AGENT'S TOOL LIST (incident 2026-08-01).
//
// THE DEFECT, and it cost three live runs. main/tool-profiles.js has always granted
// `mcp__dopl__dopl_channel` — the CLI namespaces every MCP tool as `mcp__<server>__<tool>` —
// while the PROMPT (main/prompt-framing.js, main/session-seed.js) told the agent to use the
// bare name `dopl_channel`, which is only what the dopl MCP server registers internally. So the
// grants worked, the tool was right there, and the agent searched its list for a name that was
// not in it. Two agents in one run answered the same way: "I have no dopl_channel tool and
// can't post", declared a hard blocker, and stopped until a human told them to look again.
//
// THE COMPOUNDING HALF. Claude Code DEFERS MCP tool schemas in a session with many tools: the
// tool appears as a NAME in a system-reminder list and cannot be invoked until `ToolSearch`
// loads its schema. Nothing in the prompt said so, so even spotting the qualified name could
// still read as "present but unavailable".
//
// FIX F3 (the fix that did not take). The first attempt DID state that, as a conditional aside
// at the BOTTOM of the delivery section: "If mcp__dopl__dopl_channel is not in your tool list
// yet…". It shipped in 1.7.19 and an agent still posted "CONFIRMED: I do not have the
// mcp__dopl__dopl_channel tool" 64 seconds into its session, through that very tool — a
// condition reads as agreement to an agent that has already concluded the tool is missing. The
// line is now an ORDER at the TOP of the turn, which is what the ordering assertions below pin.
//
// FIX F7 rides in the same block: a fresh responder spawn gets no thread history at all, so its
// SECOND action is the thread-scoped `op "read"`.
//
// WHAT IS PINNED HERE, over EVERY composed agent-facing turn this app builds:
//   1. no BARE `dopl_channel` occurrence survives anywhere — every one is preceded by
//      `mcp__dopl__`. Same rule for every other dopl tool the prompt might ever name.
//   2. the qualified name IS present (a regex that only forbids cannot notice a prompt that
//      stopped naming the tool at all).
//   3. the ToolSearch order is there, once, imperative, and ABOVE the delivery section.
//   4. a responder that knows its thread is told to read it before it answers.
// The modules are dependency-free, so this drives the REAL text that ships.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const framing = require("../main/prompt-framing.js");
const seed = require("../main/session-seed.js");

const CH = "aaaaaaaa-1111-4bbb-8ccc-dddddddddddd";
const WS = "bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee";
const TASK = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const AGENT = "11111111-2222-3333-4444-555555555555";

// A `dopl_*` tool named WITHOUT the `mcp__dopl__` prefix the agent's list actually carries.
// Lookbehind, so it catches the bare name in prose as well as in a call example.
const BARE = /(?<!mcp__dopl__)\bdopl_(channel|map|members|kb|skill|search|ontology|workflow|cluster|chats)\b/;

const ctx = (over = {}) => ({
  channelName: "Ops",
  authorName: "Alice",
  channelId: CH,
  workspaceId: WS,
  agentName: "quartz",
  ownerName: "Samuel",
  ...over,
});

// EVERY shape of first / continuation turn this app can hand an agent. A shape added later and
// not listed here is the hole this suite exists to close, so the list is deliberately exhaustive
// rather than representative: both ASSIST sides, the TEAM turn, the id-less degradations, the
// milestone line, and both session-seed wrappers.
function everyTurn() {
  const turns = [];
  for (const side of ["responder", "requester"]) {
    for (const over of [{}, { taskId: TASK }, { agentId: AGENT }, { channelId: "" }, { workspaceId: null }]) {
      turns.push([
        `${side} ${JSON.stringify(over)}`,
        framing.buildFencedTurn({ side, message: "do the thing", nonce: "n1", context: ctx(over) }),
      ]);
    }
  }
  // A THIRD SHAPE used to be swept here: `buildTeamTurn`, the room-bound TEAM session's first
  // turn. It went with summoning (channels rollback §1), so the two ASSIST sides are every
  // composed turn there is.
  turns.push(["milestones", framing.milestoneGuidance({ hasPostingTool: true })]);
  turns.push(["continuation", seed.frameContinuation("n3", "here is the answer", "David")]);
  turns.push(["history seed", seed.frameHistorySeed("n4", "David: morning\nYou: on it")]);
  return turns;
}

// The turns that TEACH DELIVERY, and must therefore name the tool. Only the history seed does
// not: it is fenced context for a fresh shell and rides ahead of a turn that does.
function teachingTurns() {
  return everyTurn().filter(([label]) => label !== "history seed");
}

test("no composed turn names a dopl tool WITHOUT its mcp__dopl__ prefix", () => {
  for (const [label, turn] of everyTurn()) {
    const hit = BARE.exec(turn);
    assert.equal(hit, null,
      `${label}: the prompt names a tool the agent's list does not contain: ${JSON.stringify(hit && hit[0])}\n${turn}`);
  }
});

test("…and the QUALIFIED name really is stated, in every turn that teaches delivery", () => {
  // The forbidding half above passes vacuously if the tool stops being named at all.
  for (const [label, turn] of teachingTurns()) {
    assert.ok(turn.includes("mcp__dopl__dopl_channel"), `${label}: names the channel tool by its real name`);
  }
});

// The first line of the delivery section, in each of its two voices. FIRST ACTIONS has to sit
// ABOVE this, which is the whole of FIX F3: the old text was appended to the section's four
// branches, so it could only ever be read after them.
const DELIVERY = /Deliver every message to the peer|DELIVERY: post your reply/;

// EVERY DELIVERY BRANCH: both sides with the concrete call, and both degraded to the id-less
// wording. The room-bound turn was a third branch and is gone (channels rollback §1).
function deliveryBranches() {
  const out = [];
  for (const side of ["responder", "requester"]) {
    for (const over of [{}, { taskId: TASK }, { channelId: "" }, { workspaceId: null }]) {
      out.push([
        `${side} ${JSON.stringify(over)}`,
        framing.buildFencedTurn({ side, message: "x", nonce: "n5", context: ctx(over) }),
      ]);
    }
  }
  return out;
}

// FIX F3b (2026-08-04) RE-TARGETS THIS TEST, and the re-target is the finding. F3's ORDER was
// `ToolSearch("select:mcp__dopl__dopl_channel")` — a tool `session-profiles.js` HARD-DENIES on
// all three profiles, so the first imperative of every session was a call that comes back
// "Blocked for this session". F3 was written for `attended-prompt.js`, which runs in the
// operator's own unconstrained Claude Code and keeps it correctly; copying it here made the
// prompt order something the containment table forbids. The prompt/profile join is pinned in
// `prompt-profile-drift.test.mjs`.
//
// WHAT STAYS PINNED is what F3 was really protecting: the reporting rule (the #345 sentence),
// its imperative voice, and its ORDER in the turn — all of which survive the lookup's removal.
test("FIX F3b: FIRST ACTIONS states the GRANT, once, and ABOVE the delivery section", () => {
  for (const [label, out] of deliveryBranches()) {
    // No denied call is ordered. The generalized version of this is the drift suite.
    assert.ok(!/ToolSearch/.test(out), `${label}: orders a tool every session profile denies`);
    assert.ok(!/If mcp__dopl__dopl_channel is not in your tool list/.test(out), `${label}: the aside is gone`);
    // IMPERATIVE, never a condition an agent that already decided can read as agreement.
    assert.match(out, /mcp__dopl__dopl_channel is GRANTED to this session/, `${label}: states the grant`);
    assert.match(out, /that is the list, not the grant/, `${label}: names the real state of the tool`);
    assert.match(out, /never report that you have no dopl tools at all/, `${label}: forbids the #345 sentence`);
    // ORDER, which is the half the first fix got wrong.
    const first = out.indexOf("FIRST ACTIONS THIS TURN");
    assert.ok(first >= 0, `${label}: the block is in the turn`);
    const delivery = out.search(DELIVERY);
    assert.ok(delivery > 0, `${label}: found the delivery section`);
    assert.ok(first < delivery, `${label}: FIRST ACTIONS precedes the delivery section`);
    assert.ok(first < out.indexOf("VOCABULARY"), `${label}: and the vocabulary too`);
  }
});

test("FIX F7: a responder that knows its thread is ordered to READ it before it answers", () => {
  const out = framing.buildFencedTurn({ side: "responder", message: "x", nonce: "f7", context: ctx({ taskId: TASK }) });
  assert.match(out, /Your SECOND action is to read the exchange you are joining/, "stated as an order too");
  assert.ok(
    out.includes(`with op "read", channel "${CH}", workspace "${WS}", thread "${TASK}"`),
    `the whole scoped call, ids and all:\n${out}`
  );
  assert.match(out, /filtered to this one thread/, "says the read is scoped, not the whole channel");
  assert.match(out, /none of its earlier messages/, "and why a fresh spawn needs it at all");
  assert.equal(out.split('op "read"').length - 1, 1, "one read instruction");
  assert.ok(out.indexOf('op "read"') < out.indexOf('op "send", channel "'), "read first, then deliver");
  // A LEGACY `task-<channel>-<seq>` id threads posts, so it filters a read the same way.
  const legacy = framing.buildFencedTurn({
    side: "responder", message: "x", nonce: "f7", context: ctx({ taskId: `task-${CH}-42` }),
  });
  assert.ok(legacy.includes(`thread "task-${CH}-42"`), "legacy ids seed too");
  assert.equal(legacy.split('op "read"').length - 1, 1, "still once");
});

test("FIX F7: no thread (or a half-known address) prints no read, and the requester never does", () => {
  const shapes = [{}, { taskId: "" }, { taskId: null }, { taskId: TASK, channelId: "" }, { taskId: TASK, workspaceId: null }];
  for (const over of shapes) {
    const label = JSON.stringify(over);
    const out = framing.buildFencedTurn({ side: "responder", message: "x", nonce: "f7b", context: ctx(over) });
    assert.ok(!out.includes('op "read"'), `${label}: never a half-addressed read`);
    assert.ok(!/SECOND action/.test(out), `${label}: and no orphan step`);
    assert.ok(!/undefined|null/.test(out), `${label}: no placeholder leaks`);
    assert.match(out, /mcp__dopl__dopl_channel is GRANTED to this session/, `${label}: the grant line still rides alone`);
  }
  // The requester OPENED this thread and has been driving it; it is not the session with a hole.
  const req = framing.buildFencedTurn({ side: "requester", message: "x", nonce: "f7c", context: ctx({ taskId: TASK }) });
  assert.ok(!req.includes('op "read"'), "no seed for the side that already has the thread");
  assert.match(req, /mcp__dopl__dopl_channel is GRANTED to this session/, "but it still gets the grant line");
});

test("the granted identifier and the taught identifier are the SAME string", () => {
  // The two halves of the bug lived in two files that never referenced each other:
  // tool-profiles.js was right and the prompt was wrong, and nothing failed when they disagreed.
  const { DOPL_CHANNEL_TOOL } = require("../main/tool-profiles.js");
  assert.equal(DOPL_CHANNEL_TOOL, "mcp__dopl__dopl_channel", "the grant identifier is unchanged");
  for (const [label, turn] of teachingTurns()) {
    assert.ok(turn.includes(DOPL_CHANNEL_TOOL), `${label}: teaches exactly what the profile grants`);
  }
});
