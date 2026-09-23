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
import { startedStateFor } from "./_session-preset-harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const CODEX = join(MAIN, "runtime", "codex");

const profiles = require(join(MAIN, "session-profiles.js"));
const registry = require(join(MAIN, "runtime", "index.js"));
const capability = require(join(MAIN, "runtime", "capability.js"));
const tools = require(join(CODEX, "tools.js"));
const serverRequests = require(join(CODEX, "server-requests.js"));
const mcp = require(join(CODEX, "mcp.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));
// ⚠ READ-ONLY HERE: the packaging pin is compared against `SUPPORTED_CLI`, which client.js owns.
const client = require(join(CODEX, "client.js"));

const D = registry.descriptorFor("codex");
// A Codex session's state as `session-engine.js › startSession` builds it for the button lane.
const codexState = (startModes) => ({ state: startedStateFor({ windowless: true, startModes: { messages: "ask", ...startModes } }, { id: "codex" }) });
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
  const floor = D.toolMode.windowlessFloor;
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
    const v = decide({ toolName: CHANNEL, input: { op: "send", body: "hi" }, toolMode });
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
  assert.equal(decide({ toolName: CHANNEL, input: { op: "send", body: "hi" }, messageMode: "auto_outbound" }), "allow");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "read" }, messageMode: "auto_inbound" }), "allow");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "send", channel: "other", body: "x" }, messageMode: "auto_outbound" }), "gate",
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
    assert.equal(decide({ profile, toolName: CHANNEL, input: { op: "send", body: "x" } }), "gate");
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
  assert.deepEqual(serverRequests.decisionReply("allow"), { decision: "accept" });
  for (const verdict of ["deny", "allow-task", "", null, undefined, 42, {}]) {
    const answer = serverRequests.decisionReply(verdict);
    assert.equal(answer.decision, "decline", JSON.stringify(verdict));
  }
  // …and a standing Dopl grant still answers `accept`, never the native session word.
  const key = profiles.grantKeyFor(CHANNEL, { op: "send", body: "hi" }, "chan-1");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "send", body: "hi" }, allowForTask: [key] }), "allow");
  assert.deepEqual(serverRequests.decisionReply("allow"), { decision: "accept" });
  // The source itself: every mention of the word is an argument in a comment, never a value.
  const src = readFileSync(join(CODEX, "server-requests.js"), "utf8");
  for (const line of src.split("\n")) {
    if (!line.includes("acceptForSession")) continue;
    assert.match(line.trim(), /^(\/\/|\*)/, `a CODE line names acceptForSession: ${line.trim()}`);
  }
});

test("THE MOUNT KEY AND THE ELICITATION'S SERVER COMPARISON ARE ONE CONSTANT", () => {
  // 🔒 ⚠ THE JOIN THE WHOLE ALLOW PATH TURNS ON. `server-requests.js` opens the Dopl elicitation's
  // path on `serverName === mcp.SERVER_KEY`; `launch-spec.js` mounts the entry under a key. If
  // those were two literals, a rename could move the mount without moving the comparison — which
  // closes the channel silently, or (worse) leaves the old word available for something else to
  // claim. This drives the REAL launch assembly and compares what it mounted.
  const spec = launchSpec.buildLaunchSpec({
    session: {
      profile: "full", channelId: null, state: {}, workspaceId: "ws-1", model: "",
      // A container-locked bearer, which is what makes the entry wired and the config present.
      containerToken: { token: "test-bearer-not-a-real-token" },
    },
    dispatch: () => {},
  });
  const mounted = Object.keys(spec.threadStart.config.mcp_servers);
  assert.deepEqual(mounted, [mcp.SERVER_KEY],
    "the launch mounts Dopl's server under a key the elicitation comparison does not know");
  // …and the comparison really is identity against THAT key, not a near-match.
  const meta = { codex_approval_kind: "mcp_tool_call", tool_title: "dopl_channel", tool_params: { op: "read" } };
  assert.equal(serverRequests.doplElicitation({ serverName: mounted[0], _meta: meta }).name, "dopl_channel");
  assert.ok(serverRequests.doplElicitation({ serverName: mounted[0] + "x", _meta: meta }).refused);
});

