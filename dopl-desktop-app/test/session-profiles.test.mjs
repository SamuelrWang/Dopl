// Tests for the v1.9 SESSION-mode tool grant table (main/session-profiles.js, Track T1).
// SOURCE EXTRACTION with INJECTION: the BEGIN/END SESSION-PROFILE TABLE block references the
// tool-profiles constants required OUTSIDE the block, so the block is sliced and the REAL
// exported constants are injected as parameters — the test evaluates exactly what ships.
//
// The rulings it pins:
//   H1 — `dopl_channel` is neither pre-approved nor denied on ANY profile; it reaches the gate.
//   D2 — and it never auto-allows there: even an own-channel op=send gates. The task grant a post
//        can earn is the narrow POST_GRANT key, which cannot open a DM.
//   H2 + H3 — reversed for `full` (2026-08-08, F-177): `full`'s hard-deny is the UNIVERSAL FLOOR
//        and nothing else, and the delegation / outbound / persistence / escalation built-ins
//        live-gate there. read_only and dopl_only still hard-deny all of them, so H3 survives
//        everywhere a session is actually contained.
//   F2 — every dopl_channel grant is op-scoped and the bare tool name allows nothing.

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
  // Retired server tools (2026-08-07) — still hard-denied, so the block reads them.
  RETIRED_DOPL_TOOLS,
  DOPL_CHANNEL_TOOL,
  DOPL_SERVER_PREFIX,
  // F-177: injected, not restated, so the block is pinned to the SAME floor the headless lane applies.
  UNIVERSAL_HARD_DENY,
  normalizeProfile,
} = require(join(HERE, "..", "main", "tool-profiles.js"));
// The granular half (DMP-013), derived from the server's table by read class.
const { GRANULAR_READ_TOOLS, GRANULAR_SAFE_TOOLS, withGranularOffer } = require(join(HERE, "..", "main", "session-dopl-tools.js"));

const BEGIN = "// ─── BEGIN SESSION-PROFILE TABLE";
const END = "// ─── END SESSION-PROFILE TABLE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf(END);
assert.notEqual(from, -1, "BEGIN SESSION-PROFILE TABLE sentinel missing");
assert.notEqual(to, -1, "END SESSION-PROFILE TABLE sentinel missing");
assert.ok(to > from, "session-profile sentinels out of order");
const BLOCK = SRC.slice(from, to);

// FIX F4: the FULL SHA-256, not a 12-hex (48-bit) prefix — the counterparty supplies the exact
// command / body text, so a 48-bit birthday collision gets a benign/malicious pair sharing one
// key. §2 SPLIT (2026-08-02): the key machinery lives in main/session-grant-keys.js and is
// injected REAL, exactly like normalizeProfile.
const shaKey = (value) =>
  createHash("sha256").update(String(value == null ? "" : value)).digest("hex");
const KEYS = require(join(HERE, "..", "main", "session-grant-keys.js"));
// F-139 (2026-08-05): the block matches every tool name through mcp-tool-names' normalizers —
// the server segment is the CLIENT's (`mcp__dopl__`, `mcp__claude_ai_Dopl__`, `mcp__<uuid>__` are
// all the same server). Injected REAL.
const NAMES = require(join(HERE, "..", "main", "mcp-tool-names.js"));
// 2026-08-22 (OQ-1): the block op-scopes `dopl_kb` the way it has always op-scoped `dopl_channel`.
const KB_OPS = require(join(HERE, "..", "main", "knowledge-ops.js"));
// 2026-09-23: the same op-scoping for `dopl_agent` / `dopl_workspaces` (dopl-write-op-gating.test).
const READ_OPS = require(join(HERE, "..", "main", "dopl-read-ops.js"));
const DOPL_TOOLS = require(join(HERE, "..", "main", "session-dopl-tools.js"));
// 2026-08-24 (Samuel's create_thread ruling): the own-channel outbound ops beside the post were
// §2-split into main/session-own-outbound.js and are injected REAL. `isOwnChannelMarker` /
// `OWN_CHANNEL_MARKER_KIND` are re-exported from that module rather than returned out of the
// block, which is why the destructure below is short.
const OUT = require(join(HERE, "..", "main", "session-own-outbound.js"));
// 2026-08-25 (Samuel's launch ruling, F-320): the own-machine LAUNCH lane, a third §2 file —
// `launch_agent` is not outbound CONTENT, and it needs BOTH axes plus a launch-depth bound.
const LAUNCH = require(join(HERE, "..", "main", "session-own-launch.js"));
// 2026-08-31 (Samuel's same-owner directions ruling): the own-machine DIRECT lane, a fourth §2
// file — `direct_agent` buys a TURN on a local process, so it takes the launch lane's two-axis
// conjunction while carrying NO depth bound.
const DIRECT = require(join(HERE, "..", "main", "session-own-direct.js"));
// 2026-09-17 (Samuel's field report): the own-machine MANAGE lane, a fifth §2 file — rename /
// end / posture reach a live session on this Mac, so they take launch's conjunction, no depth bound.
const MANAGE = require(join(HERE, "..", "main", "session-own-manage.js"));
const AUDIENCE = require(join(HERE, "..", "main", "session-audience.js")); // B2 belt (plan §4.4)

