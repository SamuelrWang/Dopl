// Tests for the v1.9 SESSION-mode tool grant table (main/session-profiles.js,
// Track T1). SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-PROFILE TABLE
// block references the tool-profiles constants (required at the top of the module,
// OUTSIDE the block), so we slice the block and inject the REAL exported constants
// as parameters — the test evaluates exactly what ships and is pinned to the real
// profile lists (same idiom as tool-profiles, but parameterized).
//
// What matters after the adversarial-review security fixes (§ FIX H1/H2/H3) and the
// v2.5 D2 outbound gate:
//   H1 — `dopl_channel` is NOT pre-approved on ANY profile and NOT denied either; it
//        reaches the gate.
//   D2 — and it NEVER auto-allows there any more: even an own-channel op=post gates,
//        so no message leaves the machine without a click. The task grant a post can
//        earn is the narrow POST_GRANT key, which cannot open a DM.
//   H2 — under `full` the dangerous subset (Task/Agent/Cron*/SendMessage/… + dopl
//        admins) is HARD-DENIED, not merely gated; only the visible+reversible work
//        tools (Bash/Write/Edit/NotebookEdit/…) stay live-gated.
//   H3 — Task/Agent are hard-denied under EVERY profile (subagents don't inherit the
//        canUseTool bound).
//   F2 — EVERY dopl_channel grant is op-scoped and the bare tool name allows nothing:
//        a click taken on op=read can no longer authorize op=post or op=open for the task.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

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

// v2.9: the block also digests a grant key, so `sha12` is injected exactly like
// normalizeProfile — the REAL implementation, sliced from the module head.
const sha12 = (value) =>
  createHash("sha256").update(String(value == null ? "" : value)).digest("hex").slice(0, 12);

const { shortDoplName, buildSessionToolConfig, grantDecision, grantKeyFor, POST_GRANT, isOwnChannelPost } = new Function(
  "READ_BUILTINS", "WEB_TOOLS", "DOPL_SAFE_TOOLS", "DENIED_BUILTINS",
  "DOPL_ADMIN_TOOLS", "DOPL_CHANNEL_TOOL", "normalizeProfile", "sha12",
  `${BLOCK}
   return { shortDoplName, buildSessionToolConfig, grantDecision, grantKeyFor, POST_GRANT, isOwnChannelPost };`
)(READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL, normalizeProfile, sha12);

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

test("v2.5 D2: EVERY dopl_channel op gates, own-channel post included (no 'preapproved')", () => {
  const chan = "c-abc";
  // THE OUTBOUND GATE: a plain delivery post into this session's own channel used to
  // resolve 'preapproved' (no click). It now gates like every other write, so no
  // message leaves this machine without the operator seeing the drafted body.
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: post(chan) }), "gate");
  assert.equal(grantDecision({ profile: "read_only", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: post() }), "gate");
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
  // FIX F2: the grant is the OP-SCOPED key for the shape that was actually shown.
  const openGrant = grantKeyFor(DOPL_CHANNEL_TOOL, openInput, chan);
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: openInput, allowForTask: [openGrant] }), "allow");
});

// ── FIX F2: EVERY channel grant is op-scoped, and the bare name is worthless ──────

test("FIX F2: grantKeyFor op-scopes every dopl_channel shape (own post, cross post, each op)", () => {
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, post("c1"), "c1"), POST_GRANT);
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "post" }, "c1"), POST_GRANT, "no explicit channel -> own channel");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "open", direct: true }, "c1"), DOPL_CHANNEL_TOOL + "#op:open");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "read" }, "c1"), DOPL_CHANNEL_TOOL + "#op:read");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "list_tasks" }, "c1"), DOPL_CHANNEL_TOOL + "#op:list_tasks");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, {}, "c1"), DOPL_CHANNEL_TOOL + "#op:unknown", "a missing op is its own key");
  // A CROSS-channel post carries its target, so a grant to post into one other channel
  // cannot post into a different one (and never collides with the own-channel key).
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, post("OTHER"), "c1"), DOPL_CHANNEL_TOOL + "#op:post:other");
  assert.notEqual(grantKeyFor(DOPL_CHANNEL_TOOL, post("OTHER"), "c1"), grantKeyFor(DOPL_CHANNEL_TOOL, post("SECOND"), "c1"));
  // Sanitizing must not let a junk op collapse onto the own-channel post key.
  assert.notEqual(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "post ", channel: "OTHER" }, "c1"), POST_GRANT);
  assert.notEqual(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "p!o!s!t", channel: "OTHER" }, "c1"), POST_GRANT);
  // Every key is bounded, even with a hostile op / channel string.
  const huge = grantKeyFor(DOPL_CHANNEL_TOOL, { op: "x".repeat(400), channel: "y".repeat(400) }, "c1");
  assert.ok(huge.length <= DOPL_CHANNEL_TOOL.length + 40, "the key can never grow into a blob");
  // v2.9 HIGH-1: a non-channel tool no longer records the BARE NAME — see the per-class
  // scoping table in session-permission-axes.test.mjs.
  assert.equal(grantKeyFor("Bash", { command: "ls" }, "c1"), "Bash#ls#" + sha12("ls"));
});