test("a Dopl elicitation reaches AXIS B with the call's own op — the blocker, end to end", () => {
  // 🔒 ⚠ **THE CASE THAT SAYS A DOPL-LAUNCHED CODEX AGENT CAN POST.** The tool is named by
  // `_meta.tool_title`, the arguments ride `_meta.tool_params`, and both are handed to the SAME
  // `grantDecision` every other runtime asks.
  const target = serverRequests.doplElicitation({
    serverName: mcp.SERVER_KEY,
    message: 'Allow the dopl MCP server to run tool "dopl_channel"?',
    _meta: { codex_approval_kind: "mcp_tool_call", tool_title: "dopl_channel", tool_params: { op: "send", body: "hi" } },
  });
  assert.equal(target.name, mcp.CHANNEL_TOOL);
  // Axis B's lanes, reached through the elicitation's own name and input.
  assert.equal(decide({ toolName: target.name, input: target.input, messageMode: "auto_outbound" }), "allow");
  assert.equal(decide({ toolName: target.name, input: target.input, messageMode: "ask" }), "gate");
  // ⚠ AND THE INVARIANT IS UNMOVED: no TOOL posture sends a message, at any mode.
  for (const toolMode of capability.toolModes(D)) {
    assert.equal(decide({ toolName: target.name, input: target.input, toolMode }), "gate", toolMode);
  }
  // …and the exfil shape still gates at the widest message posture.
  assert.equal(decide({
    toolName: target.name, input: { op: "send", channel: "other", body: "x" }, messageMode: "auto_both",
  }), "gate");
});

test("an approval method this build does not know is refused -32601 and never reaches the gate", async () => {
  // A reply in the wrong shape hangs the turn, so an unknown method gets the method-agnostic error.
  const asked = [];
  await assert.rejects(
    serverRequests.answer({ method: "item/networkAccess/requestApproval", params: {} }, async (n) => { asked.push(n); return "allow"; }),
    (err) => err.rpcCode === -32601,
  );
  assert.deepEqual(asked, []);
});

test("Axis B declares a real enforcement point and a MEASURED op scope", () => {
  assert.equal(D.axisB.enforcementPoint, "held-callback");
  assert.equal(D.axisB.opScoped, true, "measured 2026-09-22 (CXP-3A): op + args reach the gate");
  assert.equal(D.axisB.inputRewrite, null, "no route carries a rewritten input on this runtime");
});

// ── THE LAUNCH SHAPE ─────────────────────────────────────────────────────────────────────────