// 2026-08-31 (runtime-adapter port, §0.1b): the Axis-A tail left this block — the mode transforms
// are ONE runtime's vocabulary of built-in tool names, so the block asks the REGISTRY per call
// through `toolConfigFor` / `axisAAllows`. `runtimeFor` and the REAL registry are injected.
const RUNTIME = require(join(HERE, "..", "main", "runtime", "index.js"));
const CLAUDE_TOOLS = require(join(HERE, "..", "main", "runtime", "claude", "tools.js"));
const buildSessionToolConfig = CLAUDE_TOOLS.buildSessionToolConfig;
const shortDoplName = CLAUDE_TOOLS.shortDoplName;
const toolModeAllows = CLAUDE_TOOLS.toolModeAllows; // A5: "is this offered name classified at all?"


const { grantDecision, grantKeyFor, POST_GRANT, isOwnChannelPost,
  isChannelTool } = new Function(
  "READ_BUILTINS", "WEB_TOOLS", "DOPL_SAFE_TOOLS", "DENIED_BUILTINS",
  "DOPL_ADMIN_TOOLS", "RETIRED_DOPL_TOOLS", "UNIVERSAL_HARD_DENY", "DOPL_CHANNEL_TOOL", "DOPL_SERVER_PREFIX", "normalizeProfile", "shaKey",
  "makeGrantKeyFor", "POST_GRANT", "postFieldsOk", "mcpShortName", "canonicalDoplName", "isKnowledgeReadCall", "isDoplReadOpCall", "DOPL_READ_REFERENCE",
  "OWN_CHANNEL_MARKER_KIND", "OWN_CHANNEL_THREAD_NEW", "OWN_CHANNEL_OUTBOUND_OPS",
  "isOwnChannelMarker", "isOwnChannelThreadOpen", "isOwnChannelOutbound",
  "isOwnMachineLaunch", "launchLaneVerdict",
  "isOwnMachineDirect", "directLaneVerdict",
  "isOwnMachineManage", "manageLaneVerdict",
  // 2026-09-06: `channelOpKey` was MISSING from this list since F-578 and is a free variable
  // inside the block — it did not throw only because `grantDecision` short-circuits before the
  // call is ever made. That is a latent ReferenceError one test case away. Injected REAL.
  "channelOpKey",
  // 2026-08-26 (plan §4.4 B2): the AUDIENCE BELT, injected REAL — a fake would let the harness
  // agree with itself while the shipped gate did something else.
  "containerOnlyDenies", "isDoplToolName", "runtimeFor", "editToolsFor",
  // 2026-09-25: the "Use my tools" step (gate 1.6), injected REAL.
  "operatorToolVerdict",
  `${BLOCK}
   return { grantDecision, grantKeyFor, POST_GRANT, isOwnChannelPost,
            isChannelTool };`
)(READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY, DOPL_CHANNEL_TOOL, DOPL_SERVER_PREFIX, normalizeProfile, shaKey,
  KEYS.makeGrantKeyFor, KEYS.POST_GRANT, KEYS.postFieldsOk, NAMES.mcpShortName, NAMES.canonicalDoplName,
  KB_OPS.isKnowledgeReadCall, READ_OPS.isDoplReadOpCall, DOPL_TOOLS.DOPL_READ_REFERENCE,
  OUT.OWN_CHANNEL_MARKER_KIND, OUT.OWN_CHANNEL_THREAD_NEW, OUT.OWN_CHANNEL_OUTBOUND_OPS,
  OUT.isOwnChannelMarker, OUT.isOwnChannelThreadOpen, OUT.isOwnChannelOutbound,
  LAUNCH.isOwnMachineLaunch, LAUNCH.launchLaneVerdict,
  DIRECT.isOwnMachineDirect, DIRECT.directLaneVerdict,
  MANAGE.isOwnMachineManage, MANAGE.manageLaneVerdict,
  require(join(HERE, "..", "main", "channel-op-key.js")).channelOpKey,
  AUDIENCE.containerOnlyDenies, NAMES.isDoplToolName, RUNTIME.runtimeFor,
  (id) => RUNTIME.capability.editScopedTools(RUNTIME.descriptorFor(id)),
  require(join(HERE, "..", "main", "operator-tools.js")).operatorToolVerdict);
