// THE CODEX ADAPTER AT THE GATE — Axis A in Codex's own vocabulary, Axis B's pin, the containment
// table, the stamp, and the launch shape.
//
// ⚠ THE SUBJECT IS THE ADAPTER, NOT THE GATE. `main/session-profiles.js › grantDecision` — its
// order, its four verdicts, every Axis-B lane — is core and is pinned by its own suites on every
// runtime. What is measured here is that driving that ONE decision function with `runtime: 'codex'`
// resolves steps 1 and 4 in CODEX's words and reaches the same answers, including the two the
// v2.9 contract forbids being reachable from the wrong axis.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const CODEX = join(MAIN, "runtime", "codex");

const profiles = require(join(MAIN, "session-profiles.js"));
const registry = require(join(MAIN, "runtime", "index.js"));
const capability = require(join(MAIN, "runtime", "capability.js"));
const tools = require(join(CODEX, "tools.js"));
const approval = require(join(CODEX, "approval.js"));
const axisB = require(join(CODEX, "axis-b.js"));
const mcp = require(join(CODEX, "mcp.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));

const D = registry.descriptorFor("codex");
const RT = registry.runtimeFor("codex");
const CHANNEL = "mcp__dopl__dopl_channel";

const decide = (over) => profiles.grantDecision({
  runtime: "codex", profile: "full", toolMode: "untrusted", messageMode: "ask",
  channelId: "chan-1", allowForTask: [], ...over,
});

// ── AXIS A, IN CODEX'S OWN WORDS ─────────────────────────────────────────────────────────────

test("the four modes are `approval_policy`'s own values, and nothing was synthesised", () => {
  // ⚠ §2 of `codex-research.md`: "Do not invent synonyms; Codex users already know these words".
  assert.deepEqual(capability.toolModes(D), ["untrusted", "granular", "on-request", "never"]);
  // `on-failure` is documented as DEPRECATED and is deliberately not offered.
  assert.ok(!capability.toolModes(D).includes("on-failure"));
  // No mode borrowed from the other runtime's vocabulary.
  for (const claudeWord of ["manual", "accept_edits", "auto", "bypass"]) {
    assert.ok(!capability.toolModes(D).includes(claudeWord), `${claudeWord} is not a Codex word`);
  }
});

test("Axis A widens by mode, and an UNRECOGNISED name gates in EVERY mode — `never` included", () => {
  const read = "mcp__dopl__dopl_search";
  const write = "mcp__dopl__dopl_kb";
  assert.equal(RT.axisAAllows("untrusted", read), true, "known-safe reads run at the narrowest mode");
  assert.equal(RT.axisAAllows("untrusted", tools.FILE_ITEM), false);
  assert.equal(RT.axisAAllows("on-request", tools.FILE_ITEM), true, "in-workspace edits run");
  assert.equal(RT.axisAAllows("on-request", tools.COMMAND_ITEM), false, "the shell still asks");
  assert.equal(RT.axisAAllows("never", tools.COMMAND_ITEM), true);
  assert.equal(RT.axisAAllows("never", write), true);
  // ⚠ POSITIVE ALLOW-LISTS, NEVER NEGATIVE. A negative mode auto-allows every unrecognised name —
  // '', null, a category a later CLI adds, a renamed channel tool — and hard-deny is a build-time
  // blacklist that cannot cover them.
  for (const mode of capability.toolModes(D)) {
    for (const junk of ["", null, undefined, "somethingNew", "request_permissions", "skill_approval"]) {
      assert.equal(RT.axisAAllows(mode, junk), false, `${mode} / ${JSON.stringify(junk)}`);
    }
  }
});

test("`granular` is treated as no wider than `untrusted`, because its categories are Codex's", () => {
  // ⚠ THE FAIL-CLOSED READING, AND IT IS THE HONEST ONE. The five categories are configured on
  // Codex's side and this process cannot read them, so Dopl's own gate must not assume any of
  // them is on. What picking `granular` changes is what CODEX prompts for; what Dopl allows
  // without a card stays at its narrowest.
  for (const name of [tools.FILE_ITEM, tools.COMMAND_ITEM, "mcp__dopl__dopl_kb"]) {
    assert.equal(RT.axisAAllows("granular", name), RT.axisAAllows("untrusted", name), name);
  }
  assert.equal(RT.axisAAllows("granular", "mcp__dopl__dopl_search"), true, "reads still run");
});

test("an unknown mode fail-closes to the NARROWEST, and the default IS the narrowest", () => {
  assert.equal(tools.normalizeToolMode("not-a-policy"), "untrusted");
  assert.equal(tools.normalizeToolMode(undefined), "untrusted");
  assert.equal(D.toolMode.default, "untrusted", "a session starts asking; a park resets it there");
});

test("the WINDOWLESS FLOOR resolves to a CODEX mode that really reaches a tool", () => {
  // ⚠ THE FAILURE THIS DECLARATION EXISTS TO PREVENT: a mode that fail-closes to a vocabulary the
  // runtime does not speak allows NOTHING, and on a surface-less session a gated tool is a silent
  // DENY — including the reads the prompt ORDERS the agent to make.
  const floor = capability.windowlessToolFloor(D);
  assert.equal(floor, "on-request");
  assert.ok(!["manual", "auto", "bypass"].includes(floor), "the floor must be this runtime's word");
  assert.equal(RT.axisAAllows(floor, capability.toolTaxonomy(D).auto[0]), true);
  // Widen-only: nothing is ever narrowed by a floor.
  assert.equal(capability.floorWindowlessTool(D, "untrusted"), "on-request");
  assert.equal(capability.floorWindowlessTool(D, "granular"), "on-request");
  assert.equal(capability.floorWindowlessTool(D, "never"), "never");
  assert.equal(capability.floorWindowlessTool(D, "garbage"), "on-request");
});

// ── THE v2.9 INVARIANT, BOTH DIRECTIONS ──────────────────────────────────────────────────────

test("AXIS A CAN NEVER AUTO-APPROVE A MESSAGE OP — at any mode, on this runtime", () => {
  // `grantDecision` branches a channel tool to Axis B BEFORE Axis A is consulted, on every
  // runtime. Driven here rather than asserted, over the widest mode this runtime offers.
  for (const toolMode of capability.toolModes(D)) {
    const v = decide({ toolName: CHANNEL, input: { op: "post", body: "hi" }, toolMode });
    assert.equal(v, "gate", `${toolMode}: a tool posture sent a message`);
  }
});

test("AXIS B CAN NEVER AUTO-APPROVE A WORK TOOL — at any message posture", () => {
  for (const messageMode of ["ask", "auto_inbound", "auto_outbound", "auto_both"]) {
    const v = decide({ toolName: tools.COMMAND_ITEM, input: { command: "rm -rf /" }, messageMode });
    assert.equal(v, "gate", `${messageMode}: a message posture ran a command`);
  }
});

test("…and the Axis-B lanes still work in this runtime's session", () => {
  // The lanes are core's and identical everywhere; this proves the Codex branch reaches them.
  assert.equal(decide({ toolName: CHANNEL, input: { op: "post", body: "hi" }, messageMode: "auto_outbound" }), "allow");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "read" }, messageMode: "auto_inbound" }), "allow");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "post", channel: "other", body: "x" }, messageMode: "auto_outbound" }), "gate",
    "a cross-channel post is the exfil shape and gates in every posture");
});

