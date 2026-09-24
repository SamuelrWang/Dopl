// The SESSION-mode per-call grant decision (`main/session-profiles.js › grantDecision`, Track T1) —
// the pure function the engine's canUseTool bridge consults. SOURCE EXTRACTION with INJECTION,
// focused on the DECISION truth table and the load-bearing SHADOW INVARIANT: a pre-approved tool
// must resolve to 'preapproved' and can therefore NEVER reach the gate (§A.5).
//
// `full`'s hard-deny set is the UNIVERSAL FLOOR alone since F-177 (2026-08-08), and since v2.5 D2
// NO `dopl_channel` op auto-allows — own-channel posts included — so the shadow check below proves
// the tool stays out of allowedTools and that gate can actually fire. The op/grant-key cases live in
// session-profiles.test.mjs; this file pins the invariants + the profile universe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { codeOf, fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-profiles.js"), "utf8");

const tp = require(join(HERE, "..", "main", "tool-profiles.js"));
const { READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, UNIVERSAL_HARD_DENY, DOPL_CHANNEL_TOOL, DOPL_SERVER_PREFIX, normalizeProfile } = tp;

const from = SRC.indexOf("// ─── BEGIN SESSION-PROFILE TABLE");
const to = SRC.indexOf("// ─── END SESSION-PROFILE TABLE");
assert.ok(from !== -1 && to > from, "SESSION-PROFILE TABLE sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

// v2.9: the block digests grant keys, so `shaKey` is injected like normalizeProfile. FIX F4: the
// FULL digest, not a 12-hex prefix — 48 bits is minutes of search for a counterparty who supplies
// the exact command/body text, and a grant key is a Set member, never a display string.
const shaKey = (v) => createHash("sha256").update(String(v == null ? "" : v)).digest("hex");
// §2 SPLIT (2026-08-02): the grant-key machinery lives in main/session-grant-keys.js. Injected REAL,
// so the block stays pinned to what ships.
const KEYS = require(join(HERE, "..", "main", "session-grant-keys.js"));
// F-139 (2026-08-05): the block matches tool names through mcp-tool-names' normalizers, because the
// `mcp__<server>__` segment is the CLIENT's and never ours.
const NAMES = require(join(HERE, "..", "main", "mcp-tool-names.js"));
// 2026-08-22 (OQ-1): the block op-scopes `dopl_kb` the way it has always op-scoped `dopl_channel`.
// Injected REAL.
const KB_OPS = require(join(HERE, "..", "main", "knowledge-ops.js"));
// 2026-09-23: the same op-scoping for `dopl_agent` / `dopl_workspaces` (dopl-write-op-gating.test).
const READ_OPS = require(join(HERE, "..", "main", "dopl-read-ops.js"));
const DOPL_TOOLS = require(join(HERE, "..", "main", "session-dopl-tools.js"));
// 2026-08-24 (create_thread ruling): the own-channel outbound ops beside the post, a §2 split into
// main/session-own-outbound.js. Injected REAL.
const OUT = require(join(HERE, "..", "main", "session-own-outbound.js"));
// 2026-08-25 (launch ruling, F-320): the OWN-MACHINE LAUNCH LANE — `launch_agent` asks for a PROCESS
// rather than sending CONTENT, so it is its own lane (both axes + a launch-depth bound).
const LAUNCH = require(join(HERE, "..", "main", "session-own-launch.js"));
// 2026-08-31 (same-owner directions ruling): the OWN-MACHINE DIRECT LANE — `direct_agent` buys a
// TURN, so it takes the launch lane's two-axis conjunction while carrying NO depth bound (that one
// bounds how many agents come into existence; a direction creates none).
const DIRECT = require(join(HERE, "..", "main", "session-own-direct.js"));
// 2026-09-17: the OWN-MACHINE MANAGE LANE — the `manage.*` verbs reach a live session on the
// operator's own Mac, so they take the launch lane's two-axis conjunction and carry NO depth bound
// (a launched agent is AT the cap, and asking the depth here would DENY the very renames the lane
// was filed for).
const MANAGE = require(join(HERE, "..", "main", "session-own-manage.js"));
const AUDIENCE = require(join(HERE, "..", "main", "session-audience.js")); // B2 belt (plan §4.4)

// 2026-08-31 (runtime-adapter port, §0.1b): the AXIS-A TAIL LEFT THIS BLOCK. `buildSessionToolConfig`
// and the mode transforms are ONE runtime's built-in tool vocabulary, so they live in
// `main/runtime/claude/tools.js` and the block asks the REGISTRY per call, through `toolConfigFor` /
// `axisAAllows`. The REAL registry is injected, so the block stays pinned to what ships.
const RUNTIME = require(join(HERE, "..", "main", "runtime", "index.js"));
const CLAUDE_TOOLS = require(join(HERE, "..", "main", "runtime", "claude", "tools.js"));
const buildSessionToolConfig = CLAUDE_TOOLS.buildSessionToolConfig;
const shortDoplName = CLAUDE_TOOLS.shortDoplName;


const { grantDecision, grantKeyFor } = new Function(
  "READ_BUILTINS", "WEB_TOOLS", "DOPL_SAFE_TOOLS", "DENIED_BUILTINS",
  "DOPL_ADMIN_TOOLS", "RETIRED_DOPL_TOOLS", "UNIVERSAL_HARD_DENY", "DOPL_CHANNEL_TOOL", "DOPL_SERVER_PREFIX", "normalizeProfile", "shaKey",
  "makeGrantKeyFor", "POST_GRANT", "postFieldsOk", "mcpShortName", "canonicalDoplName", "isKnowledgeReadCall", "isDoplReadOpCall", "DOPL_READ_REFERENCE",
  // 2026-09-06: two of these names had not existed since F-578 — `OWN_CHANNEL_MARKER_OPS` /
  // `OWN_CHANNEL_THREAD_OPS` became `..._KIND` / `..._NEW`, so `OUT.<old name>` was injecting
  // `undefined` under a name the block does not reference. Corrected to the REAL exports, and
  // `channelOpKey` added: it is a free variable inside the block that was never injected, and only
  // the `autoInboundMode(...) &&` short-circuit kept it from throwing.
  "OWN_CHANNEL_MARKER_KIND", "OWN_CHANNEL_THREAD_NEW", "OWN_CHANNEL_OUTBOUND_OPS",
  "isOwnChannelMarker", "isOwnChannelThreadOpen", "isOwnChannelOutbound",
  "isOwnMachineLaunch", "launchLaneVerdict",
  "isOwnMachineDirect", "directLaneVerdict",
  "isOwnMachineManage", "manageLaneVerdict",
  "channelOpKey",
  // 2026-08-26 (plan §4.4 B2): the AUDIENCE BELT, injected REAL like every other predicate — a fake
  // would let the harness agree with itself while the shipped gate did something else.
  "containerOnlyDenies", "isDoplToolName", "runtimeFor", "editToolsFor",
  `${BLOCK}
   return { grantDecision, grantKeyFor };`
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
  (id) => RUNTIME.capability.editScopedTools(RUNTIME.descriptorFor(id)));

const PROFILES = ["read_only", "dopl_only", "full"];
const ownPost = (channel) => ({ op: "send", channel });

// ── The shadow invariant (the whole point of this file) ────────────────────────

test("SHADOW INVARIANT: every pre-approved tool resolves to 'preapproved', never gates", () => {
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    for (const tool of cfg.preApproved) {
      const d = grantDecision({ profile, toolName: tool });
      assert.equal(d, "preapproved", `${profile}: pre-approved ${tool} must be 'preapproved', got '${d}'`);
    }
  }
});

