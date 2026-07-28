// Tests for the v1.9 SESSION-mode tool grant table (main/session-profiles.js,
// Track T1). SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-PROFILE TABLE
// block references the tool-profiles constants (required at the top of the module,
// OUTSIDE the block), so we slice the block and inject the REAL exported constants
// as parameters — the test evaluates exactly what ships and is pinned to the real
// profile lists (same idiom as tool-profiles, but parameterized).
//
// What matters after the adversarial-review security fixes (§ FIX H1/H2/H3):
//   H1 — `dopl_channel` is NOT pre-approved on ANY profile and NOT denied either; it
//        reaches the gate and is OP-SCOPED in grantDecision (own-channel post only).
//   H2 — under `full` the dangerous subset (Task/Agent/Cron*/SendMessage/… + dopl
//        admins) is HARD-DENIED, not merely gated; only the visible+reversible work
//        tools (Bash/Write/Edit/NotebookEdit/…) stay live-gated.
//   H3 — Task/Agent are hard-denied under EVERY profile (subagents don't inherit the
//        canUseTool bound).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-profiles.js"), "utf8");

// The REAL exported constants — the block is pinned to what tool-profiles ships.
const {
  READ_BUILTINS,
  WEB_TOOLS,
  DOPL_SAFE_TOOLS,
  DENIED_BUILTINS,
  DOPL_ADMIN_TOOLS,
  DOPL_CHANNEL_TOOL,
  normalizeProfile,
} = require(join(HERE, "..", "main", "tool-profiles.js"));

const BEGIN = "// ─── BEGIN SESSION-PROFILE TABLE";
const END = "// ─── END SESSION-PROFILE TABLE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-PROFILE TABLE sentinel missing");
assert.notEqual(to, -1, "END SESSION-PROFILE TABLE sentinel missing");
assert.ok(to > from, "session-profile sentinels out of order");
const BLOCK = SRC.slice(from, to);

const { shortDoplName, buildSessionToolConfig, grantDecision, isOwnChannelPost } = new Function(
  "READ_BUILTINS", "WEB_TOOLS", "DOPL_SAFE_TOOLS", "DENIED_BUILTINS",
  "DOPL_ADMIN_TOOLS", "DOPL_CHANNEL_TOOL", "normalizeProfile",
  `${BLOCK}
   return { shortDoplName, buildSessionToolConfig, grantDecision, isOwnChannelPost };`
)(READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL, normalizeProfile);

const CHANNEL_SHORT = "dopl_channel";
// The work tools kept live-gated under `full` (everything else in DENIED_BUILTINS is
// hard-denied, plus the dopl admins). Mirrors SESSION_GATED_WORK_TOOLS in the block.
const GATED_WORK = ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"];
const HARD_DENY = DENIED_BUILTINS.filter((t) => !GATED_WORK.includes(t)).concat(DOPL_ADMIN_TOOLS);
const post = (channel) => ({ op: "post", channel });

// ── shortDoplName ────────────────────────────────────────────────────────────

test("shortDoplName strips the mcp__dopl__ prefix for the per-server tools policy", () => {
  assert.equal(shortDoplName("mcp__dopl__dopl_channel"), "dopl_channel");
  assert.equal(shortDoplName("mcp__dopl__dopl_kb"), "dopl_kb");
  assert.equal(shortDoplName("plain"), "plain");
});

// ── FIX H1: dopl_channel is neither pre-approved nor denied (it must reach the gate)

test("FIX H1: NO profile pre-approves dopl_channel, and NO profile denies it — it reaches the gate", () => {
  for (const p of ["read_only", "dopl_only", "full"]) {
    const cfg = buildSessionToolConfig(p);
    assert.ok(!cfg.preApproved.includes(DOPL_CHANNEL_TOOL), `${p} must NOT pre-approve dopl_channel (would shadow the op-scope)`);
    assert.ok(!cfg.disallowedTools.includes(DOPL_CHANNEL_TOOL), `${p} must NOT deny dopl_channel (it must reach canUseTool)`);
    // Defense in depth: the MCP per-server policy still scopes to the channel tool.
    if (cfg.doplToolsPolicy) assert.ok(cfg.doplToolsPolicy.includes(CHANNEL_SHORT), `${p} doplToolsPolicy still offers the channel`);
  }
});

