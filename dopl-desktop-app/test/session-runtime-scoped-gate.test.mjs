// Gate decisions that must be asked in the SESSION runtime's own words, not the default runtime's.
//
// 1. The own-machine lanes (launch / direct / manage) admit a call at the runtime's WIDEST Axis-A
//    mode. They compared to the literal `bypass`, so a Codex session (widest `never`) never could.
// 2. An "Allow for this task" edit grant is scoped by the runtime's own edit-tool names.
//
// The real modules, driven through `grantDecision` with the args `session-io.js › grantArgs` builds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);

const profiles = require(M("session-profiles.js"));
const runtime = require(M("runtime/index.js"));
const { DOPL_CHANNEL_TOOL } = require(M("tool-profiles.js"));

const CH = "ch1";
const widest = (id) => runtime.capability.widestToolMode(runtime.descriptorFor(id));
const narrowest = (id) => runtime.capability.toolModes(runtime.descriptorFor(id))[0];
const CALLS = [
  ["launch", { op: "manage", action: "launch", channel: CH, goal: "g" }],
  ["direct", { op: "manage", action: "direct", channel: CH, to: "@agent-k3wpf7c5", body: "b" }],
  ["rename", { op: "manage", action: "rename", channel: CH, to: "@agent-k3wpf7c5", name: "coder" }],
];
const decide = (runtimeId, toolMode, input) => profiles.grantDecision({
  profile: "full", channelId: CH, toolName: DOPL_CHANNEL_TOOL, input,
  toolMode, messageMode: "auto_both", runtime: runtimeId, launchDepth: 0,
});

test("the own-machine lanes admit at EACH runtime's widest mode", () => {
  for (const id of runtime.ids()) {
    for (const [name, input] of CALLS) {
      assert.equal(decide(id, widest(id), input), "allow", `${id} ${name} at ${widest(id)}`);
      assert.equal(decide(id, narrowest(id), input), "gate", `${id} ${name} at ${narrowest(id)}`);
    }
  }
});

test("another runtime's widest word does not admit (Claude's `bypass` on a Codex session)", () => {
  assert.notEqual(widest("codex"), "bypass");
  for (const [name, input] of CALLS) assert.equal(decide("codex", "bypass", input), "gate", name);
});

test("an edit grant key is scoped by the SESSION runtime's edit-tool names", () => {
  const input = { file_path: "/Users/op/project/src/a.js", content: "x" };
  const claudeKey = profiles.grantKeyFor("Write", input, CH, "claude");
  assert.match(claudeKey, /^Write#projectsrc#/, "Claude's Write is directory-scoped");
  const edits = runtime.capability.editScopedTools(runtime.descriptorFor("codex"));
  if (!edits.includes("Write")) {
    assert.doesNotMatch(profiles.grantKeyFor("Write", input, CH, "codex"), /^Write#projectsrc#/,
      "a runtime that declares no such edit tool gets the whole-input digest");
  }
  assert.equal(profiles.grantKeyFor("Write", input, CH), claudeKey, "absent = the default runtime");
});
