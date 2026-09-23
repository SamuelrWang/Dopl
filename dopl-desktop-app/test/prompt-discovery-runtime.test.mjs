// CXP-3A — THE FIRST-ACTIONS BLOCK IS RUNTIME-AWARE (2026-09-22).
//
// THE DEFECT. `prompt-framing.js › firstActions` was shared by every runtime and told the agent
// "do not go looking for it and do not test for it". That is right for Claude, whose Dopl entry
// carries `alwaysLoad` and whose profiles deny `ToolSearch`. It is WRONG for Codex: codex-cli
// 0.155.1 defers EVERY MCP tool — behind a client-executed `tool_search` on non-code-mode models,
// and behind `exec`'s `ALL_TOOLS` catalog on `code_mode_only` ones — so the channel tool is not in
// the initial list at all. A spawned Codex agent reported `mcp__dopl__dopl_channel` unavailable
// and, told to search, QUOTED that sentence as its reason to refuse.
//
// WHAT IS PINNED:
//   1. Claude's turn is BYTE-IDENTICAL with and without the new context field.
//   2. Codex's turn names BOTH measured ways in and carries NO "do not go looking / test for it".
//   3. Both keep the rule that a genuinely missing mount is REPORTED, not hidden.
//   4. The answer comes from the descriptor (`capability.mcpDiscovery`), and the lazy wake builder
//      hands it through from the SESSION's runtime.
//   5. The Codex order is not a call a restricted Codex profile denies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { orderOf } from "./helpers/source-probe.mjs";

const require = createRequire(import.meta.url);
const framing = require("../main/prompt-framing.js");
const seed = require("../main/session-seed.js");
const runtime = require("../main/runtime");
const codexTools = require("../main/runtime/codex/tools.js");

const CH = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const BASE = { channelId: CH, workspaceId: WS, taskId: TASK, channelName: "ops", profile: "dopl_only" };
const discFor = (id) => runtime.capability.mcpDiscovery(runtime.descriptorFor(id));
const turn = (side, extra) => framing.buildFencedTurn({ side, message: "goal", context: { ...BASE, ...extra }, nonce: "n0nce" });

const FORBIDDEN = [/do not go looking for it/, /do not\s+test for it/, /if it is not in a list you can enumerate/];

test("the descriptor answers: Codex has two ways in; Claude and Cursor order nothing", () => {
  assert.deepEqual(discFor("codex"), { verb: "tool_search", catalog: "ALL_TOOLS" });
  assert.equal(discFor("claude"), null, "Claude has ToolSearch but Dopl's entry is alwaysLoad");
  assert.equal(discFor("cursor"), null, "nothing is deferred there; the existing wording stands");
  assert.equal(discFor(null), null, "absent runtime = the default adapter");
});

for (const side of ["requester", "responder"]) {
  test(`${side}: Claude's wording is BYTE-IDENTICAL with the field present`, () => {
    const before = turn(side, {});
    assert.equal(turn(side, { mcpDiscovery: discFor("claude") }), before);
    assert.equal(turn(side, { mcpDiscovery: null }), before);
    assert.match(before, /so do not go looking for it and do not\n {2}test for it: if it is not in a list you can enumerate/);
    assert.match(before, /If mcp__dopl__dopl_channel is not in your tool list, say so in your first reply: the\n {2}desktop failed to connect Dopl\./);
    assert.equal(/tool_search|ALL_TOOLS/.test(before), false);
  });

  test(`${side}: Codex is told BOTH ways in and nothing that contradicts them`, () => {
    const t = turn(side, { mcpDiscovery: discFor("codex") });
    for (const re of FORBIDDEN) assert.equal(re.test(t), false, `contradiction survived: ${re}`);
    assert.match(t, /Dopl's tools are DEFERRED/);
    assert.match(t, /call `tool_search` with the query "dopl channel"/);
    assert.match(t, /if your tools run inside `exec`, find it in `ALL_TOOLS` and call tools\.mcp__dopl__dopl_channel there/);
    assert.match(t, /that IS mcp__dopl__dopl_channel, and the lookup is the normal way in, not a test/);
    // 3. a genuinely missing mount is still REPORTED.
    assert.match(t, /If it is not found, say so in your first reply: the desktop failed to connect Dopl\./);
    // In FIRST ACTIONS, above the fenced body; the grant and op-scope rule unchanged around it.
    const first = t.indexOf("FIRST ACTIONS THIS TURN");
    assert.ok(first !== -1 && t.indexOf("tool_search") > first);
    assert.ok(orderOf(t, "tool_search", "BEGIN-REQUEST-n0nce"), "above the fenced body");
    assert.match(t, /mcp__dopl__dopl_channel is GRANTED to this session, and OP-SCOPED by your posture/);
    assert.match(t, /Just make the call in the delivery section below/);
    // No bare `dopl_channel` (the F-139 rule, `prompt-tool-name.test.mjs`).
    assert.equal(/(?<!mcp__dopl__)\bdopl_channel\b/.test(t), false);
  });
}

test("either half alone prints only that half", () => {
  const t1 = turn("responder", { mcpDiscovery: { verb: "tool_search", catalog: null } });
  assert.match(t1, /tool_search/);
  assert.equal(/ALL_TOOLS/.test(t1), false);
  const t2 = turn("responder", { mcpDiscovery: { verb: null, catalog: "ALL_TOOLS" } });
  assert.match(t2, /ALL_TOOLS/);
  assert.equal(/tool_search/.test(t2), false);
});

test("the answer is DATA from the caller, never free text: a non-identifier is dropped to Claude's wording", () => {
  const before = turn("responder", {});
  for (const bad of ["tool_search", { verb: "tool search" }, { verb: "x`); rm -rf" }, { catalog: "A B" },
    { verb: "", catalog: "" }, 42, { verb: "BEGIN-REQUEST-n0nce" }]) {
    assert.equal(turn("responder", { mcpDiscovery: bad }), before, JSON.stringify(bad));
  }
});

test("5: the Codex order names no tool a restricted Codex profile denies", () => {
  for (const profile of ["read_only", "dopl_only", "channel_agent", "full"]) {
    const denied = codexTools.buildSessionToolConfig(profile).disallowedTools;
    for (const name of ["tool_search", "exec"]) assert.equal(denied.includes(name), false, `${profile} denies ${name}`);
  }
  assert.equal(/tool_search\(/.test(turn("requester", { mcpDiscovery: discFor("codex") })), false);
});

test("4: the lazy wake builder hands through the SESSION's runtime", () => {
  const shell = (runtimeId) => ({
    freshFraming: true, side: "responder", context: { ...BASE }, profile: "dopl_only",
    nonce: "n0nce", launchGoal: "goal", runtimeId,
  });
  const codex = seed.withSeed(shell("codex"), "next");
  assert.match(codex, /call `tool_search` with the query "dopl channel"/);
  assert.match(codex, /ALL_TOOLS/);
  for (const re of FORBIDDEN) assert.equal(re.test(codex), false);
  const claude = seed.withSeed(shell("claude"), "next");
  assert.match(claude, /do not go looking for it/);
  assert.equal(/tool_search|ALL_TOOLS/.test(claude), false);
  const absent = seed.withSeed(shell(undefined), "next");
  assert.match(absent, /do not go looking for it/, "a record with no runtime is the default's");
});
