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
//   H2 + H3 — REVERSED FOR `full` (2026-08-08, F-177). `full`'s hard-deny is now the
//        UNIVERSAL FLOOR and nothing else: the dopl admins + the retired dopl tools. The
//        delegation / outbound / persistence / escalation built-ins (Task, Agent, Artifact,
//        SendMessage, Cron*, Skill, ToolSearch, …) are LIVE-GATED there, exactly like Bash —
//        which was live-gated under `full` all along, and which is why denying the others was
//        never a boundary. read_only and dopl_only still hard-deny all of them, Task/Agent
//        included, so H3 survives everywhere a session is actually contained.
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
  // Retired server tools (2026-08-07) — still hard-denied, so the block reads them.
  RETIRED_DOPL_TOOLS,
  DOPL_CHANNEL_TOOL,
  DOPL_SERVER_PREFIX,
  // F-177: the SDK lane's `full` hard-deny IS this constant now — injected, not restated, so
  // the block is pinned to the SAME floor the headless lane applies.
  UNIVERSAL_HARD_DENY,
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

// v2.9: the block digests a grant key. FIX F4: the FULL SHA-256, not a 12-hex (48-bit) prefix.
// The counterparty supplies the exact command / body text, so a 48-bit birthday collision is
// seconds of work on this machine: a benign/malicious pair sharing argv0 + digest gets the benign
// one approved and the twin auto-allowed. §2 SPLIT (2026-08-02): the key machinery itself now
// lives in main/session-grant-keys.js, so the block references `makeGrantKeyFor` / `POST_GRANT` /
// `postFieldsOk` from the module head — injected here exactly like normalizeProfile, and the REAL
// implementations, so the block is still pinned to what ships.
const shaKey = (value) =>
  createHash("sha256").update(String(value == null ? "" : value)).digest("hex");
const KEYS = require(join(HERE, "..", "main", "session-grant-keys.js"));
// F-139 (2026-08-05): the block matches every tool name through mcp-tool-names' normalizers
// (the server segment is the CLIENT's — `mcp__dopl__`, `mcp__claude_ai_Dopl__`, `mcp__<uuid>__`
// are all the same server). Injected like makeGrantKeyFor, and the REAL implementations, so the
// block stays pinned to what ships.
const NAMES = require(join(HERE, "..", "main", "mcp-tool-names.js"));
// 2026-08-22 (OQ-1): the block op-scopes `dopl_kb` the way it has always op-scoped
// `dopl_channel`, reading `isKnowledgeReadCall` off the module head. Injected like
// makeGrantKeyFor, and the REAL implementation, so the block stays pinned to what ships.
const KB_OPS = require(join(HERE, "..", "main", "knowledge-ops.js"));
// 2026-08-24 (Samuel's create_thread ruling): the OWN-CHANNEL OUTBOUND OPS BESIDE THE POST were
// §2-SPLIT into main/session-own-outbound.js — session-profiles.js measured 496 of the 500-line
// cap and could not carry the ruling's argument beside the list it admits to. The block reads
// them off the module head, so they are injected here exactly like `isKnowledgeReadCall`, and
// the REAL implementations, so the block stays pinned to what ships.
// ⚠ `isOwnChannelMarker` / `OWN_CHANNEL_MARKER_OPS` are RE-EXPORTED from the injected module
// rather than returned out of the block, which is why the destructure below shrank.
const OUT = require(join(HERE, "..", "main", "session-own-outbound.js"));
// 2026-08-25 (Samuel's launch ruling, F-320): the OWN-MACHINE LAUNCH LANE is a THIRD §2 file on
// the same precedent — `launch_agent` is not outbound CONTENT, so it could not join the list
// above; it needs BOTH axes plus a launch-depth bound. The block reads `isOwnMachineLaunch` /
// `launchLaneVerdict` off the module head, so they are injected here like everything else, and
// the REAL implementations, so the block stays pinned to what ships.
const LAUNCH = require(join(HERE, "..", "main", "session-own-launch.js"));
// 2026-08-31 (Samuel's same-owner directions ruling): the OWN-MACHINE DIRECT LANE, a FOURTH §2
// file on the same precedent — `direct_agent` buys a TURN on a local process, so it takes the
// launch lane's two-axis conjunction while carrying NO depth bound (that one bounds how many
// agents come into existence; a direction creates none). Injected REAL, like every predicate here.
const DIRECT = require(join(HERE, "..", "main", "session-own-direct.js"));
const AUDIENCE = require(join(HERE, "..", "main", "session-audience.js")); // B2 belt (plan §4.4)

