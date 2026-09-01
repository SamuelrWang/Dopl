// agent-self-ops — the agent-driven rename/end server (2026-08-31, Samuel's ruling).
//
// WHAT IS PINNED HERE, and why it is enough:
//   • the PURE half (target resolution, the end verdict table, the result shapes) is
//     required DIRECTLY — the module keeps every electron-bound require lazy for exactly
//     this reason (its header names the agent-names electron-store precedent);
//   • the WIRE is pinned by source regex over session-query.js, the same way sdk-grant.js
//     pins the dopl mcpServers literal: the two verbs must ride allowedTools (SHADOWED —
//     a gated verb is DEAD on a windowless session) and the server must mount BESIDE the
//     dopl entry, never inside the pinned buildMcpServers literal;
//   • makeAgentOpsServer outside Electron answers NULL and never throws — the "a display
//     verb must never break a launch" contract, provable in this harness precisely
//     because the loader cannot load here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ops = require("../main/agent-self-ops.js");
// ⚠ 2026-08-31 (runtime-adapter port, step 3): the SERVER BUILDER moved to the adapter —
// `main/runtime/claude/axis-b.js` builds it with that runtime's own MCP-server helpers off its
// cached namespace, which is the one platform-shaped part of this feature. The pure half (the
// rename target rule, the end verdict table, the two result shapes) stayed here.
const axisB = require("../main/runtime/claude/axis-b.js");

// Two well-formed instance ids (agent-id.js: ^[a-z][a-z0-9]{7}$).
const SELF = "aself123";
const OTHER = "bother45";

test("tool names derive from the server key, so the wire cannot drift", () => {
  assert.equal(ops.SERVER_KEY, "dopl_agents");
  assert.deepEqual(ops.AGENT_OPS_TOOL_NAMES, [
    "mcp__dopl_agents__rename_agent",
    "mcp__dopl_agents__end_agent",
  ]);
  for (const name of ops.AGENT_OPS_TOOL_NAMES) {
    assert.ok(name.startsWith("mcp__" + ops.SERVER_KEY + "__"), name);
  }
  // ⚠ NOT the dopl server's namespace: mcp-tool-names.js canonicalizes `mcp__dopl__*`
  // onto the session gate's Dopl vocabulary, and these two must stay out of it.
  for (const name of ops.AGENT_OPS_TOOL_NAMES) {
    assert.ok(!name.startsWith("mcp__dopl__"), `${name} must not collide with the dopl vocabulary`);
  }
});

test("renameTargetFor: omitted id means SELF; prefixed handles are accepted; garbage refuses", () => {
  assert.deepEqual(ops.renameTargetFor(SELF, undefined), { ok: true, agentId: SELF });
  assert.deepEqual(ops.renameTargetFor(SELF, ""), { ok: true, agentId: SELF });
  assert.deepEqual(ops.renameTargetFor(SELF, "  "), { ok: true, agentId: SELF });
  // The handle spellings read_sessions prints — bare, @agent-, agent- — all resolve.
  assert.deepEqual(ops.renameTargetFor(SELF, OTHER), { ok: true, agentId: OTHER });
  assert.deepEqual(ops.renameTargetFor(SELF, "@agent-" + OTHER), { ok: true, agentId: OTHER });
  assert.deepEqual(ops.renameTargetFor(SELF, "agent-" + OTHER), { ok: true, agentId: OTHER });
  // Malformed ids refuse rather than coerce — a typo must not mint a name row nobody owns.
  assert.equal(ops.renameTargetFor(SELF, "UPPER123").ok, false);
  assert.equal(ops.renameTargetFor(SELF, "short").ok, false);
  assert.equal(ops.renameTargetFor(SELF, "1eading8").ok, false);
  // No id passed and no self either — the fail-closed corner.
  assert.deepEqual(ops.renameTargetFor("", ""), { ok: false, reason: "no-self" });
});