// ── read_only ────────────────────────────────────────────────────────────────

test("read_only: local reads pre-approved (NOT the channel); web + dopl reads/admins + write/exec denied", () => {
  const cfg = buildSessionToolConfig("read_only");
  assert.deepEqual(cfg.builtinTools, READ_BUILTINS);
  assert.deepEqual(cfg.preApproved, READ_BUILTINS); // FIX H1: no dopl_channel here
  for (const t of DENIED_BUILTINS.concat(WEB_TOOLS, DOPL_ADMIN_TOOLS, DOPL_SAFE_TOOLS)) {
    assert.ok(cfg.disallowedTools.includes(t), `read_only must deny ${t}`);
  }
  assert.deepEqual(cfg.doplToolsPolicy, [CHANNEL_SHORT]);
});

// ── dopl_only ────────────────────────────────────────────────────────────────

test("dopl_only: reads + web + non-admin dopl pre-approved (NOT the channel); admins denied", () => {
  const cfg = buildSessionToolConfig("dopl_only");
  assert.deepEqual(cfg.builtinTools, READ_BUILTINS.concat(WEB_TOOLS));
  assert.deepEqual(cfg.preApproved, READ_BUILTINS.concat(WEB_TOOLS, DOPL_SAFE_TOOLS)); // FIX H1: no dopl_channel
  for (const t of DENIED_BUILTINS.concat(DOPL_ADMIN_TOOLS)) {
    assert.ok(cfg.disallowedTools.includes(t), `dopl_only must deny ${t}`);
  }
  for (const t of WEB_TOOLS) assert.ok(!cfg.disallowedTools.includes(t), `dopl_only must not deny ${t}`);
  assert.deepEqual(cfg.doplToolsPolicy, DOPL_SAFE_TOOLS.map(shortDoplName).concat([CHANNEL_SHORT]));
});

// ── full (FIX H2: dangerous subset HARD-DENIED, only work tools live-gated) ─────

test("FIX H2: full pre-approves only local reads; the dangerous subset is HARD-DENIED, work tools stay gated", () => {
  const cfg = buildSessionToolConfig("full");
  assert.deepEqual(cfg.builtinTools, [], "no positive bound: work tools offered then gated per call");
  assert.deepEqual(cfg.preApproved, READ_BUILTINS, "FIX H1: no dopl_channel pre-approved");
  assert.equal(cfg.doplToolsPolicy, null, "no per-server scoping under full");
  // The delegation/persistence/exfil/escalation subset + dopl admins are hard-denied.
  for (const t of HARD_DENY) assert.ok(cfg.disallowedTools.includes(t), `full must HARD-DENY ${t}`);
  // The visible + reversible work tools (and WebFetch) stay live-gated, NOT denied.
  for (const t of GATED_WORK.concat(["WebFetch"])) {
    assert.ok(!cfg.disallowedTools.includes(t), `${t} must stay live-gated under full (not hard-denied)`);
    assert.ok(!cfg.preApproved.includes(t), `${t} must NOT be pre-approved (or the button never shows)`);
  }
});

test("unknown profiles normalize to full", () => {
  assert.deepEqual(buildSessionToolConfig("nonsense"), buildSessionToolConfig("full"));
  assert.deepEqual(buildSessionToolConfig(undefined), buildSessionToolConfig("full"));
});

// ── the shadow invariant across every profile ────────────────────────────────

test("no tool is ever both pre-approved and disallowed (the shadow gotcha can't bite)", () => {
  for (const p of ["read_only", "dopl_only", "full"]) {
    const cfg = buildSessionToolConfig(p);
    const overlap = cfg.preApproved.filter((t) => cfg.disallowedTools.includes(t));
    assert.deepEqual(overlap, [], `${p}: preApproved and disallowed must be disjoint`);
  }
});

// ── FIX H1: isOwnChannelPost + grantDecision op-scoping ──────────────────────────