test("a pre-approved tool stays 'preapproved' even if it is (redundantly) in allowForTask", () => {
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    const tool = cfg.preApproved[0];
    assert.equal(grantDecision({ profile, toolName: tool, allowForTask: [tool] }), "preapproved");
  }
});

// ── Deny truth table ───────────────────────────────────────────────────────────

test("every disallowed tool resolves to 'deny' on its profile", () => {
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    for (const tool of cfg.disallowedTools) {
      assert.equal(grantDecision({ profile, toolName: tool }), "deny", `${profile}: ${tool} must deny`);
    }
  }
});

test("a hard-denied tool denies even when the operator tries to allow it for the task", () => {
  assert.equal(grantDecision({ profile: "read_only", toolName: "Bash", allowForTask: ["Bash"] }), "deny");
});

// ── Gate truth table ───────────────────────────────────────────────────────────

test("under 'full', an ungranted work tool GATES; granting THAT SHAPE for the task -> 'allow'", () => {
  // v2.9 HIGH-1: the key is the call's shape (grantKeyFor), never the bare tool name.
  for (const tool of ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch"]) {
    const input = { command: "ls", file_path: "/w/a.txt", notebook_path: "/w/n.ipynb", url: "https://x.test" };
    assert.equal(grantDecision({ profile: "full", toolName: tool, input }), "gate", `${tool} should gate under full`);
    const key = grantKeyFor(tool, input, "c1");
    assert.equal(grantDecision({ profile: "full", toolName: tool, input, allowForTask: [key] }), "allow", `${tool} allowed-for-task`);
  }
});

