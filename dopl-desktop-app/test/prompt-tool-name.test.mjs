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
// WHAT IS PINNED HERE, over EVERY composed agent-facing turn this app builds:
//   1. no BARE `dopl_channel` occurrence survives anywhere — every one is preceded by
//      `mcp__dopl__`. Same rule for every other dopl tool the prompt might ever name.
//   2. the qualified name IS present (a regex that only forbids cannot notice a prompt that
//      stopped naming the tool at all).
//   3. the ToolSearch line is there, and says the two things it has to say.
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
  for (const over of [{}, { taskId: TASK, agentId: AGENT }, { channelId: "" }]) {
    turns.push([
      `team ${JSON.stringify(over)}`,
      framing.buildTeamTurn({ message: "the room says hello", nonce: "n2", context: ctx(over) }),
    ]);
  }
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

test("the DEFERRED-SCHEMA hint is present, once, and says both halves", () => {
  for (const side of ["responder", "requester"]) {
    const out = framing.buildFencedTurn({ side, message: "x", nonce: "n5", context: ctx() });
    assert.match(out, /load it with ToolSearch/, `${side}: the recovery action is named`);
    assert.ok(out.includes('("select:mcp__dopl__dopl_channel")'), `${side}: the exact query to run`);
    assert.match(out, /Never report that you have no\nchannel tool without doing that first\./,
      `${side}: and the failure it forbids`);
    // ONE copy. This prompt is long and a repeated instruction costs attention everywhere else.
    assert.equal(out.split("load it with ToolSearch").length - 1, 1, `${side}: stated exactly once`);
  }
  const team = framing.buildTeamTurn({ message: "x", nonce: "n6", context: ctx({ agentId: AGENT }) });
  assert.match(team, /load it with ToolSearch/, "a room-bound agent needs it just as much");
  assert.equal(team.split("load it with ToolSearch").length - 1, 1, "team: stated exactly once");
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