test("isOwnChannelPost: only op=post into the session's own channel (or no explicit channel)", () => {
  assert.equal(isOwnChannelPost({ op: "post", channel: "c1" }, "c1"), true);
  assert.equal(isOwnChannelPost({ op: "post" }, "c1"), true, "no explicit channel -> own channel");
  assert.equal(isOwnChannelPost({ op: "post", channel: "" }, "c1"), true);
  assert.equal(isOwnChannelPost({ op: "post", channel: "OTHER" }, "c1"), false, "cross-channel post is NOT own-channel");
  assert.equal(isOwnChannelPost({ op: "open", channel: "c1" }, "c1"), false, "op=open is never an own-channel post");
  assert.equal(isOwnChannelPost({ op: "create_task", channel: "c1" }, "c1"), false);
  assert.equal(isOwnChannelPost(undefined, "c1"), false);
});

test("FIX H1: dopl_channel own-channel post -> 'preapproved'; any other op/channel -> 'gate'", () => {
  const chan = "c-abc";
  // Auto-allowed: a plain delivery post into this session's channel.
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: post(chan) }), "preapproved");
  assert.equal(grantDecision({ profile: "read_only", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: post() }), "preapproved");
  // Gated: the exfiltration surface the blanket pre-approval used to hand out free.
  assert.equal(grantDecision({ profile: "read_only", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: { op: "open", direct: true, member: "evil@x" } }), "gate", "op=open (DM) must gate");
  assert.equal(grantDecision({ profile: "read_only", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: post("OTHER") }), "gate", "cross-channel post must gate");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: { op: "create_task", channel: chan } }), "gate", "create_task gates");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: { op: "close_task", channel: chan } }), "gate", "close_task gates");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: { op: "set_task_mode", channel: chan } }), "gate", "set_task_mode gates");
  // With no input at all it cannot be an own-channel post -> gate.
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan }), "gate");
});

test("FIX H1: allow-for-task lets the operator grant a gated dopl_channel op for the task", () => {
  const chan = "c1";
  const openInput = { op: "open", direct: true, member: "peer@x" };
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: openInput }), "gate");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: openInput, allowForTask: [DOPL_CHANNEL_TOOL] }), "allow");
});

// ── grantDecision for the non-channel tools ───────────────────────────────────

test("grantDecision: a profile pre-approved read tool -> 'preapproved'", () => {
  assert.equal(grantDecision({ profile: "read_only", toolName: "Read" }), "preapproved");
  assert.equal(grantDecision({ profile: "dopl_only", toolName: "WebFetch" }), "preapproved");
});

test("grantDecision: an ungranted work tool GATES under full; granting it for the task -> 'allow'", () => {
  for (const t of GATED_WORK.concat(["WebFetch"])) {
    assert.equal(grantDecision({ profile: "full", toolName: t }), "gate", `${t} gates under full`);
    assert.equal(grantDecision({ profile: "full", toolName: t, allowForTask: [t] }), "allow", `${t} allowed-for-task`);
  }
});

test("grantDecision: a hard-denied tool -> 'deny', even when allowed-for-task (deny checked first)", () => {
  assert.equal(grantDecision({ profile: "read_only", toolName: "Bash" }), "deny");
  assert.equal(grantDecision({ profile: "read_only", toolName: "WebFetch" }), "deny");
  assert.equal(grantDecision({ profile: "read_only", toolName: "Bash", allowForTask: ["Bash"] }), "deny");
});

// ── FIX H2 / H3: the dangerous subset hard-denies (never gates) ──────────────────

test("FIX H2: Task/Agent/CronCreate/SendMessage are 'deny' (NOT 'gate') under full", () => {
  for (const t of ["Task", "Agent", "CronCreate", "SendMessage"]) {
    assert.equal(grantDecision({ profile: "full", toolName: t }), "deny", `${t} must hard-deny under full`);
  }
});

test("FIX H3: Task + Agent are 'deny' under EVERY session profile (subagents don't inherit the bound)", () => {
  for (const p of ["read_only", "dopl_only", "full"]) {
    assert.equal(grantDecision({ profile: p, toolName: "Task" }), "deny", `${p}: Task must deny`);
    assert.equal(grantDecision({ profile: p, toolName: "Agent" }), "deny", `${p}: Agent must deny`);
  }
});