test("endVerdict: self refused, absent refused, malformed refused, live sibling resolves", () => {
  const rows = [
    { agentId: OTHER, channelId: "chan-1", taskId: "task-1", status: "running" },
    { agentId: "cthird67", channelId: "chan-1", taskId: "", status: "parked" },
  ];
  // ⚠ SELF IS REFUSED BEFORE THE REGISTRY IS CONSULTED — ending the caller aborts the very
  // turn making the call, so the tool result could never be delivered.
  assert.deepEqual(ops.endVerdict(SELF, SELF, rows), { ok: false, reason: "self" });
  assert.deepEqual(ops.endVerdict(SELF, "@agent-" + SELF, rows), { ok: false, reason: "self" });
  assert.deepEqual(ops.endVerdict(SELF, "zmissing", rows), { ok: false, reason: "no-session" });
  assert.equal(ops.endVerdict(SELF, "not an id", rows).reason, "bad-agent-id");
  const hit = ops.endVerdict(SELF, "@agent-" + OTHER, rows);
  assert.equal(hit.ok, true);
  assert.equal(hit.row.channelId, "chan-1");
  assert.equal(hit.row.taskId, "task-1");
  // Empty / absent registry projections fail closed, never throw.
  assert.deepEqual(ops.endVerdict(SELF, OTHER, []), { ok: false, reason: "no-session" });
  assert.deepEqual(ops.endVerdict(SELF, OTHER, null), { ok: false, reason: "no-session" });
});

test("result shapes are the MCP CallToolResult forms", () => {
  assert.deepEqual(ops.txt("hi"), { content: [{ type: "text", text: "hi" }] });
  const r = ops.refuse("no");
  assert.equal(r.isError, true);
  assert.deepEqual(r.content, [{ type: "text", text: "no" }]);
});

test("makeAgentOpsServer NEVER throws a launch: outside Electron it answers null", () => {
  // the loader requires electron at module top, so peekSdk is unreachable in this harness —
  // exactly the "no SDK namespace" degraded shape a real spawn can hit pre-await. The
  // contract is null (mount nothing), never a throw into buildSdkOptions.
  assert.equal(axisB.makeAgentOpsServer({ agentId: SELF }), null);
  assert.equal(axisB.makeAgentOpsServer(null), null);
});

test("WIRE PIN: the launch spec passes the PROFILE'S list through and mounts the server beside the dopl entry", () => {
  // ⚠ 2026-08-31: the assembly is the RUNTIME ADAPTER's. `AGENT_OPS_TOOL_NAMES` stayed core —
  // the two names are the WIRE — while the mount rides the spec that carries them.
  // ⚠ REVERSED 2026-09-01 (D7.2). This pinned `cfg.preApproved.concat(agentOps.AGENT_OPS_TOOL_NAMES)`
  // — the two verbs appended DOWNSTREAM of the profile table — which is a shadow no profile
  // declares and none can refuse: absent from `descriptor.containment.profiles.<p>.allowList`,
  // absent from the deepEqual pins, and invisible to `grantDecision`'s step-2 `preApproved` read.
  // The shadow itself is unchanged and still argued (a gated verb is DEAD on a windowless session);
  // what moved is WHERE it is declared. The table pin is now the one that measures it — see
  // "AGENT-OPS" in `runtime/claude/tools.js` and the three deepEqual cases in
  // `session-profiles.test.mjs`.
  const SPEC = readFileSync(join(HERE, "..", "main", "runtime", "claude", "launch-spec.js"), "utf8");
  const opts = SPEC.slice(
    SPEC.indexOf("function buildOptions(s, dispatch, emitQuiet) {"),
    SPEC.indexOf("function buildLaunchSpec(")
  );
  assert.ok(opts.length > 0, "the option assembly slice not found");
  assert.match(opts, /allowedTools: cfg\.preApproved,/,
    "the profile's list, whole and unextended");
  // ⚠ THE NEGATIVE IS THE ACTUAL PIN. `allowedTools` may not be widened anywhere downstream of
  // the table, by these two names or any others — that is the defect class, not these verbs.
  // ⚠ MEASURED OVER CODE ONLY. Comment lines are stripped first, because this very case argues
  // the rule in prose and the prose would otherwise trip it; `disallowedTools:` is excluded by
  // the leading `^\s*` too, and its own `.concat(buildSecretPathDenyRules())` is a DENY-list
  // widening, which is the safe direction and must stay legal.
  const code = opts.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!/^\s*allowedTools:[^\n]*\.concat\(/m.test(code),
    "no allowedTools entry may be added downstream of the profile table");
  assert.ok(!/AGENT_OPS_TOOL_NAMES/.test(code),
    "the two verbs are declared in the profile table now, not appended at launch");
  // Mounted beside the dopl entry; the dopl literal itself stays byte-identical (sdk-grant
  // pins it), so the container lock and the workspace pin cannot be disturbed by this mount.
  assert.match(opts, /mcpServers: loader\.buildMcpServers\(cfg\.doplToolsPolicy, s\.workspaceId, sessionCredential\.sessionBearer\(s\)\),/);
  assert.match(opts, /options\.mcpServers\[agentOps\.SERVER_KEY\] = agentOpsServer/);
  assert.match(opts, /const agentOpsServer = axisB\.makeAgentOpsServer\(s\);/);
});