const { isOwnChannelMarker, OWN_CHANNEL_MARKER_KIND } = OUT;

const CHANNEL_SHORT = "dopl_channel";
// D7.2 (2026-09-01): the two agent-ops verbs are part of the table now, so the deepEqual pins
// below read them. They were pre-approved before this too, but appended in
// `runtime/claude/launch-spec.js` DOWNSTREAM of `buildSessionToolConfig` — so these assertions
// passed while the shipped `allowedTools` was two names wider. Injected REAL from the module that
// defines the wire, so a rename cannot make these cases agree with a stale copy.
const AGENT_OPS = require(join(HERE, "..", "main", "agent-self-ops.js")).AGENT_OPS_TOOL_NAMES;
// The work tools that were live-gated under `full` even when the rest of DENIED_BUILTINS was
// hard-denied there. Kept because several cases below still drive them by name.
const GATED_WORK = ["Bash", "BashOutput", "KillShell", "Write", "Edit", "MultiEdit", "NotebookEdit"];
// F-177 — the whole of `full`'s hard-deny, written as the injected value rather than re-derived:
// a test that recomputes the partition would pass against either behaviour.
const HARD_DENY = UNIVERSAL_HARD_DENY.slice();
// What `full` used to hard-deny on top of that floor, and now live-gates instead. Derived by
// subtraction from the REAL shared blacklist so a new DENIED_BUILTINS entry joins it for free.
const RELEASED_UNDER_FULL = DENIED_BUILTINS.filter((t) => !GATED_WORK.includes(t));
// `send`, NOT `post` (2026-09-02, F-578): the five-op collapse made the plain delivery post
// `op="send"`, and every own-channel outbound shape a `send` told apart by its arguments.
const post = (channel) => ({ op: "send", channel });

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
  assert.deepEqual(cfg.preApproved, READ_BUILTINS.concat(AGENT_OPS)); // FIX H1: no dopl_channel here. D7.2: + the two self-ops verbs, DECLARED
  for (const t of DENIED_BUILTINS.concat(WEB_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, DOPL_SAFE_TOOLS, GRANULAR_SAFE_TOOLS)) {
    assert.ok(cfg.disallowedTools.includes(t), `read_only must deny ${t}`);
  }
  assert.deepEqual(cfg.doplToolsPolicy, withGranularOffer([CHANNEL_SHORT]));
});

// ── dopl_only ────────────────────────────────────────────────────────────────

// FIX F2 (v2.9 review): the WORKSPACE-WRITE dopl tools. "Non-admin" is not "read-only" — a write
// lands OFF this machine in rows every workspace member can read, which is the same class of move
// as an outbound post. Four since the 2026-08-07 retirement; six since 2026-09-23, when `dopl_agent`
// and `dopl_workspaces` (each with write ops in the server's WRITE_OPS) left the pre-approved read half.
const DOPL_WRITE = ["mcp__dopl__dopl_kb", "mcp__dopl__dopl_skill", "mcp__dopl__dopl_ontology",
  "mcp__dopl__dopl_chats", "mcp__dopl__dopl_agent", "mcp__dopl__dopl_workspaces"];
const DOPL_READ = DOPL_SAFE_TOOLS.filter((t) => !DOPL_WRITE.includes(t));