// 2026-08-31 (runtime-adapter port, §0.1b): the AXIS-A TAIL LEFT THIS BLOCK. `buildSessionToolConfig`
// and the mode transforms are a vocabulary of ONE runtime's built-in tool names, so they live in
// `main/runtime/claude/tools.js`; the block asks the REGISTRY for them per call, through the two
// contract methods `toolConfigFor` / `axisAAllows`. `runtimeFor` is injected here exactly like every
// other predicate, and the REAL registry is injected, so the block stays pinned to what ships.
const RUNTIME = require(join(HERE, "..", "main", "runtime", "index.js"));
const CLAUDE_TOOLS = require(join(HERE, "..", "main", "runtime", "claude", "tools.js"));
const buildSessionToolConfig = CLAUDE_TOOLS.buildSessionToolConfig;
const shortDoplName = CLAUDE_TOOLS.shortDoplName;


const { grantDecision, grantKeyFor, POST_GRANT, isOwnChannelPost,
  isChannelTool } = new Function(
  "READ_BUILTINS", "WEB_TOOLS", "DOPL_SAFE_TOOLS", "DENIED_BUILTINS",
  "DOPL_ADMIN_TOOLS", "RETIRED_DOPL_TOOLS", "UNIVERSAL_HARD_DENY", "DOPL_CHANNEL_TOOL", "DOPL_SERVER_PREFIX", "normalizeProfile", "shaKey",
  "makeGrantKeyFor", "POST_GRANT", "postFieldsOk", "mcpShortName", "canonicalDoplName", "isKnowledgeReadCall",
  "OWN_CHANNEL_MARKER_OPS", "OWN_CHANNEL_THREAD_OPS", "OWN_CHANNEL_OUTBOUND_OPS",
  "isOwnChannelMarker", "isOwnChannelThreadOpen", "isOwnChannelOutbound",
  "isOwnMachineLaunch", "launchLaneVerdict",
  "isOwnMachineDirect", "directLaneVerdict",
  // 🔒 2026-08-26 (plan §4.4 B2): the AUDIENCE BELT, injected REAL like every other predicate —
  // a fake would let the harness agree with itself while the shipped gate did something else.
  "containerOnlyDenies", "isDoplToolName", "runtimeFor", "EDIT_TOOLS",
  `${BLOCK}
   return { grantDecision, grantKeyFor, POST_GRANT, isOwnChannelPost,
            isChannelTool };`
)(READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY, DOPL_CHANNEL_TOOL, DOPL_SERVER_PREFIX, normalizeProfile, shaKey,
  KEYS.makeGrantKeyFor, KEYS.POST_GRANT, KEYS.postFieldsOk, NAMES.mcpShortName, NAMES.canonicalDoplName,
  KB_OPS.isKnowledgeReadCall,
  OUT.OWN_CHANNEL_MARKER_OPS, OUT.OWN_CHANNEL_THREAD_OPS, OUT.OWN_CHANNEL_OUTBOUND_OPS,
  OUT.isOwnChannelMarker, OUT.isOwnChannelThreadOpen, OUT.isOwnChannelOutbound,
  LAUNCH.isOwnMachineLaunch, LAUNCH.launchLaneVerdict,
  DIRECT.isOwnMachineDirect, DIRECT.directLaneVerdict,
  AUDIENCE.containerOnlyDenies, NAMES.isDoplToolName, RUNTIME.runtimeFor,
  RUNTIME.capability.editScopedTools(RUNTIME.descriptorFor(null)));
const { isOwnChannelMarker, OWN_CHANNEL_MARKER_OPS } = OUT;