// ── CONTAINMENT ──────────────────────────────────────────────────────────────────────────────

test("the restricted profiles deny in CODEX's words AND pin the native sandbox", () => {
  for (const profile of ["read_only", "dopl_only"]) {
    const cfg = RT.toolConfigFor(profile);
    for (const name of [tools.COMMAND_ITEM, tools.FILE_ITEM, "sandbox_approval", "request_permissions", "skill_approval"]) {
      assert.ok(cfg.disallowedTools.includes(name), `${profile} does not deny ${name}`);
      assert.equal(decide({ profile, toolName: name, toolMode: "never" }), "deny",
        "hard deny is not openable by the widest mode");
    }
    // ⚠ A SANDBOX BOUNDS THE FILESYSTEM; IT DOES NOT DENY EXFIL OR ESCALATION. Both layers, or the
    // profile has no enforcement of its own (design §0.1a).
    assert.equal(cfg.native.sandbox_mode, "read-only");
    assert.equal(cfg.native.approval_policy, "untrusted");
    assert.equal(D.containment.profiles[profile].native.sandbox_mode, "read-only");
  }
  // `full` is the UNIVERSAL FLOOR and nothing else, and it pins no native pair — its supervision
  // IS Axis A plus the operator's sandbox row.
  assert.deepEqual(RT.toolConfigFor("full").disallowedTools,
    require(join(MAIN, "tool-profiles.js")).UNIVERSAL_HARD_DENY);
  assert.equal(D.containment.profiles.full.native, null);
});