test("dopl_only: reads + web + READ-ONLY dopl pre-approved; writes GATE; admins denied", () => {
  const cfg = buildSessionToolConfig("dopl_only");
  assert.deepEqual(cfg.builtinTools, READ_BUILTINS.concat(WEB_TOOLS));
  // FIX H1: no dopl_channel. FIX F2: no dopl WRITE tool either — a shadowed write tool never
  // reaches canUseTool at all, which is the v1.9 half of the `auto` auto-approval hole.
  assert.deepEqual(cfg.preApproved, READ_BUILTINS.concat(WEB_TOOLS, DOPL_READ, GRANULAR_READ_TOOLS, AGENT_OPS)); // D7.2: + the two self-ops verbs, DECLARED
  for (const t of DOPL_WRITE) {
    assert.ok(!cfg.preApproved.includes(t), `dopl_only must NOT shadow ${t}`);
    assert.ok(!cfg.disallowedTools.includes(t), `${t} must REACH the gate, not be denied`);
  }
  for (const t of DENIED_BUILTINS.concat(DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS)) {
    assert.ok(cfg.disallowedTools.includes(t), `dopl_only must deny ${t}`);
  }
  for (const t of WEB_TOOLS) assert.ok(!cfg.disallowedTools.includes(t), `dopl_only must not deny ${t}`);
  assert.deepEqual(cfg.doplToolsPolicy, withGranularOffer(DOPL_SAFE_TOOLS.map(shortDoplName).concat([CHANNEL_SHORT])));
  // ...and under dopl_only they really do stop on a button now.
  for (const t of DOPL_WRITE) {
    assert.equal(grantDecision({ profile: "dopl_only", toolName: t, input: { op: "write_file" } }), "gate", t);
  }
});

// ── full (F-177: the hard-deny is the UNIVERSAL FLOOR; everything else live-gates) ─────

test("F-177: full pre-approves only local reads and hard-denies ONLY the universal floor", () => {
  const cfg = buildSessionToolConfig("full");
  // A5 (2026-09-02) replaced `[]` — no bound, i.e. every built-in the CLI ships — with a POSITIVE
  // one. The by-name assertion is `session-builtin-bound.test.mjs`; what belongs here is the
  // PROPERTY that makes the bound safe to derive.
  assert.ok(cfg.builtinTools.length > 0, "`[]` means NO BOUND, never an empty one — A5");
  for (const t of cfg.builtinTools) {
    assert.equal(toolModeAllows("bypass", t), true, `${t} is offered but UNCLASSIFIED — it would gate in every mode`);
  }
  assert.deepEqual(cfg.preApproved, READ_BUILTINS.concat(AGENT_OPS),
    "FIX H1: no dopl_channel pre-approved. D7.2: + the two self-ops verbs, DECLARED");
  assert.equal(cfg.doplToolsPolicy, null, "no per-server scoping under full");
  // An EQUALITY rather than a containment: "the floor is denied" passed under the old, broader
  // set too, which is how a lane could hard-deny 25 extra built-ins with nothing failing.
  assert.deepEqual(cfg.disallowedTools.slice().sort(), HARD_DENY.slice().sort(),
    "full denies the retired + admin dopl tools and NOTHING else");
});

test("F-177: the delegation / outbound / persistence / escalation built-ins live-gate under full", () => {
  const cfg = buildSessionToolConfig("full");
  // The named set is what Samuel's decision released — every one of them is now merely gated.
  for (const t of RELEASED_UNDER_FULL) {
    assert.ok(!cfg.disallowedTools.includes(t), `${t} must no longer be hard-denied under full`);
    assert.ok(!cfg.preApproved.includes(t), `${t} must NOT be pre-approved — it stops on a button`);
    assert.equal(grantDecision({ profile: "full", toolName: t }), "gate", `${t} gates under full`);
  }
  // …and the release is REAL, not vacuous: these specific names were hard-denied before F-177.
  for (const t of ["Task", "Agent", "Artifact", "SendMessage", "CronCreate", "Skill", "ToolSearch"]) {
    assert.ok(RELEASED_UNDER_FULL.includes(t), `${t} left DENIED_BUILTINS — re-read F-177`);
  }
  // The work tools (and WebFetch) are where they always were: gated, never shadowed.
  for (const t of GATED_WORK.concat(["WebFetch"])) {
    assert.ok(!cfg.disallowedTools.includes(t), `${t} must stay live-gated under full (not hard-denied)`);
    assert.ok(!cfg.preApproved.includes(t), `${t} must NOT be pre-approved (or the button never shows)`);
  }
});

