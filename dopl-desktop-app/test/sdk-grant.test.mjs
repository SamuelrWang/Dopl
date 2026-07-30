// Tests for the SESSION-mode per-call grant decision (main/session-profiles.js
// `grantDecision`, Track T1) — the pure function the engine's canUseTool bridge
// consults. SOURCE EXTRACTION with INJECTION (same block + real constants as
// session-profiles.test.mjs), focused here on the DECISION truth table and the
// load-bearing SHADOW INVARIANT: a pre-approved tool must resolve to 'preapproved'
// and can therefore NEVER reach the gate (§A.5 / research §3).
//
// SECURITY (adversarial review): grantDecision OP-SCOPES `dopl_channel` (FIX H1 — no
// blanket pre-approval) and reflects `full`'s HARD-DENY subset (FIX H2/H3). v2.5 D2
// went further: NO dopl_channel op auto-allows any more, own-channel posts included,
// and the shadow check below proves the tool stays out of allowedTools so that gate can
// actually fire. The op/grant-key cases live in session-profiles.test.mjs; this file
// pins the invariants + the profile universe.

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

const tp = require(join(HERE, "..", "main", "tool-profiles.js"));
const { READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL, DOPL_SERVER_PREFIX, normalizeProfile } = tp;

const from = SRC.indexOf("// ─── BEGIN SESSION-PROFILE TABLE");
const to = SRC.indexOf("// ─── END SESSION-PROFILE TABLE");
assert.ok(from !== -1 && to > from, "SESSION-PROFILE TABLE sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

// v2.9: the block digests grant keys, so `shaKey` is injected like normalizeProfile. FIX F4:
// the FULL digest, not a 12-hex prefix — 48 bits is minutes of search for a counterparty who
// supplies the exact command/body text, and a grant key is a Set member, never a display string.
const shaKey = (v) => createHash("sha256").update(String(v == null ? "" : v)).digest("hex");

const { buildSessionToolConfig, grantDecision, grantKeyFor } = new Function(
  "READ_BUILTINS", "WEB_TOOLS", "DOPL_SAFE_TOOLS", "DENIED_BUILTINS",
  "DOPL_ADMIN_TOOLS", "DOPL_CHANNEL_TOOL", "DOPL_SERVER_PREFIX", "normalizeProfile", "shaKey",
  `${BLOCK}
   return { buildSessionToolConfig, grantDecision, grantKeyFor };`
)(READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL, DOPL_SERVER_PREFIX, normalizeProfile, shaKey);

const PROFILES = ["read_only", "dopl_only", "full"];
const ownPost = (channel) => ({ op: "post", channel });

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
    assert.equal(grantDecision({ profile, toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "open", direct: true } }), "gate");
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

// ── FIX H2 / H3: the dangerous subset hard-denies under every profile ────────────

test("FIX H3: Task + Agent resolve 'deny' (never 'gate') under EVERY session profile", () => {
  for (const profile of PROFILES) {
    assert.equal(grantDecision({ profile, toolName: "Task" }), "deny", `${profile}: Task`);
    assert.equal(grantDecision({ profile, toolName: "Agent" }), "deny", `${profile}: Agent`);
  }
});

test("FIX H2: full hard-denies the persistence/exfil/delegation subset (deny, not gate)", () => {
  for (const tool of ["Task", "Agent", "CronCreate", "CronDelete", "SendMessage", "RemoteTrigger", "ScheduleWakeup", "Monitor", "Skill", "ToolSearch"]) {
    assert.equal(grantDecision({ profile: "full", toolName: tool }), "deny", `full must deny ${tool}`);
  }
  for (const tool of DOPL_ADMIN_TOOLS) {
    assert.equal(grantDecision({ profile: "full", toolName: tool }), "deny", `full must deny ${tool}`);
  }
});

// ── Robustness ───────────────────────────────────────────────────────────────

test("grantDecision tolerates missing args and unknown profiles (normalize to full)", () => {
  assert.equal(grantDecision({ toolName: "Bash" }), "gate", "no profile -> full -> Bash gates");
  // FIX H1 + D2: dopl_channel gates whatever the input is — no input, and an
  // own-channel post, both land on the operator's dock.
  assert.equal(grantDecision({ profile: "nonsense", toolName: DOPL_CHANNEL_TOOL }), "gate");
  assert.equal(grantDecision({ profile: "nonsense", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: ownPost("c1") }), "gate");
  assert.equal(grantDecision(), "gate", "no args -> full -> unknown tool gates");
});