test("`dopl_channel` is in NEITHER list on EVERY profile — it must reach the gate", () => {
  for (const profile of ["read_only", "dopl_only", "full"]) {
    const cfg = RT.toolConfigFor(profile);
    assert.ok(!cfg.disallowedTools.includes(CHANNEL), `${profile} denies the delivery path`);
    assert.ok(!cfg.preApproved.includes(CHANNEL), `${profile} SHADOWS the delivery path past the gate`);
    assert.equal(decide({ profile, toolName: CHANNEL, input: { op: "post", body: "x" } }), "gate");
  }
});

test("NOTHING is pre-approved on this runtime, so nothing is shadowed past the gate", () => {
  // ⚠ NOT AN OMISSION. The other runtime pre-approves its read built-ins because a read there
  // would otherwise raise a prompt; Codex raises no approval request for a read at all, so there
  // is no name to pre-approve and listing one would create a shadow that buys nothing.
  for (const profile of ["read_only", "dopl_only", "full"]) {
    assert.deepEqual(RT.toolConfigFor(profile).preApproved, [], profile);
  }
});

test("the universal hard deny is Dopl's own, unchanged, and openable by nothing", () => {
  const hard = require(join(MAIN, "tool-profiles.js")).UNIVERSAL_HARD_DENY;
  assert.deepEqual(D.axisB.hardDeny, hard);
  for (const name of hard) {
    for (const profile of ["read_only", "dopl_only", "full"]) {
      assert.equal(decide({ profile, toolName: name, toolMode: "never", allowForTask: [name] }), "deny",
        `${profile}/${name}: hard deny was opened`);
    }
  }
});

// ── THE APPROVAL ANSWER ──────────────────────────────────────────────────────────────────────

test("a Dopl allow answers `accept`, and NOTHING ever answers `acceptForSession`", () => {
  // ⚠ THE DOUBLE-COUNT REFUSAL (§4 item 2 of the research; the 1.7.10 fused-checkbox class). Codex
  // HAS a native "stop asking for the rest of this session"; sending it would record ONE operator
  // click on TWO ledgers, and the second one's scope is §5 item C4 — unread. One click, one
  // ledger, one scope: the one the operator was shown.
  assert.deepEqual(approval.answerApproval({}, "allow"), { decision: "accept" });
  for (const verdict of ["deny", "allow-task", "", null, undefined, 42, {}]) {
    const answer = approval.answerApproval({ message: "no" }, verdict);
    assert.equal(answer.decision, "decline", JSON.stringify(verdict));
  }
  // …and a standing Dopl grant still answers `accept`, never the native session word.
  const key = profiles.grantKeyFor(CHANNEL, { op: "post", body: "hi" }, "chan-1");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "post", body: "hi" }, allowForTask: [key] }), "allow");
  assert.deepEqual(approval.answerApproval({}, "allow"), { decision: "accept" });
  // The source itself: every mention of the word is an argument in a comment, never a value.
  const src = readFileSync(join(CODEX, "approval.js"), "utf8");
  for (const line of src.split("\n")) {
    if (!line.includes("acceptForSession")) continue;
    assert.match(line.trim(), /^(\/\/|\*)/, `a CODE line names acceptForSession: ${line.trim()}`);
  }
});

