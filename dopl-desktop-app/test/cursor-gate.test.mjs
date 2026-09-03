// THE CURSOR ADAPTER AT THE GATE — Axis A in Cursor's own vocabulary, the containment table, the
// answer shape, and the two refusals that are declarations.
//
// ⚠ THE SUBJECT IS THE ADAPTER, NOT THE GATE. `main/session-profiles.js › grantDecision` — its
// order, its four verdicts, every Axis-B lane — is core and is pinned by its own suites on every
// runtime. What is measured here is that driving that ONE decision function with `runtime: 'cursor'`
// resolves steps 1 and 4 in CURSOR's words and reaches the same answers, including the two the
// v2.9 contract forbids being reachable from the wrong axis.
//
// ⚠ AND ONE THING THIS RUNTIME MAKES MEASURABLE THAT THE OTHERS DO NOT. It is the first adapter
// with NO permission callback, so it is the first place the question "what happens to Dopl's gate
// when the platform supplies nothing" has an answer to pin: Axis B moves in-process
// (`cursor-axis-b.test.mjs` drives that half) and Axis A shrinks to Dopl's own surface, which is
// what the taxonomy cases below assert rather than assume.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const CURSOR = join(MAIN, "runtime", "cursor");

const profiles = require(join(MAIN, "session-profiles.js"));
const registry = require(join(MAIN, "runtime", "index.js"));
const capability = require(join(MAIN, "runtime", "capability.js"));
const tools = require(join(CURSOR, "tools.js"));
const approval = require(join(CURSOR, "approval.js"));
const axisB = require(join(CURSOR, "axis-b.js"));
const mcp = require(join(CURSOR, "mcp.js"));
const launchSpec = require(join(CURSOR, "launch-spec.js"));

const D = registry.descriptorFor("cursor");
const RT = registry.runtimeFor("cursor");
const CHANNEL = "mcp__dopl__dopl_channel";

const decide = (over) => profiles.grantDecision({
  runtime: "cursor", profile: "full", toolMode: "allowlist", messageMode: "ask",
  channelId: "chan-1", allowForTask: [], ...over,
});

// ── AXIS A, IN CURSOR'S OWN WORDS ────────────────────────────────────────────────────────────

test("the three modes are the RUN MODES' own names, and nothing was synthesised", () => {
  assert.deepEqual(capability.toolModes(D), ["allowlist", "auto-review", "run-everything"]);
  // ⚠ THE ONE THAT MUST BE ABSENT. "Ask me per tool call" is a CLAUDE capability, not a Dopl one:
  // this platform has no permission callback, so a "manual" row would be a control Dopl could not
  // honour. Design §0.1c — no synthesised modes, and no row grayed out where one would have been.
  for (const claudeWord of ["manual", "accept_edits", "auto", "bypass"]) {
    assert.ok(!capability.toolModes(D).includes(claudeWord), `${claudeWord} is not a Cursor word`);
  }
  for (const codexWord of ["untrusted", "granular", "on-request", "never"]) {
    assert.ok(!capability.toolModes(D).includes(codexWord), `${codexWord} is another runtime's word`);
  }
});

test("Axis A widens by mode, and an UNRECOGNISED name gates in EVERY mode", () => {
  const read = "mcp__dopl__dopl_search";
  const write = "mcp__dopl__dopl_kb";
  assert.equal(RT.axisAAllows("allowlist", read), true, "Dopl's reads run at the narrowest mode");
  assert.equal(RT.axisAAllows("allowlist", write), false, "a workspace WRITE is exfil and asks");
  assert.equal(RT.axisAAllows("run-everything", write), true);
  // ⚠ POSITIVE ALLOW-LISTS, NEVER NEGATIVE. A negative mode auto-allows every unrecognised name —
  // '', null, a renamed channel tool, a Dopl tool a later server ships — and hard-deny is a
  // build-time blacklist that cannot cover them.
  for (const mode of capability.toolModes(D)) {
    for (const junk of ["", null, undefined, "somethingNew", "Shell(*)", "Bash"]) {
      assert.equal(RT.axisAAllows(mode, junk), false, `${mode} / ${JSON.stringify(junk)}`);
    }
  }
});