test("a RESTRICTED profile pins the native pair; `full` rides the operator's own picks", () => {
  // The pick arrives on `state.native`, stamped at spawn (F-390: `state.sandboxMode` never had a
  // producer). Containment is not the operator's to widen from the mode picker, and an unreadable
  // pick lands on Codex's own default rather than the widest.
  const restricted = launchSpec.nativePair(
    { state: { toolMode: "never", native: { sandbox_mode: "danger-full-access" } } },
    RT.toolConfigFor("read_only")
  );
  assert.deepEqual(restricted, { approval_policy: "untrusted", sandbox_mode: "read-only" },
    "containment is not the operator's to widen from the mode picker");
  // The state production builds (a hand-built `toolMode: 'on-request'` hid X-01 / P4-02).
  const full = launchSpec.nativePair(
    codexState({ tools: "on-request", native: { sandbox_mode: "danger-full-access" } }),
    RT.toolConfigFor("full")
  );
  assert.deepEqual(full, { approval_policy: "on-request", sandbox_mode: "danger-full-access" },
    "…and at `full` the operator's own pick finally REACHES the launch");
  // An UNRECOGNISED sandbox pick fail-closes to the narrowest, the same answer main's record
  // normalizer gives (X-05); only an ABSENT one takes Codex's own default.
  const bare = launchSpec.nativePair(
    { state: { toolMode: "junk", native: { sandbox_mode: "junk" } } }, RT.toolConfigFor("full")
  );
  assert.deepEqual(bare, { approval_policy: "untrusted", sandbox_mode: "read-only" });
  // ⚠ AND A SESSION STAMPED WITH NO BAG AT ALL IS THE SAME ANSWER — every spawn shape that hands
  // in no posture (a peer wake, a crash resume, a woken shell) keeps exactly today's behaviour.
  assert.deepEqual(launchSpec.nativePair(codexState({ tools: "on-request" }), RT.toolConfigFor("full")),
    { approval_policy: "on-request", sandbox_mode: "workspace-write" });
  // ⚠ THE OLD FIELD NAME IS DEAD AND MUST STAY DEAD: reading it again would restore a control
  // whose value nothing writes.
  assert.deepEqual(
    launchSpec.nativePair({ state: { toolMode: "on-request", sandboxMode: "danger-full-access" } },
      RT.toolConfigFor("full")),
    { approval_policy: "on-request", sandbox_mode: "workspace-write" }
  );
});

test("`granular` uses the measured structured app-server shape and asks every shown category", () => {
  assert.deepEqual(launchSpec.approvalPolicy("granular"), {
    granular: {
      mcp_elicitations: true,
      rules: true,
      sandbox_approval: true,
      request_permissions: true,
      skill_approval: true,
    },
  });
});