test("FIX H1 + D2: read_only / dopl_only gate NOTHING in their profile universe; dopl_channel ALWAYS gates", () => {
  // The profile's static universe (preApproved + disallowed) never gates — but
  // dopl_channel, which is in NEITHER set, gates for EVERY op as of v2.5 D2.
  for (const profile of ["read_only", "dopl_only"]) {
    const cfg = buildSessionToolConfig(profile);
    for (const tool of cfg.preApproved.concat(cfg.disallowedTools)) {
      assert.notEqual(grantDecision({ profile, toolName: tool }), "gate", `${profile}: ${tool} must not gate`);
    }
    // D2: the own-channel post (the delivery message) gates too — it used to auto-allow.
    assert.equal(grantDecision({ profile, toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: ownPost("c1") }), "gate");
    assert.equal(grantDecision({ profile, toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "rooms", action: "open", direct: true } }), "gate");
  }
});

test("D2 SHADOW CHECK: dopl_channel is in NO profile's allowedTools, so the gate can actually fire", () => {
  // The shadow rule (§A.5): anything named in allowedTools auto-approves BEFORE
  // canUseTool runs. A gated post is only real if the tool stays out of that list.
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    assert.ok(!cfg.preApproved.includes(DOPL_CHANNEL_TOOL), `${profile}: dopl_channel must not be shadowed`);
    assert.ok(!cfg.disallowedTools.includes(DOPL_CHANNEL_TOOL), `${profile}: it must still be offered`);
  }
});

// ── F-177: `full` releases the built-ins; the restricted profiles keep refusing them ────

test("FIX H3 (restricted profiles): Task + Agent resolve 'deny', never 'gate'", () => {
  // Where the session really IS contained, a subagent that does not inherit the canUseTool bound is
  // still refused outright. Under `full` the operator already has Bash, so the refusal protected
  // nothing and removed the delegation feature — see F-177.
  for (const profile of ["read_only", "dopl_only"]) {
    assert.equal(grantDecision({ profile, toolName: "Task" }), "deny", `${profile}: Task`);
    assert.equal(grantDecision({ profile, toolName: "Agent" }), "deny", `${profile}: Agent`);
  }
});