const CHANNEL_SHORT = "dopl_channel";
// ⚠ D7.2 (2026-09-01): THE TWO AGENT-OPS VERBS ARE PART OF THE TABLE NOW, SO THE deepEqual PINS
// BELOW READ THEM. They were pre-approved on all three profiles before this too — but appended in
// `runtime/claude/launch-spec.js`, DOWNSTREAM of `buildSessionToolConfig`, so these three
// assertions passed while the shipped `allowedTools` was two names wider than what they measured.
// That is the defect: a shadow this file could not see. Injected REAL from the module that defines
// the wire, never restated, so a rename cannot make these cases agree with a stale copy.
const AGENT_OPS = require(join(HERE, "..", "main", "agent-self-ops.js")).AGENT_OPS_TOOL_NAMES;
// The work tools that were live-gated under `full` even when the rest of DENIED_BUILTINS was
// hard-denied there. F-177 released the rest, so this list no longer PARTITIONS anything — it
// is kept because these are the tools whose gated-ness is oldest and most load-bearing, and
// several tests below still drive them by name.
const GATED_WORK = ["Bash", "BashOutput", "KillShell", "Write", "Edit", "MultiEdit", "NotebookEdit"];
// F-177 — the whole of `full`'s hard-deny, and the SAME constant the headless lane applies.
// Written as the injected value rather than re-derived: a test that recomputes the partition
// would pass against either behaviour, which is exactly how the two lanes drifted apart.
const HARD_DENY = UNIVERSAL_HARD_DENY.slice();
// What `full` used to hard-deny on top of that floor, and now live-gates instead. Derived by
// subtraction from the REAL shared blacklist so a new DENIED_BUILTINS entry joins it for free.
const RELEASED_UNDER_FULL = DENIED_BUILTINS.filter((t) => !GATED_WORK.includes(t));
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
  assert.deepEqual(cfg.preApproved, READ_BUILTINS.concat(AGENT_OPS)); // FIX H1: no dopl_channel here. D7.2: + the two self-ops verbs, DECLARED
  for (const t of DENIED_BUILTINS.concat(WEB_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, DOPL_SAFE_TOOLS)) {
    assert.ok(cfg.disallowedTools.includes(t), `read_only must deny ${t}`);
  }
  assert.deepEqual(cfg.doplToolsPolicy, [CHANNEL_SHORT]);
});

// ── dopl_only ────────────────────────────────────────────────────────────────

// FIX F2 (v2.9 review): the WORKSPACE-WRITE dopl tools. "Non-admin" is not "read-only" —
// dopl_kb alone registers write_file / create_base / create_folder / move_file, and the
// others carry the same create+update shape. A write lands OFF this machine in rows every
// workspace member can read, which is the same class of move as an outbound post.
// Four since the 2026-08-07 retirement (dopl_workflow / dopl_cluster are unregistered).
const DOPL_WRITE = ["mcp__dopl__dopl_kb", "mcp__dopl__dopl_skill", "mcp__dopl__dopl_ontology",
  "mcp__dopl__dopl_chats"];
const DOPL_READ = DOPL_SAFE_TOOLS.filter((t) => !DOPL_WRITE.includes(t));

test("dopl_only: reads + web + READ-ONLY dopl pre-approved; writes GATE; admins denied", () => {
  const cfg = buildSessionToolConfig("dopl_only");
  assert.deepEqual(cfg.builtinTools, READ_BUILTINS.concat(WEB_TOOLS));
  // FIX H1: no dopl_channel. FIX F2: no dopl WRITE tool either — a shadowed write tool never
  // reaches canUseTool at all, which is the v1.9 half of the `auto` auto-approval hole.
  assert.deepEqual(cfg.preApproved, READ_BUILTINS.concat(WEB_TOOLS, DOPL_READ, AGENT_OPS)); // D7.2: + the two self-ops verbs, DECLARED
  for (const t of DOPL_WRITE) {
    assert.ok(!cfg.preApproved.includes(t), `dopl_only must NOT shadow ${t}`);
    assert.ok(!cfg.disallowedTools.includes(t), `${t} must REACH the gate, not be denied`);
  }
  for (const t of DENIED_BUILTINS.concat(DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS)) {
    assert.ok(cfg.disallowedTools.includes(t), `dopl_only must deny ${t}`);
  }
  for (const t of WEB_TOOLS) assert.ok(!cfg.disallowedTools.includes(t), `dopl_only must not deny ${t}`);
  assert.deepEqual(cfg.doplToolsPolicy, DOPL_SAFE_TOOLS.map(shortDoplName).concat([CHANNEL_SHORT]));
  // ...and under dopl_only they really do stop on a button now.
  for (const t of DOPL_WRITE) {
    assert.equal(grantDecision({ profile: "dopl_only", toolName: t, input: { op: "write_file" } }), "gate", t);
  }
});

// ── full (F-177: the hard-deny is the UNIVERSAL FLOOR; everything else live-gates) ─────

