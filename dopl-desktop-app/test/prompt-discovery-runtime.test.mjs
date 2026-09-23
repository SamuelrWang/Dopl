// CXP-3A — THE FIRST-ACTIONS BLOCK IS RUNTIME-AWARE (2026-09-22).
//
// THE DEFECT. `prompt-framing.js › firstActions` was shared by every runtime and told the agent
// "do not go looking for it and do not test for it". That is right for Claude, whose Dopl entry
// carries `alwaysLoad` and whose profiles deny `ToolSearch`. It is WRONG for Codex: codex-cli
// 0.155.1 defers EVERY MCP tool behind a client-executed `tool_search`, so the channel tool is
// not in the initial list at all. A spawned Codex agent reported `mcp__dopl__dopl_channel`
// unavailable and, told to search, QUOTED that sentence as its reason to refuse.
//
// WHAT IS PINNED:
//   1. Claude's turn is BYTE-IDENTICAL with and without the new context field.
//   2. Codex's turn orders the measured verb and carries NO "do not go looking / test for it".
//   3. Both keep the rule that a genuinely missing mount is REPORTED, not hidden.
//   4. The verb comes from the descriptor (`capability.mcpDiscoveryVerb`), and the two turn
//      builders' callers hand it through from the SESSION's runtime.
//   5. The Codex order is not a call a restricted Codex profile denies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const framing = require("../main/prompt-framing.js");
const seed = require("../main/session-seed.js");
const runtime = require("../main/runtime");
const codexTools = require("../main/runtime/codex/tools.js");

const CH = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const BASE = { channelId: CH, workspaceId: WS, taskId: TASK, channelName: "ops", profile: "dopl_only" };
const verbFor = (id) => runtime.capability.mcpDiscoveryVerb(runtime.descriptorFor(id));
const turn = (side, extra) => framing.buildFencedTurn({ side, message: "goal", context: { ...BASE, ...extra }, nonce: "n0nce" });

const FORBIDDEN = [/do not go looking for it/, /do not\s+test for it/, /if it is not in a list you can enumerate/];

test("the descriptor answers: Codex searches with `tool_search`; Claude and Cursor order nothing", () => {
  assert.equal(verbFor("codex"), "tool_search");
  assert.equal(verbFor("claude"), null, "Claude has ToolSearch but Dopl's entry is alwaysLoad");
  assert.equal(verbFor("cursor"), null, "unmeasured runtime keeps the existing wording");
  assert.equal(verbFor(null), null, "absent runtime = the default adapter");
});

for (const side of ["requester", "responder"]) {
  test(`${side}: Claude's wording is BYTE-IDENTICAL with the field present`, () => {
    const before = turn(side, {});
    assert.equal(turn(side, { mcpDiscovery: verbFor("claude") }), before);
    assert.equal(turn(side, { mcpDiscovery: null }), before);
    assert.match(before, /so do not go looking for it and do not\n {2}test for it: if it is not in a list you can enumerate/);
    assert.match(before, /If mcp__dopl__dopl_channel is not in your tool list, say so in your first reply: the\n {2}desktop failed to connect Dopl\./);
    assert.equal(/tool_search/.test(before), false);
  });

  test(`${side}: Codex is ORDERED to search and told nothing that contradicts it`, () => {
    const t = turn(side, { mcpDiscovery: verbFor("codex") });
    for (const re of FORBIDDEN) assert.equal(re.test(t), false, `contradiction survived: ${re}`);
    assert.match(t, /Dopl's tools are DEFERRED/);
    assert.match(t, /call `tool_search` with the query "dopl channel"/);
    assert.match(t, /that IS mcp__dopl__dopl_channel/);
    assert.match(t, /That search is the\s+normal way in, not a test/);
    // 3. a genuinely missing mount is still REPORTED.
    assert.match(t, /If it does not return the tool, say so in your first reply:\s+the desktop failed to connect Dopl\./);
    // The discovery order sits in FIRST ACTIONS, above the delivery section.
    const first = t.indexOf("FIRST ACTIONS THIS TURN");
    assert.ok(first !== -1 && t.indexOf("tool_search") > first);
    assert.ok(t.indexOf("tool_search") < t.indexOf("BEGIN-REQUEST-n0nce"), "above the fenced body");
    // The grant sentence and the op-scope rule are unchanged around it.
    assert.match(t, /mcp__dopl__dopl_channel is GRANTED to this session, and OP-SCOPED by your posture/);
    assert.match(t, /Just make the call in the delivery section below/);
  });
}

test("the verb is DATA from the caller, never free text: a non-identifier is dropped to Claude's wording", () => {
  const before = turn("responder", {});
  for (const bad of ["tool search", "x`); rm -rf", "", 42, {}, "BEGIN-REQUEST-n0nce"]) {
    assert.equal(turn("responder", { mcpDiscovery: bad }), before, JSON.stringify(bad));
  }
});

test("5: the Codex order names no tool a restricted Codex profile denies, and no call shape", () => {
  for (const profile of ["read_only", "dopl_only", "channel_agent", "full"]) {
    const denied = codexTools.buildSessionToolConfig(profile).disallowedTools;
    assert.equal(denied.includes("tool_search"), false, `${profile} denies the ordered verb`);
  }
  assert.equal(/tool_search\(/.test(turn("requester", { mcpDiscovery: "tool_search" })), false);
});

test("4: the lazy wake builder hands through the SESSION's runtime", () => {
  const shell = (runtimeId) => ({
    freshFraming: true, side: "responder", context: { ...BASE }, profile: "dopl_only",
    nonce: "n0nce", launchGoal: "goal", runtimeId,
  });
  const codex = seed.withSeed(shell("codex"), "next");
  assert.match(codex, /call `tool_search` with the query "dopl channel"/);
  for (const re of FORBIDDEN) assert.equal(re.test(codex), false);
  const claude = seed.withSeed(shell("claude"), "next");
  assert.match(claude, /do not go looking for it/);
  assert.equal(/tool_search/.test(claude), false);
  const absent = seed.withSeed(shell(undefined), "next");
  assert.match(absent, /do not go looking for it/, "a record with no runtime is the default's");
});