test("F-177: full GATES the persistence/exfil/delegation set — and hard-denies only the floor", () => {
  // The inverted assertion. Each of these used to answer 'deny' here; each answers 'gate' now.
  for (const tool of ["Task", "Agent", "CronCreate", "CronDelete", "SendMessage", "RemoteTrigger", "ScheduleWakeup", "Monitor", "Skill", "ToolSearch"]) {
    assert.equal(grantDecision({ profile: "full", toolName: tool }), "gate", `full must gate ${tool}`);
  }
  // What DOES still hard-deny under `full`: the universal floor, and exactly that.
  for (const tool of UNIVERSAL_HARD_DENY) {
    assert.equal(grantDecision({ profile: "full", toolName: tool }), "deny", `full must deny ${tool}`);
  }
  assert.deepEqual(buildSessionToolConfig("full").disallowedTools.slice().sort(),
    UNIVERSAL_HARD_DENY.slice().sort(), "…and the floor is the WHOLE hard-deny set under full");
  // The floor is immovable, as it always was: no posture and no task grant opens it.
  for (const tool of DOPL_ADMIN_TOOLS) {
    assert.equal(grantDecision({ profile: "full", toolName: tool, toolMode: "bypass", allowForTask: [tool] }),
      "deny", `full must deny ${tool} even at bypass with a grant`);
  }
});

// ── Robustness ───────────────────────────────────────────────────────────────

// C-11 (2026-08-08): an unknown profile normalizes to READ_ONLY now, not to full, so the verdict for
// a WORK tool is the fail-closed one. `deny` here is read_only's hard-deny list doing its job.
test("grantDecision tolerates missing args and unknown profiles (fail closed to read_only)", () => {
  assert.equal(grantDecision({ toolName: "Bash" }), "deny", "no profile -> read_only -> Bash is hard-denied");
  assert.equal(grantDecision({ profile: "full", toolName: "Bash" }), "gate", "an EXPLICIT full still gates it");
  // FIX H1 + D2: dopl_channel gates whatever the input is — no input, and an
  // own-channel post, both land on the operator's dock.
  assert.equal(grantDecision({ profile: "nonsense", toolName: DOPL_CHANNEL_TOOL }), "gate");
  assert.equal(grantDecision({ profile: "nonsense", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: ownPost("c1") }), "gate");
  assert.equal(grantDecision(), "gate", "no args -> an unknown tool still gates rather than throwing");
});

// ── v2.x WORKSPACE PIN: the dopl MCP server entry the session actually runs with ──
//
// The device credential can span several workspaces and a multi-workspace connection has NO default,
// so every dopl call that omitted `workspace=` was refused. buildMcpServers pins the SESSION's
// workspace UUID as the `X-Workspace-Id` request header, so an unqualified call auto-targets. The
// pin GRANTS nothing (it must match a membership the credential already has) and a per-call
// `workspace=` still wins server-side.
//
// sdk-loader.js is electron-bound (app.getPath), so the function is source-extracted and driven with
// fakes. The bearer comes from mcp-config's safeStorage cache and the url is always the compiled-in
// MCP_URL; the credential-path story itself is pinned in test/sdk-mcp-token.test.mjs.

const LOADER = readFileSync(join(HERE, "..", "main", "runtime", "claude", "loader.js"), "utf8");
const MCP_BLOCK = codeOf(fnOf(LOADER, "buildMcpServers"));
assert.ok(MCP_BLOCK.includes("return { dopl: server };"), "buildMcpServers slice missing/incomplete");

const MCP_URL = "https://dopl.test/api/mcp";

// `clientTimeoutMs` is injected for the same reason `doplBearer` is: it lives ABOVE the slice and its
// body cannot run in a `new Function` program. The VALUE is read out of mcp-config's source so a
// harness can never drift from the shipped constant (Q9 — two separate literals is how they drifted).
const CONFIG_SRC = readFileSync(join(HERE, "..", "main", "mcp-config.js"), "utf8");
const SHIPPED_TIMEOUT_MS = (() => {
  const m = /MCP_CLIENT_TIMEOUT_MS = ([\d_]+);/.exec(CONFIG_SRC);
  assert.ok(m, "mcp-config.js must define MCP_CLIENT_TIMEOUT_MS");
  return Number(m[1].replace(/_/g, ""));
})();