test("F-177: `full` denies exactly tool-profiles' universal floor — same names, same constant", () => {
  const floor = require(join(HERE, "..", "main", "tool-profiles.js")).UNIVERSAL_HARD_DENY;
  assert.deepEqual(buildSessionToolConfig("full").disallowedTools.slice().sort(), floor.slice().sort());
});
// C-11 (2026-08-08): unknown profiles used to normalize to FULL, so a profile that could not be
// resolved silently became the widest one. The SDK lane inherits the fix for free, because it
// reads the SAME `normalizeProfile`.
test("unknown profiles normalize to read_only (fail closed), not to full", () => {
  assert.deepEqual(buildSessionToolConfig("nonsense"), buildSessionToolConfig("read_only"));
  assert.deepEqual(buildSessionToolConfig(undefined), buildSessionToolConfig("read_only"));
  assert.notDeepEqual(buildSessionToolConfig(undefined), buildSessionToolConfig("full"));
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

test("isOwnChannelPost: only op=send into the session's own channel (or no explicit channel)", () => {
  assert.equal(isOwnChannelPost({ op: "send", channel: "c1" }, "c1"), true);
  assert.equal(isOwnChannelPost({ op: "send" }, "c1"), true, "no explicit channel -> own channel");
  assert.equal(isOwnChannelPost({ op: "send", channel: "" }, "c1"), true);
  assert.equal(isOwnChannelPost({ op: "send", channel: "OTHER" }, "c1"), false, "cross-channel post is NOT own-channel");
  assert.equal(isOwnChannelPost({ op: "rooms", action: "open", channel: "c1" }, "c1"), false, "rooms.open is never an own-channel post");
  assert.equal(isOwnChannelPost({ op: "post", channel: "c1" }, "c1"), false, "the RETIRED spelling classifies as nothing, and gates");
  assert.equal(isOwnChannelPost(undefined, "c1"), false);
});

test("v2.5 D2: EVERY dopl_channel op gates, own-channel post included (no 'preapproved')", () => {
  const chan = "c-abc";
  // THE OUTBOUND GATE: a plain delivery post into this session's own channel used to resolve
  // 'preapproved'. It now gates like every other write.
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

test("2026-09-17: the OWN-MACHINE MANAGE LANE, through the EXTRACTED block", () => {
  // Driven through the harness's own copy of the table: a lane wired into `grantDecision` but
  // never injected here throws a ReferenceError at the first call that reaches it (the 2026-09-06
  // `channelOpKey` defect). Full table: `test/session-own-manage.test.mjs`.
  const chan = "c-abc";
  const call = (action, over, extra, room) => grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL,
    channelId: chan, input: { op: "manage", action, channel: room || chan, to: "@agent-k3", ...extra }, ...over });
  const BOTH = { toolMode: "bypass", messageMode: "auto_both" };
  for (const [action, extra] of [["rename", { name: "coder" }], ["end", {}], ["posture", { posture: { tools: "auto" } }]]) {
    assert.equal(call(action, BOTH, extra), "allow", `${action}: both axes, own room`);
    assert.equal(call(action, { toolMode: "auto", messageMode: "auto_both" }, extra), "gate", action);
    assert.equal(call(action, { toolMode: "bypass", messageMode: "ask" }, extra), "gate", action);
    // No depth question — every session it was filed for is a launched one, AT the cap already.
    assert.equal(call(action, { ...BOTH, launchDepth: 1 }, extra), "allow", `${action} at the cap`);
    assert.equal(call(action, BOTH, extra, "OTHER"), "gate", `${action}: cross-channel is unchanged`);
  }
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

// The own-channel post key. v2.9 review FIX F7: POST_GRANT is the BASE and every real key
// extends it with the body digest, so the constant alone matches nothing.
const ownPostKey = (input) => grantKeyFor(DOPL_CHANNEL_TOOL, input, "c1");

test("FIX F2: grantKeyFor op-scopes every dopl_channel shape (own post, cross post, each op)", () => {
  assert.ok(ownPostKey(post("c1")).startsWith(POST_GRANT + "#body:"));
  assert.equal(ownPostKey({ op: "send" }), ownPostKey(post("c1")), "no explicit channel -> own channel");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "rooms", direct: true }, "c1"), DOPL_CHANNEL_TOOL + "#op:rooms");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "read" }, "c1"), DOPL_CHANNEL_TOOL + "#op:read");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "status" }, "c1"), DOPL_CHANNEL_TOOL + "#op:status");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, {}, "c1"), DOPL_CHANNEL_TOOL + "#op:unknown", "a missing op is its own key");
  // A cross-channel post carries its target, so a grant to post into one other channel cannot post
  // into a different one. FIX F6: the readable token is followed by a digest of the RAW target.
  assert.ok(ownPostKey(post("OTHER")).startsWith(DOPL_CHANNEL_TOOL + "#op:send:other#" + shaKey("OTHER")));
  assert.notEqual(ownPostKey(post("OTHER")), ownPostKey(post("SECOND")));
  // Sanitizing must not let a junk op collapse onto the own-channel post key.
  for (const junk of [{ op: "send ", channel: "OTHER" }, { op: "s!e!n!d", channel: "OTHER" }]) {
    assert.ok(!ownPostKey(junk).startsWith(POST_GRANT + "#"), JSON.stringify(junk));
  }
  // Every key is bounded, even with a hostile op / channel string: the readable half is
  // capped and everything else is a fixed-width digest.
  const huge = grantKeyFor(DOPL_CHANNEL_TOOL, { op: "x".repeat(400), channel: "y".repeat(400) }, "c1");
  assert.ok(huge.length <= DOPL_CHANNEL_TOOL.length + 40, "the key can never grow into a blob");
  // v2.9 HIGH-1: a non-channel tool no longer records the BARE NAME — see the per-class
  // scoping table in session-permission-axes.test.mjs.
  assert.equal(grantKeyFor("Bash", { command: "ls" }, "c1"), "Bash#ls#" + shaKey("ls"));
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