test("FIX F2: a grant on op=read does NOT allow a later op=post or op=open (each op its own)", () => {
  const chan = "c1";
  const readGrant = grantKeyFor(DOPL_CHANNEL_TOOL, { op: "read" }, chan);
  const granted = [readGrant];
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: { op: "read" }, allowForTask: granted }), "allow");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: post(chan), allowForTask: granted }), "gate", "a post needs its own grant");
  assert.equal(grantDecision({ profile: "read_only", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: { op: "open", direct: true, member: "evil@x" }, allowForTask: granted }), "gate", "op=open is the exfil path FIX H1 closed");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input: { op: "list_tasks" }, allowForTask: granted }), "gate");
});

test("FIX F2: the BARE tool name in allowForTask allows NOTHING on the channel tool", () => {
  const chan = "c1";
  for (const input of [post(chan), { op: "post" }, { op: "open", direct: true }, { op: "read" }, { op: "create_task" }, undefined]) {
    assert.equal(
      grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: chan, input, allowForTask: [DOPL_CHANNEL_TOOL] }),
      "gate",
      `bare-name grant must not cover ${JSON.stringify(input)}`
    );
  }
});

test("D2: an 'Allow for this task' taken on a POST authorizes posts only, never op=open", () => {
  const granted = [POST_GRANT];
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: post("c1"), allowForTask: granted }), "allow");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "post" }, allowForTask: granted }), "allow");
  // The exfil ops stay gated under a post-only grant — this is the whole point of the key.
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "open", direct: true, member: "evil@x" }, allowForTask: granted }), "gate");
  assert.equal(grantDecision({ profile: "read_only", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: post("OTHER"), allowForTask: granted }), "gate", "cross-channel post is not covered");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "create_task" }, allowForTask: granted }), "gate");
});

test("D2/F2: every channel grant key is unrepresentable as a real SDK tool name", () => {
  assert.equal(POST_GRANT, DOPL_CHANNEL_TOOL + "#post");
  for (const input of [post("c1"), { op: "open" }, { op: "read" }, post("OTHER"), {}]) {
    assert.ok(grantKeyFor(DOPL_CHANNEL_TOOL, input, "c1").includes("#"), "the '#' keeps it out of tool-name space");
  }
});

// ── grantDecision for the non-channel tools ───────────────────────────────────

test("grantDecision: a profile pre-approved read tool -> 'preapproved'", () => {
  assert.equal(grantDecision({ profile: "read_only", toolName: "Read" }), "preapproved");
  assert.equal(grantDecision({ profile: "dopl_only", toolName: "WebFetch" }), "preapproved");
});

test("grantDecision: an ungranted work tool GATES under full; granting THAT SHAPE -> 'allow'", () => {
  // v2.9 HIGH-1: the grant is keyed on the call's shape, so the key has to come from
  // grantKeyFor — the bare tool name authorizes nothing any more.
  for (const t of GATED_WORK.concat(["WebFetch"])) {
    const input = { command: "ls -la", file_path: "/tmp/a.txt", notebook_path: "/tmp/n.ipynb", url: "https://x.test/a" };
    assert.equal(grantDecision({ profile: "full", toolName: t, input }), "gate", `${t} gates under full`);
    const key = grantKeyFor(t, input, "c1");
    assert.equal(grantDecision({ profile: "full", toolName: t, input, allowForTask: [key] }), "allow", `${t} allowed-for-task`);
    assert.equal(grantDecision({ profile: "full", toolName: t, input, allowForTask: [t] }), "gate", `${t}: the bare name grants nothing`);
  }
});

test("grantDecision: a hard-denied tool -> 'deny', even when allowed-for-task (deny checked first)", () => {
  assert.equal(grantDecision({ profile: "read_only", toolName: "Bash" }), "deny");
  assert.equal(grantDecision({ profile: "read_only", toolName: "WebFetch" }), "deny");
  assert.equal(grantDecision({ profile: "read_only", toolName: "Bash", allowForTask: ["Bash"] }), "deny");
  // v2.9: and not via the scoped key either, nor under `bypass` (see session-permission-axes).
  const key = grantKeyFor("Bash", { command: "ls" }, "c1");
  assert.equal(grantDecision({ profile: "read_only", toolName: "Bash", input: { command: "ls" }, allowForTask: [key], toolMode: "bypass" }), "deny");
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