function buildServers(policy, workspaceId, token = "secret-token") {
  return new Function(
    "doplBearer", "clientTimeoutMs", "MCP_URL", "policy", "workspaceId",
    `${MCP_BLOCK}\n return buildMcpServers(policy, workspaceId);`
  )(() => token, () => SHIPPED_TIMEOUT_MS, MCP_URL, policy, workspaceId);
}

const WS_UUID = "9a1b2c3d-2222-4ccc-8ddd-eeeeeeeeeeee";

test("the session's workspace UUID rides as the X-Workspace-Id header, beside the bearer", () => {
  const servers = buildServers(null, WS_UUID);
  assert.deepEqual(servers.dopl.headers, {
    Authorization: "Bearer secret-token",
    "X-Dopl-Runtime": "desktop-session", // WAKE-V1, below
    // 2026-08-31 (adapter port step 1): the VENDOR dimension, unconditional like the custody stamp
    // beside it; `test/runtime-stamp-literals.test.mjs` owns the argument.
    "X-Dopl-Vendor": "claude",
    "X-Workspace-Id": WS_UUID,
  }, "the header the MCP endpoint reads as its per-request pin");
  assert.equal(servers.dopl.type, "http");
  assert.equal(servers.dopl.url, MCP_URL, "C2: always the compiled-in url");
});

test("no session workspace -> NO pin header at all (today's behavior, unchanged)", () => {
  for (const missing of [undefined, null, "", "   ", 42, {}]) {
    const headers = buildServers(null, missing).dopl.headers;
    // The runtime and vendor headers are unconditional (they identify the CUSTODY and the
    // RUNTIME, not the workspace); the workspace PIN is still the only conditional one.
    assert.deepEqual(Object.keys(headers), ["Authorization", "X-Dopl-Runtime", "X-Dopl-Vendor"], JSON.stringify(missing));
  }
});

// ── WAKE-V1: the runtime header that makes a desktop-spawned session identifiable ──
//
// A session THIS APP spawned and the operator's own external `claude` process authenticate with the
// same device credential, as the same user; this header is the discriminator. The server treats
// `runtime` as a RESERVED metadata key and stamps `metadata.runtime='desktop-session'` ONLY on this
// exact header value, so a value smuggled in the message body cannot produce the stamp. It stays a
// ROUTING HINT and never an authorization signal (any device-token holder can send it), so
// `targeting.requesterTaskOpen` gates on it only alongside its identity conjuncts and fails CLOSED
// without it. Absence is the external case, which is why the header rides EVERY spawned-session
// call, pin or no pin.

test("WAKE-V1: every spawned session's dopl entry sends X-Dopl-Runtime: desktop-session", () => {
  // With a pin, without one, and under a restricted tools policy — the stamp is what
  // marks the runtime, so no configuration may drop it.
  for (const ws of [WS_UUID, "", undefined]) {
    assert.equal(buildServers(null, ws).dopl.headers["X-Dopl-Runtime"], "desktop-session", `ws=${ws}`);
  }
  // A restricted profile still HANDS the builder its `doplToolsPolicy`; since the F-177 follow-up
  // the builder does not forward it — the per-server `tools` field is a PERMISSION policy and the
  // short-name array made the CLI drop the whole dopl entry.
  const restricted = buildServers(["dopl_kb"], WS_UUID).dopl;
  assert.equal(restricted.headers["X-Dopl-Runtime"], "desktop-session");
  assert.ok(!("tools" in restricted), "a per-server tools policy is never sent");
});