test("`auto-review` is no wider than `allowlist` in DOPL's gate, because its reach is CURSOR's", () => {
  // ⚠ THE FAIL-CLOSED READING, AND IT IS THE HONEST ONE. Auto-review's extra reach is a CLASSIFIER
  // reviewing CURSOR's own built-ins, which never arrive at `grantDecision` at all. Dopl cannot
  // read what that classifier decided, so Dopl's gate must not assume it decided anything.
  for (const name of ["mcp__dopl__dopl_kb", "mcp__dopl__dopl_search", CHANNEL]) {
    assert.equal(RT.axisAAllows("auto-review", name), RT.axisAAllows("allowlist", name), name);
  }
});

test("an unknown mode fail-closes to the NARROWEST, and the default IS the narrowest", () => {
  assert.equal(tools.normalizeToolMode("not-a-mode"), "allowlist");
  assert.equal(tools.normalizeToolMode(undefined), "allowlist");
  assert.equal(D.toolMode.default, "allowlist", "a session starts asking; a park resets it there");
});

test("the WINDOWLESS FLOOR resolves to a CURSOR mode that really reaches a tool", () => {
  // ⚠ ON THIS RUNTIME THE FLOOR IS LOAD-BEARING FOR LIVENESS AS WELL AS REACH, which is new. The
  // narrowest mode ASKS for anything unlisted, and this platform's "ask" has NO RESPONDER API
  // (§5 item X1) — so a session left at `allowlist` can stall on a question nobody can answer.
  // Raising every unattended session to `auto-review` is what stands between this runtime and
  // that stall.
  const floor = capability.windowlessToolFloor(D);
  assert.equal(floor, "auto-review");
  assert.ok(!["manual", "auto", "bypass", "on-request"].includes(floor), "the floor must be this runtime's word");
  assert.equal(RT.axisAAllows(floor, capability.toolTaxonomy(D).auto[0]), true);
  // Widen-only: nothing is ever narrowed by a floor.
  assert.equal(capability.floorWindowlessTool(D, "allowlist"), "auto-review");
  assert.equal(capability.floorWindowlessTool(D, "run-everything"), "run-everything");
  assert.equal(capability.floorWindowlessTool(D, "garbage"), "auto-review");
});

test("the taxonomy is EMPTY where CURSOR supervises, and that is a claim rather than a gap", () => {
  // ⚠ `[]` SAYS "NO MEMBERS"; `null` WOULD SAY "NO SUCH CONCEPT". Cursor has edits, shells and web
  // fetches — they are simply not names Dopl's gate is ever asked about, because there is no
  // callback to ask through. Pinned so a later wave cannot quietly start listing built-ins here
  // and imply a gate that does not exist.
  const t = capability.toolTaxonomy(D);
  assert.deepEqual(t.edits, []);
  assert.deepEqual(t.escalation, []);
  assert.deepEqual(t.bypassReads, []);
  assert.deepEqual(capability.editScopedTools(D), []);
  assert.ok(t.auto.length > 0 && t.bypass.length > t.auto.length, "…but Dopl's OWN surface is classified");
});

// ── THE v2.9 INVARIANT, BOTH DIRECTIONS ──────────────────────────────────────────────────────

test("AXIS A CAN NEVER AUTO-APPROVE A MESSAGE OP — at any mode, on this runtime", () => {
  for (const toolMode of capability.toolModes(D)) {
    const v = decide({ toolName: CHANNEL, input: { op: "send", body: "hi" }, toolMode });
    assert.equal(v, "gate", `${toolMode}: a tool posture sent a message`);
  }
});

test("AXIS B CAN NEVER AUTO-APPROVE A WORK TOOL — at any message posture", () => {
  for (const messageMode of ["ask", "auto_inbound", "auto_outbound", "auto_both"]) {
    const v = decide({ toolName: "mcp__dopl__dopl_kb", input: { op: "write_file" }, messageMode });
    assert.equal(v, "gate", `${messageMode}: a message posture wrote the workspace`);
  }
});

test("…and the Axis-B lanes still work in this runtime's session", () => {
  assert.equal(decide({ toolName: CHANNEL, input: { op: "send", body: "hi" }, messageMode: "auto_outbound" }), "allow");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "read" }, messageMode: "auto_inbound" }), "allow");
  assert.equal(decide({ toolName: CHANNEL, input: { op: "send", channel: "other", body: "x" }, messageMode: "auto_outbound" }), "gate",
    "a cross-channel post is the exfil shape and gates in every posture");
});