test("a raw approval request becomes one of CODEX's own words, and an unknown one stays raw", () => {
  assert.equal(approval.toolNameFor({ method: "item/commandExecution/requestApproval" }), "commandExecution");
  assert.equal(approval.toolNameFor({ method: "item/fileChange/requestApproval" }), "fileChange");
  assert.equal(approval.toolNameFor({ params: { category: "skill_approval" } }), "skill_approval");
  assert.equal(approval.toolNameFor({ toolName: "dopl_channel" }), "dopl_channel");
  // ⚠ AN UNRECOGNISED METHOD ANSWERS ITS OWN STRING, NOT A FALLBACK. A name in no Axis-A list
  // gates in every mode, so a shape a later CLI adds ASKS instead of inheriting a granted one.
  assert.equal(approval.toolNameFor({ method: "item/networkAccess/requestApproval" }), "networkAccess");
  assert.equal(RT.axisAAllows("never", "networkAccess"), false);
});

// ── THE STAMP ────────────────────────────────────────────────────────────────────────────────

test("the PreToolUse stamp injects the thread tag and NEVER carries a decision", () => {
  // ⚠ ONE PLACE DECIDES, ONE PLACE STAMPS (design §0.1). A hook that also rendered a verdict would
  // put the gate in two places, which is the hole each review misses — the F-228 / 1.7.10 lesson.
  const s = { channelId: "chan-1", taskId: "task-9", agentId: "abcd1234" };
  const out = axisB.preToolUseStamp(
    { tool_name: "dopl_channel", tool_input: { op: "post", body: "hi" } }, s
  );
  assert.equal(out.updatedInput.thread, "task-9");
  assert.equal(out.updatedInput.client_msg_id, "agent-abcd1234-1");
  assert.ok(!("decision" in out), "a verdict in the hook is a gate in two places");
  assert.equal(out.updatedInput.body, "hi", "the rest of the call is untouched");
});

test("…and it rewrites NOTHING it is not entitled to rewrite", () => {
  const base = { channelId: "chan-1", taskId: "task-9", agentId: "abcd1234" };
  // A CROSS-channel post is the exfiltration shape and is not ours to rewrite.
  const cross = axisB.preToolUseStamp(
    { tool_name: "dopl_channel", tool_input: { op: "post", channel: "other", body: "x" } }, { ...base }
  );
  assert.equal(cross.updatedInput.thread, undefined);
  // A conflict — the agent deliberately named ANOTHER thread — leaves the WHOLE call as written.
  const conflict = axisB.preToolUseStamp(
    { tool_name: "dopl_channel", tool_input: { op: "post", thread: "task-other", body: "x" } }, { ...base }
  );
  assert.equal(conflict.updatedInput.thread, "task-other");
  assert.ok(!("client_msg_id" in conflict.updatedInput), "half a rewrite is worse than none");
  // A non-channel call passes through unchanged.
  const other = axisB.preToolUseStamp({ tool_name: "commandExecution", tool_input: { command: "ls" } }, { ...base });
  assert.deepEqual(other.updatedInput, { command: "ls" });
  // ⚠ NO ID IS MINTED FOR A CALL IT WILL NOT STAMP: `nextOwnPostId` mutates the session's bounded
  // ring, so spending ids on calls that never post would blunt the fan-out self-filter's lookback.
  const s = { channelId: "chan-1", taskId: "task-9", agentId: "abcd1234" };
  axisB.preToolUseStamp({ tool_name: "commandExecution", tool_input: {} }, s);
  axisB.preToolUseStamp({ tool_name: "dopl_channel", tool_input: { op: "post", body: "a" } }, s);
  assert.ok(s.ownPostIds.has("agent-abcd1234-1"), "the first STAMPED post is #1");
});