test("F-177: full pre-approves only local reads and hard-denies ONLY the universal floor", () => {
  const cfg = buildSessionToolConfig("full");
  assert.deepEqual(cfg.builtinTools, [], "no positive bound: work tools offered then gated per call");
  assert.deepEqual(cfg.preApproved, READ_BUILTINS.concat(AGENT_OPS),
    "FIX H1: no dopl_channel pre-approved. D7.2: + the two self-ops verbs, DECLARED");
  assert.equal(cfg.doplToolsPolicy, null, "no per-server scoping under full");
  // THE NEW INVARIANT, asserted as an EQUALITY rather than a containment: a containment check
  // ("the floor is denied") passed under the old, broader set too, which is how a lane could
  // hard-deny 25 extra built-ins with nothing failing.
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

test("F-177: the two lanes give the SAME answer for `full` — same names, same constant", () => {
  // The whole point of the change. session-profiles' SESSION_HARD_DENY is literally
  // tool-profiles' UNIVERSAL_HARD_DENY, and the headless lane's buildDeniedTools('full')
  // returns it too, so neither lane can move without the other.
  const headless = require(join(HERE, "..", "main", "tool-profiles.js")).buildDeniedTools("full");
  assert.deepEqual(buildSessionToolConfig("full").disallowedTools.slice().sort(),
    headless.slice().sort(), "SDK `full` and headless `full` must deny exactly the same set");
});

// C-11 (2026-08-08): unknown profiles used to normalize to FULL. `myAgentToolProfile` is null
// for a non-member read, an unrefreshed DTO and any out-of-enum column value, so a profile
// that could not be resolved silently became the widest one — while `session-park.knownProfile`
// answered the same question with read_only one file over. The SDK lane inherits the fix for
// free, because it reads the SAME `normalizeProfile`.
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

// The own-channel post key. v2.9 review FIX F7: POST_GRANT is the BASE and every real key
// extends it with the body digest, so the constant alone matches nothing.
const ownPostKey = (input) => grantKeyFor(DOPL_CHANNEL_TOOL, input, "c1");

test("FIX F2: grantKeyFor op-scopes every dopl_channel shape (own post, cross post, each op)", () => {
  assert.ok(ownPostKey(post("c1")).startsWith(POST_GRANT + "#body:"));
  assert.equal(ownPostKey({ op: "post" }), ownPostKey(post("c1")), "no explicit channel -> own channel");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "open", direct: true }, "c1"), DOPL_CHANNEL_TOOL + "#op:open");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "read" }, "c1"), DOPL_CHANNEL_TOOL + "#op:read");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, { op: "list_tasks" }, "c1"), DOPL_CHANNEL_TOOL + "#op:list_tasks");
  assert.equal(grantKeyFor(DOPL_CHANNEL_TOOL, {}, "c1"), DOPL_CHANNEL_TOOL + "#op:unknown", "a missing op is its own key");
  // A CROSS-channel post carries its target, so a grant to post into one other channel
  // cannot post into a different one (and never collides with the own-channel key). FIX F6:
  // the readable token is followed by a digest of the RAW target.
  assert.ok(ownPostKey(post("OTHER")).startsWith(DOPL_CHANNEL_TOOL + "#op:post:other#" + shaKey("OTHER")));
  assert.notEqual(ownPostKey(post("OTHER")), ownPostKey(post("SECOND")));
  // Sanitizing must not let a junk op collapse onto the own-channel post key.
  for (const junk of [{ op: "post ", channel: "OTHER" }, { op: "p!o!s!t", channel: "OTHER" }]) {
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

test("D2: an 'Allow for this session' taken on a POST authorizes posts only, never op=open", () => {
  const granted = [ownPostKey(post("c1"))];
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

// ── F-177: the released set gates under full and STILL denies under the restricted two ──

test("F-177: Task/Agent/CronCreate/SendMessage are 'gate' (NOT 'deny') under full", () => {
  // The inversion of the old FIX H2 assertion. `full` means full: these exist and they stop on
  // an operator button, which is what `manual`/`auto`/`bypass` is for.
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
  // A subagent is a fresh session that does not inherit this session's canUseTool bound, which
  // is why read_only / dopl_only keep refusing it outright. Under `full` the operator has the
  // shell anyway, so the refusal bought nothing and cost the delegation feature.
  for (const p of ["read_only", "dopl_only"]) {
    assert.equal(grantDecision({ profile: p, toolName: "Task" }), "deny", `${p}: Task must deny`);
    assert.equal(grantDecision({ profile: p, toolName: "Agent" }), "deny", `${p}: Agent must deny`);
  }
});