// ── CONTAINMENT ──────────────────────────────────────────────────────────────────────────────

test("the restricted profiles deny in CURSOR's PERMISSION STRINGS and pin the native controls", () => {
  for (const profile of ["read_only", "dopl_only"]) {
    const cfg = RT.toolConfigFor(profile);
    for (const rule of [tools.SHELL_ANY, tools.WRITE_ANY, tools.MCP_ANY]) {
      assert.ok(cfg.disallowedTools.includes(rule), `${profile} does not deny ${rule}`);
    }
    // ⚠ A SANDBOX BOUNDS THE FILESYSTEM AND THE NETWORK; IT DOES NOT DENY DELEGATION OR
    // PERSISTENCE. Both layers, or the profile has no enforcement of its own (design §0.1a).
    assert.equal(cfg.native.sandbox, true);
    assert.equal(cfg.native.runMode, "allowlist");
    assert.equal(D.containment.profiles[profile].native.sandbox, true);
    // Dopl's own admin surface is denied by NAME on every restricted profile, and hard-deny is not
    // openable by the widest mode.
    for (const admin of D.axisB.hardDeny) {
      assert.equal(decide({ profile, toolName: admin, toolMode: "run-everything" }), "deny");
    }
  }
  // ⚠ THE WEB SPLITS THE TWO PROFILES, AND IT IS THE ONE PLACE THE TWO NATIVE-CONTAINMENT ADAPTERS
  // DISAGREE ABOUT WHAT A PROFILE MEANS. `read_only` is the zero-outbound profile so it denies
  // WebFetch; `dopl_only`'s whole point is looking things up with no shell, so it keeps it — which
  // Codex could not do, because network there is a property of the sandbox with no named tool.
  assert.ok(RT.toolConfigFor("read_only").disallowedTools.includes(tools.WEB_ANY));
  assert.ok(!RT.toolConfigFor("dopl_only").disallowedTools.includes(tools.WEB_ANY));
  // `full` is the UNIVERSAL FLOOR and nothing else, and it pins no native pair.
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

test("NOTHING is pre-approved, so nothing is shadowed past the in-process boundary", () => {
  // ⚠ THE INVARIANT THIS RUNTIME EXISTS TO NOT BREAK. `main/agent-self-ops.js` is the same
  // mechanism — a tool this process implements — and its two verbs ride `allowedTools` and are
  // therefore shadowed past the gate entirely. That is defensible for a display verb and
  // indefensible for a channel op, which is the call that HAS to gate. An empty pre-approval list
  // on every profile is what makes the shadow unavailable rather than merely unused.
  for (const profile of ["read_only", "dopl_only", "full"]) {
    assert.deepEqual(RT.toolConfigFor(profile).preApproved, [], profile);
    assert.deepEqual(D.containment.profiles[profile].allowList, [], profile);
  }
});

test("the universal hard deny is Dopl's own, unchanged, and openable by nothing", () => {
  const hard = require(join(MAIN, "tool-profiles.js")).UNIVERSAL_HARD_DENY;
  assert.deepEqual(D.axisB.hardDeny, hard);
  for (const name of hard) {
    for (const profile of ["read_only", "dopl_only", "full"]) {
      assert.equal(decide({ profile, toolName: name, toolMode: "run-everything", allowForTask: [name] }), "deny",
        `${profile}/${name}: hard deny was opened`);
    }
  }
});

test("the credential-path rules are added at LAUNCH, not in the profile table", () => {
  // ⚠ THE DRIFT THIS PREVENTS: the rules read the app's own userData directory, which a plain-Node
  // harness cannot answer. A profile entry built at MODULE LOAD (the descriptor) and one built at
  // LAUNCH would then carry different lists, and the descriptor would describe containment the
  // gate does not apply. `runtime/claude/launch-spec.js` splits them for the same reason.
  for (const profile of ["read_only", "dopl_only", "full"]) {
    for (const rule of RT.toolConfigFor(profile).disallowedTools) {
      assert.ok(!rule.startsWith("Read("), `${profile}: a credential-path rule leaked into the table`);
    }
  }
  const rules = tools.buildSecretPathDenyRules("/tmp/userData");
  assert.ok(rules.includes("Read(/tmp/userData/**)"), "the app's own store is fenced");
  assert.ok(rules.includes("Read(**/.cursor/**)"), "…and this runtime's own config directory");
  // ⚠ PATH TOOLS ONLY. A `Shell(<path>)` entry would match a COMMAND BASE and deny nothing while
  // reading as coverage — the same trap `runtime/claude/loader.js` records for `Bash`.
  for (const rule of rules) assert.match(rule, /^(Read|Write)\(/);
});

// ── THE ANSWER SHAPE ─────────────────────────────────────────────────────────────────────────

test("a verdict becomes a TOOL RESULT, because there is no approval channel to answer", () => {
  // ⚠ THE STRUCTURAL DIFFERENCE FROM BOTH OTHER ADAPTERS. They answer a held request in the
  // platform's own approval words; here the only place a Dopl verdict can be expressed is the
  // RETURN VALUE of a tool Dopl implements.
  const allowed = approval.answerApproval({ text: "posted" }, "allow");
  assert.deepEqual(allowed.content, [{ type: "text", text: "posted" }]);
  assert.ok(!allowed.isError);
  // ⚠ FAIL CLOSED ON ANYTHING BUT AN EXPLICIT ALLOW, and a deny is `isError` rather than silence:
  // the model has to be able to tell "refused" from "empty result", or it retries the post it was
  // refused — which is the fan-out shape, not a cosmetic one.
  for (const verdict of ["deny", "allow-task", "", null, undefined, 42, {}]) {
    const answer = approval.answerApproval({ message: "no" }, verdict);
    assert.equal(answer.isError, true, JSON.stringify(verdict));
    assert.equal(answer.content[0].text, "no");
  }
});

test("the thread tag is applied NATIVELY, and a tag that does not apply leaves the input alone", () => {
  const tagged = approval.stampOutbound({ op: "send", body: "hi" },
    { action: "inject", input: { op: "send", body: "hi", thread: "task-9" } });
  assert.equal(tagged.updatedInput.thread, "task-9");
  // ⚠ `null` IS NOT A LEGAL RETURN: an un-stamped post is a fan-out/echo failure, so a tag that
  // does not apply answers the input UNCHANGED rather than nothing.
  for (const tag of [null, undefined, { action: "none" }, { action: "conflict" }]) {
    const out = approval.stampOutbound({ op: "send", body: "hi" }, tag);
    assert.deepEqual(out.updatedInput, { op: "send", body: "hi" }, JSON.stringify(tag));
  }
});

test("Axis B declares the only IN-PROCESS enforcement point of the three", () => {
  assert.equal(capability.axisBEnforcement(D), "in-process");
  // ⚠ `true` BY CONSTRUCTION, NOT BY MEASUREMENT — Dopl writes `execute()`, so the arguments are
  // the model's own in full. The other native runtime declares `'unverified'` here because it
  // depends on whether the PLATFORM hands its callback the call's arguments (§5 item C1).
  assert.equal(D.axisB.opScoped, true);
  assert.equal(capability.axisBOpScoped(D), true);
  assert.equal(capability.inputRewrite(D), "native");
});

// ── THE LAUNCH SHAPE ─────────────────────────────────────────────────────────────────────────

test("a RESTRICTED profile pins the sandbox; `full` rides the operator's own picks", () => {
  const restricted = launchSpec.nativePair(
    { state: { toolMode: "run-everything", sandboxEnabled: false } }, RT.toolConfigFor("read_only")
  );
  assert.deepEqual(restricted, { runMode: "allowlist", sandbox: true },
    "containment is not the operator's to widen from the mode picker");
  const full = launchSpec.nativePair(
    { state: { toolMode: "auto-review", sandboxEnabled: false } }, RT.toolConfigFor("full")
  );
  assert.deepEqual(full, { runMode: "auto-review", sandbox: false });
  // An absent or unrecognised pick lands on the NARROWEST mode and the sandbox ON, never the widest.
  const bare = launchSpec.nativePair({ state: { toolMode: "junk" } }, RT.toolConfigFor("full"));
  assert.deepEqual(bare, { runMode: "allowlist", sandbox: true });
});

test("the launch registers NO MCP server, declares NO subagents, and carries the deny list", () => {
  const spec = launchSpec.buildLaunchSpec({
    session: { profile: "read_only", channelId: null, state: {}, workspaceId: "", model: "" },
    dispatch: () => {}, emitQuiet: () => {},
  });
  // ⚠ NO `mcpServers`: Dopl's surface is `customTools`, and a third-party server would be the
  // operator's — which the restricted profiles deny outright.
  assert.equal(spec.options.mcpServers, undefined);
  // ⚠ NO SUBAGENTS DECLARED — this runtime's only documented delegation lever (§5 item X11).
  assert.deepEqual(spec.options.agents, {});
  assert.equal(spec.options.local.sandboxOptions.enabled, true, "a restricted profile pins the sandbox");
  assert.ok(spec.options.disallowedTools.includes(tools.SHELL_ANY));
  assert.ok(spec.options.disallowedTools.some((r) => r.startsWith("Read(")), "the credential-path rules ride the launch");
  // ⚠ THE RUN MODE IS CARRIED AND DELIBERATELY NOT WRITTEN (§5 item X19): the SDK field that
  // carries one is not named anywhere in the research, and inventing a key is what decision (1)
  // forbids. Pinned so the day X19 answers, the wiring is one line and this case is what proves it.
  assert.equal(spec.runMode, "allowlist");
  assert.equal(spec.options.runMode, undefined, "no invented key reaches the SDK");
  // `''` sets no model at all — the platform's own pick.
  assert.equal(spec.options.model, undefined);
});

test("the Dopl wiring keeps the bearer in a HEADER and stamps custody and vendor separately", () => {
  const wiring = mcp.buildWiring("", "test-bearer", "chan:agent");
  assert.equal(wiring.usable, true);
  assert.equal(wiring.headers.Authorization, "Bearer test-bearer");
  assert.equal(wiring.headers["X-Dopl-Session-Id"], "chan:agent");
  // CUSTODY and VENDOR are two facts on two headers — the whole reason port step 1 was a second
  // dimension rather than three more enum members.
  assert.equal(wiring.headers["X-Dopl-Runtime"], "desktop-session");
  assert.equal(wiring.headers["X-Dopl-Vendor"], "cursor");
  const shared = readFileSync(join(HERE, "..", "..", "src", "shared", "auth", "runtime-header.ts"), "utf8");
  const serverCursor = /export const CURSOR_VENDOR = "([^"]+)";/.exec(shared);
  assert.ok(serverCursor, "the server's vendor constant moved — this join needs re-pinning");
  assert.equal(wiring.headers["X-Dopl-Vendor"], serverCursor[1],
    "main claims a vendor value readVendorHeader does not recognize (no shared module across this join)");
  // ⚠ NO TOKEN => NO SURFACE, and the session still launches. A half-built wiring that 401s on
  // every call would tell the agent it HAS a delivery path and let it watch that path fail.
  assert.deepEqual(mcp.buildWiring("", "", ""), { usable: false, headers: null });
});

// ── REFUSALS THAT ARE DECLARATIONS ───────────────────────────────────────────────────────────

test("⚠ THE SHIP GATE: there is no interrupt, the Stop control is refused, and it says why", () => {
  // ⚠ §5 ITEM X0, AND IT IS THE OPEN THAT BLOCKS RELEASE RATHER THAN A HIDDEN BUTTON.
  // `cursor-research.md` documents `agent.send()` and `run.stream()` and NO interrupt and NO steer
  // API; `session-engine.js › runEffect` case `interruptQuery` is the tree's only actuator, and the
  // design's step 8 says a runtime Dopl cannot stop is a runtime that does not ship.
  assert.equal(D.session.interrupt, "unverified");
  assert.equal(D.session.steer, "unverified");
  assert.equal(capability.canInterrupt(D), false, "the Stop control must not be offered");
  assert.equal(capability.canSteer(D), false);
  assert.match(String(capability.interruptRefusal(D)), /unverified|cannot stop/,
    "a control that vanishes with no reason is one the operator works around");
  // …and the refusal is a CONTROL refusal, not a launch refusal: whether this runtime may SHIP is
  // a release decision, and encoding it as a launch block would hide a ship gate where nobody looks.
  assert.equal(capability.interruptRefusal(registry.descriptorFor("claude")), null,
    "a runtime that CAN interrupt is not refused");
});

test("resume is REFUSED with a readable reason, and a cold launch is unaffected", () => {
  assert.equal(capability.canResume(D), false);
  assert.match(String(capability.resumeRefusal(D)), /unverified/);
  assert.throws(() => launchSpec.resume({ session: {} }, null), /unverified/,
    "the adapter refuses at its own door rather than declaring a block nothing enforces");
});

test("the cost cap is SHOWN here and HIDDEN on the other native runtime — the field earns its keep", () => {
  // ⚠ THIS IS THE ONLY RUNTIME THAT REPORTS A REAL BILLED COST (`agent.getUsage()` ->
  // `{rawCostCents, chargedCents}`), so the cap is a control that can actually fire.
  assert.equal(capability.showsCostCap(D), true);
  assert.equal(D.meter.cost.billed, true, "…and a billed-cost line the others never show");
  assert.equal(capability.showsCostCap(registry.descriptorFor("codex")), false);
  // ⚠ AND THE DENOMINATOR IS HONESTLY ABSENT. The design's §1.4 predicts `windowSource: 'hook'`;
  // §7 ships no hooks on this runtime, so naming one would declare a measurement nobody takes.
  assert.equal(D.meter.windowSource, null);
});

test("the sign-in button, the deep link and the tool-search verb are all HIDDEN, not grayed", () => {
  assert.equal(capability.hasInteractiveSignIn(D), false);
  assert.equal(RT.signIn(), null, "a method whose capability is absent still EXISTS and answers null");
  assert.equal(capability.hasDeepLink(D), false);
  assert.equal(capability.toolSearchVerb(D), null, "the sentence is omitted, never translated");
  assert.equal(capability.entryFile(D), ".cursorrules");
  // ⚠ THE CLASSIFIER-INSTRUCTION CONTROL IS HIDDEN TOO, and that is a DIVERGENCE FROM DESIGN §3.1
  // taken deliberately: its documented home is `permissions.json`, a file the operator also owns,
  // and §5 item X9 settles neither where the keys are written nor whether Cursor re-reads them.
  // Two textareas whose contents reach nothing would be the control that lies.
  assert.equal(D.toolMode.freeform, null);
});

test("packaging is `path`, so `available()` is a real probe with a readable refusal", () => {
  assert.equal(D.packaging.delivery, "path");
  assert.equal(D.packaging.unpackGlobs, null, "a path-delivered runtime unpacks nothing");
  assert.equal(D.packaging.versionPin, null, "a pin would be a claim about a package we do not ship");
});

test("host registration is INLINE, so Dopl leaves no file in the operator's Cursor config", () => {
  // ⚠ THIS IS WHAT MAKES DESIGN §7's "the MCP shared-file problem is avoided" TRUE HERE rather
  // than aspirational — and it is a capability difference, not a refusal like the other runtime's.
  assert.equal(D.mcp.hostRegistration, "inline");
  assert.equal(D.mcp.sessionTransport, "in-process");
  return Promise.all([
    RT.registerMcp({}).then((r) => {
      assert.equal(r.ok, false);
      assert.match(r.reason, /inline/);
    }),
    RT.probeMcp().then((r) => assert.equal(r.present, false, "absent is a CONFIRMED answer here")),
  ]);
});

test("the close latch is the only thing Dopl can really stop, and it is not an interrupt", () => {
  // ⚠ THE PARTIAL MITIGATION THE IN-PROCESS DESIGN BUYS, pinned so nobody mistakes it for X0 being
  // resolved: after `close()`, every Dopl tool refuses, so an ended session cannot post, read the
  // channel or write the workspace. The RUN keeps going — that is what X0 is about.
  const s = { channelId: "chan-1" };
  assert.equal(axisB.isClosed(s), false);
  axisB.closeSession(s);
  assert.equal(axisB.isClosed(s), true);
  // A different session object is untouched — the latch is per session, not global.
  assert.equal(axisB.isClosed({ channelId: "chan-1" }), false);
});