test("D2: an 'Allow for this session' taken on a POST authorizes posts only, never rooms.open", () => {
  const granted = [ownPostKey(post("c1"))];
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: post("c1"), allowForTask: granted }), "allow");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "send" }, allowForTask: granted }), "allow");
  // The exfil ops stay gated under a post-only grant — this is the whole point of the key.
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "rooms", action: "open", direct: true, member: "evil@x" }, allowForTask: granted }), "gate");
  assert.equal(grantDecision({ profile: "read_only", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: post("OTHER"), allowForTask: granted }), "gate", "cross-channel post is not covered");
  // The retired spelling is covered by nothing (2026-09-02, F-578): `post` matches no classifier
  // now, so it falls to the unclassified arm and GATES — which is why a deleted op needs no deny.
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "post" }, allowForTask: granted }), "gate");
  assert.equal(grantDecision({ profile: "full", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "status" }, allowForTask: granted }), "gate", "a read is not covered by a post grant");
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

// ── F-177: the released set gates under full and STILL denies under the restricted two ──

test("F-177: Task/Agent/CronCreate/SendMessage are 'gate' (NOT 'deny') under full", () => {
  // `full` means full: these exist and they stop on an operator button.
  for (const t of ["Task", "Agent", "CronCreate", "SendMessage"]) {
    assert.equal(grantDecision({ profile: "full", toolName: t }), "gate", `${t} must gate under full`);
  }
});

test("F-177: a released tool gates in EVERY Axis-A mode, `bypass` included (nothing is auto)", () => {
  // The bound that replaces the hard-deny: AUTO_TOOLS and BYPASS_TOOLS are POSITIVE allow-lists
  // (FIX F3), and no released name is on either, so no posture can run one silently.
  for (const t of ["Task", "Agent", "SendMessage", "Artifact", "CronCreate", "Skill", "ToolSearch"]) {
    for (const toolMode of ["manual", "accept_edits", "auto", "bypass"]) {
      assert.equal(grantDecision({ profile: "full", toolName: t, toolMode }), "gate", `${t} @ ${toolMode}`);
    }
  }
});

test("FIX H3 survives where containment is the point: Task + Agent still 'deny' under the restricted profiles", () => {
  // A subagent is a fresh session that does not inherit this session's canUseTool bound, which is
  // why read_only / dopl_only keep refusing it outright. Under `full` the operator has the shell.
  for (const p of ["read_only", "dopl_only"]) {
    assert.equal(grantDecision({ profile: p, toolName: "Task" }), "deny", `${p}: Task must deny`);
    assert.equal(grantDecision({ profile: p, toolName: "Agent" }), "deny", `${p}: Agent must deny`);
  }
});
