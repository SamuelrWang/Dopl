// CHANNEL TASKS ON THE OWN-CHANNEL OUTBOUND LANE (main/session-own-outbound.js › OWN_CHANNEL_TASK_OPS).
// An agent's task write in its own channel follows the outbound half of the message axis, carries its
// own ALLOW code, and gates everywhere else; the read is on the inbound half.
//
// Run: `node --test dopl-desktop-app/test/session-channel-task.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);
const profiles = require(M("session-profiles.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));
const { canonicalDoplCall } = require(M("mcp-tool-names.js"));

const CH = "ch1";
const decide = (over) => profiles.grantDecision({ profile: "full", channelId: CH, ...over });
const detail = (over) => profiles.grantDecisionDetail({ profile: "full", channelId: CH, ...over });
const TASKS = profiles.OWN_CHANNEL_TASK_OPS.map((key) => {
  const [op, action] = key.split(".");
  return { op, action, task: "t-1" };
});

test("TASK: every action is allowed in the own channel under an outbound posture, and asks otherwise", () => {
  assert.equal(TASKS.length, 8);
  for (const shape of TASKS) {
    for (const channel of [undefined, CH]) {
      const at = (messageMode) => decide({ toolName: DOPL_CHANNEL_TOOL, input: { ...shape, channel }, messageMode });
      assert.equal(at("auto_both"), "allow", `${shape.action} @ auto_both`);
      assert.equal(at("auto_outbound"), "allow", `${shape.action} @ auto_outbound`);
      assert.equal(at("auto_inbound"), "gate", `${shape.action} @ auto_inbound`);
      assert.equal(at("ask"), "gate", `${shape.action} @ ask`);
    }
  }
});

test("TASK: another channel, or a slug, gates in every posture", () => {
  for (const shape of TASKS) {
    for (const channel of ["OTHER", "my-slug"]) {
      for (const messageMode of profiles.MESSAGE_MODES) {
        assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input: { ...shape, channel }, messageMode }), "gate");
      }
    }
  }
});

test("TASK: the diag names its own ALLOW, and the gate codes are a post's", () => {
  for (const shape of TASKS) {
    assert.deepEqual(
      detail({ toolName: DOPL_CHANNEL_TOOL, input: { ...shape, channel: CH }, messageMode: "auto_both" }),
      { decision: "allow", reason: "auto-outbound-task" },
      shape.action,
    );
  }
  const one = { ...TASKS[2], channel: CH };
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: one, messageMode: "ask" }),
    { decision: "gate", reason: "message-approval-required" });
  assert.deepEqual(detail({ toolName: DOPL_CHANNEL_TOOL, input: { ...one, channel: "my-slug" }, messageMode: "auto_both" }),
    { decision: "gate", reason: "cross-channel-post" });
  assert.ok(profiles.GATE_REASONS.includes("auto-outbound-task"));
});

test("TASK: the bare op and an unknown action are not on the lane", () => {
  for (const input of [{ op: "task" }, { op: "task", action: "delete" }, { op: "task", action: 7 }]) {
    assert.equal(profiles.isOwnChannelTask(input, CH), false, JSON.stringify(input));
    assert.equal(decide({ toolName: DOPL_CHANNEL_TOOL, input, messageMode: "auto_both" }), "gate");
  }
});

test("TASK: the granular tool lands on the same lane through the desktop tool table", () => {
  const call = canonicalDoplCall("mcp__dopl__dopl_manage_task", { action: "create", channel: CH, title: "x" });
  assert.deepEqual(call, { name: DOPL_CHANNEL_TOOL, input: { channel: CH, title: "x", op: "task", action: "create_task" } });
  assert.equal(profiles.isOwnChannelTask(call.input, CH), true);
  const read = canonicalDoplCall("mcp__dopl__dopl_get_channel", { action: "tasks", channel: CH });
  assert.equal(profiles.isOwnChannelRead(read.input, CH), true, "the read is on the inbound half");
});