test("Axis B declares a real enforcement point and an UNVERIFIED op scope", () => {
  assert.equal(capability.axisBEnforcement(D), "held-callback");
  // ⚠ `capability.axisBOpScoped` reads anything but `true` as NOT op-scoped — the fail-closed
  // direction, and the one that is true today (§5 item C1). Declaring `true` would assume the
  // answer to the item that changes step 7's design rather than one field.
  assert.equal(D.axisB.opScoped, "unverified");
  assert.equal(capability.axisBOpScoped(D), false);
  assert.equal(capability.inputRewrite(D), "hook-updatedInput");
});

// ── THE LAUNCH SHAPE ─────────────────────────────────────────────────────────────────────────

test("config overrides flatten to leaf scalars, and header names are quoted", () => {
  const args = launchSpec.overrideArgs({
    approval_policy: "untrusted",
    mcp_servers: { dopl: { url: "https://x/api/mcp", http_headers: { "X-Dopl-Vendor": "codex" } } },
  });
  assert.deepEqual(args, [
    "-c", 'approval_policy="untrusted"',
    "-c", 'mcp_servers.dopl.url="https://x/api/mcp"',
    "-c", 'mcp_servers.dopl.http_headers."X-Dopl-Vendor"="codex"',
  ]);
});

test("a RESTRICTED profile pins the native pair; `full` rides the operator's own picks", () => {
  const restricted = launchSpec.nativePair(
    { state: { toolMode: "never", sandboxMode: "danger-full-access" } },
    RT.toolConfigFor("read_only")
  );
  assert.deepEqual(restricted, { approval_policy: "untrusted", sandbox_mode: "read-only" },
    "containment is not the operator's to widen from the mode picker");
  const full = launchSpec.nativePair(
    { state: { toolMode: "on-request", sandboxMode: "danger-full-access" } }, RT.toolConfigFor("full")
  );
  assert.deepEqual(full, { approval_policy: "on-request", sandbox_mode: "danger-full-access" });
  // An absent or unrecognised sandbox pick lands on Codex's OWN default, not on the widest.
  const bare = launchSpec.nativePair({ state: { toolMode: "junk", sandboxMode: "junk" } }, RT.toolConfigFor("full"));
  assert.deepEqual(bare, { approval_policy: "untrusted", sandbox_mode: "workspace-write" });
});

test("`--ignore-user-config` is first, and it is the fence the operator's config cannot cross", () => {
  const spec = launchSpec.buildLaunchSpec({
    session: { profile: "full", channelId: null, state: {}, workspaceId: "", model: "" },
    dispatch: () => {}, emitQuiet: () => {},
  });
  assert.equal(spec.args[0], "--ignore-user-config");
});

test("the env scrub can only REMOVE, and it never takes PATH, HOME or a credential", () => {
  const before = process.env.CODEX_BYPASS_APPROVALS;
  process.env.CODEX_BYPASS_APPROVALS = "1";
  try {
    const env = launchSpec.buildScrubbedEnv({ EXTRA: "x" });
    assert.equal(env.CODEX_BYPASS_APPROVALS, undefined, "a permission-shaped knob is dropped");
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.HOME, process.env.HOME);
    assert.equal(env.EXTRA, "x");
  } finally {
    if (before === undefined) delete process.env.CODEX_BYPASS_APPROVALS;
    else process.env.CODEX_BYPASS_APPROVALS = before;
  }
});