test("D7.2: the two verbs are pre-approved on EVERY profile, and the DECLARATION is what says so", () => {
  // The table is the single source: the launch reads it, the descriptor mirrors it, and
  // `grantDecision` consults it. Before this fix, none of those three could see the shadow.
  const claudeTools = require("../main/runtime/claude/tools.js");
  const { descriptor } = require("../main/runtime/claude/index.js");
  for (const p of ["read_only", "dopl_only", "full"]) {
    const cfg = claudeTools.buildSessionToolConfig(p);
    for (const name of ops.AGENT_OPS_TOOL_NAMES) {
      assert.ok(cfg.preApproved.includes(name), `${p} must DECLARE ${name} as pre-approved`);
      // …and the descriptor's mirror carries it, which is what a UI and a reviewer read.
      assert.ok(descriptor.containment.profiles[p].allowList.includes(name),
        `${p}'s declared allowList must show ${name} — a shadow the descriptor hides is the defect`);
      // ⚠ NOT hard-denied anywhere: step 1 runs BEFORE step 2, so a deny would win. The point of
      // moving the declaration here is that a future profile CAN refuse one; today none does.
      assert.ok(!cfg.disallowedTools.includes(name), `${p} does not deny ${name}`);
    }
  }
});

test("D7.2: `grantDecision` now answers `preapproved` for them, on every profile", () => {
  // The consequence of declaring the shadow in the table rather than downstream of it: the gate
  // can SEE these names. It answered `gate` before — which, on the windowless sessions the ruling
  // is about, is a DENY — so the verbs worked only because the SDK never asked.
  const { grantDecision } = require("../main/session-profiles.js");
  for (const p of ["read_only", "dopl_only", "full"]) {
    for (const name of ops.AGENT_OPS_TOOL_NAMES) {
      assert.equal(grantDecision({ profile: p, toolName: name, toolMode: "manual" }), "preapproved",
        `${p} / ${name}`);
    }
  }
});

test("D7.2: they stay OUT of the dopl vocabulary, so the audience belt does not misread them", () => {
  // Step 1.5 runs ahead of `preApproved` and reads a `workspace` argument off Dopl-named tools.
  // These two are local-machine verbs with no workspace at all; `mcp__dopl_agents__` is not
  // `mcp__dopl__`, and this is the assertion that keeps that true.
  const { isDoplToolName, canonicalDoplName } = require("../main/mcp-tool-names.js");
  for (const name of ops.AGENT_OPS_TOOL_NAMES) {
    assert.equal(isDoplToolName(name), false, name);
    assert.equal(canonicalDoplName(name), name, `${name} must pass through uncanonicalized`);
  }
});