test("FIX Q9: the dopl entry raises the per-call timeout past the 60s client abort", () => {
  // Claude Code aborts a call whose response headers have not arrived by
  // min(max(server.timeout ?? MCP_TOOL_TIMEOUT ?? 60_000, 60_000), 2147483647) ms; /api/mcp used to
  // send no headers until the handler returned, so without this field EVERY await died at 60s —
  // before the ~2min backgrounding mark that makes it a wake primitive. Must clear the LONGEST
  // REACHABLE hold and stay under maxDuration 300.
  for (const ws of [WS_UUID, "", undefined]) {
    const t = buildServers(null, ws).dopl.timeout;
    assert.ok(t > 215_000 && t < 300_000, `ws=${ws} timeout=${t} must clear the hold and the function ceiling`);
  }
  // Pinned as WIRING, not as a number: dropping the field silently disables the wake, while the
  // VALUE and its arithmetic are owned by test/mcp-client-timeout.test.mjs, which reads the server's
  // own constants.
  assert.match(MCP_BLOCK, /timeout: clientTimeoutMs\(\),/, "the field is still set");
  assert.ok(!/timeout: \d[\d_]*,/.test(MCP_BLOCK), "…and never from a literal of its own");
});

test("WAKE-V1: the header value is the literal the server matches, and it grants nothing", () => {
  // Pinned as a literal in the source: a typo here silently turns every desktop session
  // into an 'external' one (no requester windows at all), which no other test would catch.
  assert.match(MCP_BLOCK, /'X-Dopl-Runtime': 'desktop-session',/);
  // No token -> no server entry at all, so the header can never ride an unauthenticated
  // call: it only ever accompanies the device bearer.
  assert.deepEqual(buildServers(null, WS_UUID, ""), {});
});

test("the pin does not disturb how the dopl tools policy is handled (or the bearer)", () => {
  // WAS "…does not disturb the per-profile dopl tools allowlist". That field was never an allowlist:
  // it is the SDK's per-tool PERMISSION policy, and a string array failed the CLI's per-entry
  // validation, which DROPS THE SERVER rather than the field — so the two restricted profiles were
  // spawning with no dopl tools at all. What is pinned HERE is only that the pin changes none of it.
  // What is pinned HERE is only that the workspace pin changes none of that.
  const scoped = buildServers(["dopl_channel"], WS_UUID);
  assert.ok(!("tools" in scoped.dopl), "a scoped policy is accepted and deliberately not forwarded");
  assert.equal(scoped.dopl.headers.Authorization, "Bearer secret-token");
  const open = buildServers(null, WS_UUID);
  assert.ok(!("tools" in open.dopl), "…and a null policy, as always, sets no per-server bound");
  // No token (pre-sign-in) still returns {} — a pin can never manufacture a server entry.
  assert.deepEqual(buildServers(null, WS_UUID, ""), {}, "no bearer -> no server");
});

test("the launch spec passes the SESSION's workspace, so every session query is pinned", () => {
// 2026-08-31 (runtime-adapter port, steps 3-4): the OPTION ASSEMBLY moved to
// `main/runtime/claude/launch-spec.js` — it is written in ONE platform's option vocabulary.
// `session-query.js` keeps the LIFECYCLE. The pins below follow the code; what they assert is
// unchanged.
  const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");
  const SPEC = readFileSync(join(HERE, "..", "main", "runtime", "claude", "launch-spec.js"), "utf8");
  const opts = SPEC.slice(SPEC.indexOf("function buildOptions(s, dispatch) {"), SPEC.indexOf("function buildLaunchSpec("));
  assert.ok(opts.length > 0, "the option assembly slice not found in runtime/claude/launch-spec.js");
  // THE THIRD ARGUMENT IS THE CONTAINER LOCK (2026-08-26, plan §4.4 B1) — the child credential for a
  // session spawned into a SHARED link container, '' for every other session. Pinned INTO this
  // literal because dropping the argument silently reverts every locked session to the device token.
  assert.match(opts, /mcpServers: loader\.buildMcpServers\(cfg\.doplToolsPolicy, s\.workspaceId, sessionCredential\.sessionBearer\(s\)\),/);
  // A parked resume and a recreated shell assemble the spec through this SAME function
  // (session-park calls deps.buildLaunchSpec), so they are pinned by construction.
  assert.match(ENGINE, /sessionPark\.bind\(\{\n?\s*sessions, acquireRuntime, buildLaunchSpec/);
});