test("the removed `--ignore-user-config` flag is never sent; CODEX_HOME owns isolation", () => {
  const spec = launchSpec.buildLaunchSpec({
    session: { profile: "full", channelId: null, state: {}, workspaceId: "", model: "" },
    dispatch: () => {},
  });
  assert.ok(!spec.args.includes("--ignore-user-config"));
  assert.deepEqual(spec.args, []);
  assert.equal(spec.threadStart.approvalPolicy, "untrusted");
  assert.equal(spec.threadStart.sandbox, "workspace-write");
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

test("the Dopl MCP entry makes every Dopl call but a whole-tool read ask, and keeps the bearer OFF ARGV", () => {
  const entry = mcp.buildDoplServerEntry(["dopl_channel"]);
  // ⚠ EVERY CALL REACHES THE GATE, INDEPENDENT OF AXIS A — the channel tool because no tool posture
  // can send a message, the write tools because the gate judges them per op. A tool Dopl does not
  // know yet asks too (the default).
  assert.equal(entry.default_tools_approval_mode, "prompt");
  assert.equal(entry.tools.dopl_channel, undefined, "the channel inherits the asking default");
  // Only the whole-tool reads never ask (`approve`; `auto` was MEASURED to ask, CXP-3A).
  const neverAsk = Object.keys(entry.tools).filter((t) => entry.tools[t].approval_mode === "approve");
  const granularReads = require(join(MAIN, "session-dopl-tools.js")).GRANULAR_READ_TOOLS;
  assert.deepEqual(neverAsk.map((t) => `mcp__dopl__${t}`).sort(), profiles.DOPL_READ_TOOLS.concat(granularReads).sort());
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

test("resume is ALLOWED on the measured baseline, and the adapter's own door opens with it", () => {
  // 🔒 ⚠ **THE REASON WAS A MEASUREMENT, AND CORE NOW ACTS ON IT** (2026-09-22, `codex-cli
  // 0.155.1`): `thread/tokenUsage/updated.total` CONTINUES across `thread/resume` in a fresh
  // app-server, so the declaration is `false`. Until CXP-4 that was read as disqualifying, because
  // `session-park.js › resumeParked` ZEROED the delta baseline unconditionally and would have
  // re-billed the whole thread. The baseline is runtime-aware now — a `false` runtime has it
  // CARRIED FORWARD — so `false` is a resumable answer and only `'unverified'` still refuses.
  // `codex-live-session.test.mjs` holds the measurement; `session-park-resume-baseline.test.mjs`
  // holds the billing arithmetic and the argument for the change.
  assert.equal(D.session.usageResetsOnResume, false, "the MEASUREMENT has not moved and must not");
  assert.equal(capability.canResume(D), true);
  assert.equal(capability.resumeRefusal(D), null);
  assert.equal(capability.resumeZeroesBaseline(D, null), false,
    "…and what changed is the arithmetic: this runtime's baseline is carried, never zeroed");
  // ⚠ `launch-spec.js › resume` ASKS THAT PREDICATE RATHER THAN RESTATING IT, so its door opened
  // with no edit. Asserted through the predicate rather than by CALLING it — `resume` falls
  // through to `start`, which spawns a real app-server child.
  assert.equal(typeof launchSpec.resume, "function");
});

test("the in-app sign-in is DECLARED (2026-09-23); the tool-search verb is MEASURED", () => {
  // The bundled app-server's own login (`login.js`); called here it would spawn one, so only its shape.
  assert.equal(D.credential.interactiveSignIn, true);
  assert.equal(D.credential.reprobeOnWake, true, "a terminal `codex login` still releases a held agent");
  assert.equal(typeof RT.signIn, "function");
  // 🔒 CXP-3A (2026-09-22, 0.155.1): MEASURED, no longer null — Codex defers every MCP tool.
  assert.equal(D.prose.toolSearchVerb, "tool_search", "the measured verb, never Claude's");
  // …and code-mode models reach the same tool through `exec`'s `ALL_TOOLS` (measured, same day).
  assert.deepEqual(capability.mcpDiscovery(D), { verb: "tool_search", catalog: "ALL_TOOLS" }, "no eager-load flag");
});

test("packaging is `bundled`, so the release makes a version claim it can keep", () => {
  // 🔒 ⚠ **THIS CASE ASSERTED `path` UNTIL 2026-09-22**, when Samuel ruled the binary gets bundled
  // — *"i think we should go with the binary. Let's just do it."* The three fields move together
  // or the descriptor is lying: a `bundled` delivery that unpacks nothing ships a binary inside a
  // read-only asar that cannot exec, and one with a null pin ships a protocol build it refuses to
  // name.
  assert.equal(D.packaging.delivery, "bundled");
  assert.ok(Array.isArray(D.packaging.unpackGlobs) && D.packaging.unpackGlobs.length,
    "a bundled runtime must name what the build unpacks");
  assert.equal(D.packaging.signing, "inherits-app-identity",
    "the vendor binaries are re-signed under the app's own identity — notarisation requires it");
  assert.equal(D.packaging.versionPin, "@openai/codex@0.155.1",
    "the pin is the version SUPPORTED_CLI was measured from, and package.json pins it EXACTLY");
});

test("the version pin, the SUPPORTED_CLI floor and the installed dependency are ONE version", () => {
  // ⚠ THREE COPIES OF ONE NUMBER, AND NOTHING ELSE COMPARES THEM. `packaging.versionPin` is what
  // the release CLAIMS, `client.js › SUPPORTED_CLI.measuredFrom` is what the adapter was BUILT
  // against, and `package.json › dependencies['@openai/codex']` is what `npm install` actually
  // PLACES. A bundled delivery is only worth anything if the three agree.
  const pinned = String(D.packaging.versionPin).split("@").pop();
  assert.equal(pinned, client.SUPPORTED_CLI.measuredFrom);
  const dep = JSON.parse(
    readFileSync(join(HERE, "..", "package.json"), "utf8")
  ).dependencies["@openai/codex"];
  assert.equal(dep, pinned, "an EXACT pin, not a caret — a range makes the claim a guess");
});