test("the Dopl MCP entry pins the channel tool and keeps the bearer OFF ARGV", () => {
  const entry = mcp.buildDoplServerEntry(["dopl_channel"]);
  // ⚠ AXIS B'S PIN, INDEPENDENT OF AXIS A. The operator's policy may be as wide as `never`; the
  // channel tool must still reach the gate, because no tool posture can send a message.
  assert.equal(entry.tools.dopl_channel.approval_mode, "prompt");
  assert.equal(entry.default_tools_approval_mode, "writes");
  assert.deepEqual(entry.enabled_tools, ["dopl_channel"]);
  // ⚠ A VARIABLE NAME, NEVER A TOKEN. An override carrying the bearer would put the device token
  // on a command line every `ps` on the machine can read.
  assert.equal(entry.bearer_token_env_var, mcp.BEARER_ENV);
  assert.ok(!JSON.stringify(entry).includes("Bearer "), "no literal credential anywhere in the entry");
  // CUSTODY and VENDOR are two facts on two headers — the whole reason step 1 was a second
  // dimension rather than three more enum members.
  assert.equal(entry.http_headers["X-Dopl-Runtime"], "desktop-session");
  assert.equal(entry.http_headers["X-Dopl-Vendor"], "codex");
  const shared = readFileSync(join(HERE, "..", "..", "src", "shared", "auth", "runtime-header.ts"), "utf8");
  const serverCodex = /export const CODEX_VENDOR = "([^"]+)";/.exec(shared);
  assert.ok(serverCodex, "the server's vendor constant moved — this join needs re-pinning");
  assert.equal(entry.http_headers["X-Dopl-Vendor"], serverCodex[1],
    "main claims a vendor value readVendorHeader does not recognize (no shared module across this join)");
});

test("a session with NO token gets NO Dopl entry, and still launches", () => {
  // ⚠ A HALF-BUILT ENTRY THAT 401s ON EVERY CALL IS WORSE THAN NONE: the agent would be told it
  // HAS a delivery path and watch that path fail.
  const wired = mcp.buildMcpEnv("", "", "");
  if (!wired.usable) {
    assert.deepEqual(wired.env, {});
  } else {
    assert.ok(wired.env[mcp.BEARER_ENV], "a usable wiring must carry the bearer in the ENV");
  }
});

// ── REFUSALS THAT ARE DECLARATIONS ───────────────────────────────────────────────────────────

test("resume is REFUSED with a readable reason, and a cold launch is unaffected", () => {
  assert.equal(capability.canResume(D), false);
  assert.match(String(capability.resumeRefusal(D)), /unverified/);
  assert.throws(() => launchSpec.resume({ session: {} }, null), /unverified/,
    "the adapter refuses at its own door rather than declaring a block nothing enforces");
});

test("triage is DECLARED absent rather than shipped with two fences missing", () => {
  assert.equal(D.triage, null);
  assert.equal(RT.triageSpec({}), null);
});

test("the cost cap is HIDDEN, the sign-in button is HIDDEN, and neither is grayed", () => {
  assert.equal(capability.showsCostCap(D), false, "a cap fed by a field the platform never emits");
  assert.equal(capability.hasInteractiveSignIn(D), false);
  assert.equal(RT.signIn(), null, "a method whose capability is absent still EXISTS and answers null");
  assert.equal(capability.hasDeepLink(D), false);
  assert.equal(capability.toolSearchVerb(D), null, "the sentence is omitted, never translated");
  assert.equal(capability.entryFile(D), "AGENTS.md");
});

test("packaging is `path`, so `available()` is a real probe with a readable refusal", () => {
  assert.equal(D.packaging.delivery, "path");
  assert.equal(D.packaging.unpackGlobs, null, "a path-delivered runtime unpacks nothing");
  assert.equal(D.packaging.versionPin, null, "a pin would be a claim about a binary we do not ship");
});