// ── v2.x WORKSPACE PIN: the dopl MCP server entry the session actually runs with ──
//
// The other half of "the spawned agent does not know where it lives". The device
// credential can span several workspaces, and a multi-workspace connection has NO
// default, so every dopl call that omitted `workspace=` was refused ("This connection
// has no default workspace ... pass workspace=<slug_or_id>"). buildMcpServers now pins
// the SESSION's workspace UUID as the `X-Workspace-Id` request header — the pin the MCP
// endpoint resolves against the caller's own memberships — so an unqualified call
// auto-targets instead of failing. The pin GRANTS nothing (it must match a membership
// the credential already has) and a per-call `workspace=` still wins server-side.
//
// sdk-loader.js is electron-bound (app.getPath), so the function is source-extracted and
// driven with fakes — the same idiom the rest of this directory uses. C1/C2 changed what it
// is injected with: the bearer now comes from mcp-config's safeStorage cache (`doplBearer`)
// instead of a readFileSync of mcp-spawn.json, and the url is always the compiled-in
// MCP_URL. The credential-path story itself is pinned in test/sdk-mcp-token.test.mjs.

const LOADER = readFileSync(join(HERE, "..", "main", "sdk-loader.js"), "utf8");
const MCP_BLOCK = LOADER.slice(
  LOADER.indexOf("function buildMcpServers("),
  LOADER.indexOf("// FIX M2 — a scrubbed copy")
);
assert.ok(MCP_BLOCK.includes("return { dopl: server };"), "buildMcpServers slice missing/incomplete");

const MCP_URL = "https://dopl.test/api/mcp";

function buildServers(policy, workspaceId, token = "secret-token") {
  return new Function(
    "doplBearer", "MCP_URL", "policy", "workspaceId",
    `${MCP_BLOCK}\n return buildMcpServers(policy, workspaceId);`
  )(() => token, MCP_URL, policy, workspaceId);
}

const WS_UUID = "9a1b2c3d-2222-4ccc-8ddd-eeeeeeeeeeee";

test("the session's workspace UUID rides as the X-Workspace-Id header, beside the bearer", () => {
  const servers = buildServers(null, WS_UUID);
  assert.deepEqual(servers.dopl.headers, {
    Authorization: "Bearer secret-token",
    "X-Workspace-Id": WS_UUID,
  }, "the header the MCP endpoint reads as its per-request pin");
  assert.equal(servers.dopl.type, "http");
  assert.equal(servers.dopl.url, MCP_URL, "C2: always the compiled-in url");
});

test("no session workspace -> NO pin header at all (today's behavior, unchanged)", () => {
  for (const missing of [undefined, null, "", "   ", 42, {}]) {
    const headers = buildServers(null, missing).dopl.headers;
    assert.deepEqual(Object.keys(headers), ["Authorization"], JSON.stringify(missing));
  }
});

test("the pin does not disturb the per-profile dopl tools allowlist (or the bearer)", () => {
  const scoped = buildServers(["dopl_channel"], WS_UUID);
  assert.deepEqual(scoped.dopl.tools, ["dopl_channel"], "a restricted profile still only sees its scoped tools");
  assert.equal(scoped.dopl.headers.Authorization, "Bearer secret-token");
  const open = buildServers(null, WS_UUID);
  assert.ok(!("tools" in open.dopl), "null policy still means no per-server bound");
  // No token (pre-sign-in) still returns {} — a pin can never manufacture a server entry.
  assert.deepEqual(buildServers(null, WS_UUID, ""), {}, "no bearer -> no server");
});

test("buildSdkOptions passes the SESSION's workspace, so every session query is pinned", () => {
  const ENGINE = readFileSync(join(HERE, "..", "main", "session-engine.js"), "utf8");
  const opts = ENGINE.slice(ENGINE.indexOf("function buildSdkOptions(s) {"), ENGINE.indexOf("async function startQuery("));
  assert.match(opts, /mcpServers: buildMcpServers\(cfg\.doplToolsPolicy, s\.workspaceId\),/);
  // A parked resume and a recreated shell assemble options through this SAME function
  // (session-park calls deps.buildSdkOptions), so they are pinned by construction.
  assert.match(ENGINE, /sessionPark\.bind\(\{\n?\s*sessions, getSdk, buildSdkOptions/);
});
