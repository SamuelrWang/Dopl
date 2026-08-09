// THE PER-SERVER MCP `tools` FIELD — what it is, and why sdk-loader no longer sends one.
// (F-177 follow-up, 2026-08-08.)
//
// THE DEFECT THIS FILE CLOSES. `buildMcpServers` used to copy `session-profiles`'
// `doplToolsPolicy` — an array of SHORT dopl names — onto the dopl entry's `tools` field,
// commented as "the per-server `tools` allowlist so a restricted profile only sees its
// scoped dopl tools". The bundled SDK (0.3.220 / Claude Code 2.1.220) types that field as
// `McpServerToolPolicy[]`, i.e. `{name, permission_policy?}[]`: a PERMISSION policy for
// remote servers, with no shape that means "offer only these". A string is not that object,
// the CLI validates `--mcp-config` per entry with zod, and a failed parse does not strip the
// bad field — it DROPS THE WHOLE SERVER. Verified against the bundled binary via the
// stream-json init message: `tools: ['dopl_channel']` produced `"mcp_servers": []`, while
// the object form and the omitted form both produced the entry. So the two restricted
// profiles were spawning with no dopl server at all — no `dopl_channel`, no delivery path.
//
// WHY IT NEEDS ITS OWN SUITE, and why it is three tests rather than one. The failure was
// SILENT ON BOTH SIDES: the CLI drops the entry with a warning nobody reads, and no desktop
// test asserted the shape of what we hand the SDK. So this file pins (1) what we SEND, (2)
// what the INSTALLED SDK says that field is — read out of node_modules, so a version bump
// that changes the contract fails here rather than in a session — and (3) the join that
// makes the removal safe: the deny lists' complement over the dopl surface IS the allowlist
// the removed line was trying to express. A pin of (1) alone would pass just as happily if
// the field came back in the "right" shape for the wrong reason.
//
// METHOD: sdk-loader.js is electron-bound (`app.getPath`), so the builder is brace-matched
// out of the source and evaluated with fakes — the idiom this directory uses (sdk-grant /
// sdk-mcp-token / mcp-client-timeout / session-id-stamp).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const LOADER = readFileSync(join(HERE, "..", "main", "sdk-loader.js"), "utf8");
const SDK_DTS = readFileSync(
  join(HERE, "..", "node_modules", "@anthropic-ai", "claude-agent-sdk", "sdk.d.ts"), "utf8"
);

const { buildSessionToolConfig, shortDoplName } = require(join(HERE, "..", "main", "session-profiles.js"));
const {
  DOPL_SAFE_TOOLS, DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS, DOPL_CHANNEL_TOOL,
} = require(join(HERE, "..", "main", "tool-profiles.js"));

// The real builder, run for real.
const MCP_URL = "https://dopl.test/api/mcp";
function buildServers(policy, workspaceId = "") {
  return new Function(
    "doplBearer", "clientTimeoutMs", "MCP_URL", "policy", "workspaceId",
    `${fnOf(LOADER, "buildMcpServers")}\n return buildMcpServers(policy, workspaceId);`
  )(() => "device-token", () => 280_000, MCP_URL, policy, workspaceId);
}

// ── (1) what we SEND ───────────────────────────────────────────────────────────

test("the dopl entry carries NO per-server `tools` field, whatever policy it is handed", () => {
  // Including the SHAPE THAT SHIPPED (short names) and the shape that would type-check:
  // neither belongs on the entry, because neither expresses the visibility bound the caller
  // means and the first one deletes the server.
  const policies = [
    ["null (full)", null],
    ["the shape that shipped", ["dopl_channel"]],
    ["read_only's real policy", buildSessionToolConfig("read_only").doplToolsPolicy],
    ["dopl_only's real policy", buildSessionToolConfig("dopl_only").doplToolsPolicy],
    ["a well-typed permission policy", [{ name: "dopl_channel", permission_policy: "always_ask" }]],
  ];
  for (const [label, policy] of policies) {
    const { dopl } = buildServers(policy);
    assert.ok(!("tools" in dopl), `${label}: a per-server tools policy is back on the entry`);
  }
});

test("the fields the entry DOES carry are unchanged by the removal", () => {
  // The removed line sat at the very end of the builder, so this is the regression that
  // would come from deleting one line too many — the bearer, the workspace pin, the F-177
  // alwaysLoad and the FIX Q9 timeout all live in the same object literal.
  const { dopl } = buildServers(["dopl_channel"], "9a1b2c3d-2222-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(dopl.type, "http");
  assert.equal(dopl.url, MCP_URL);
  assert.equal(dopl.alwaysLoad, true, "F-177: the dopl tools must never defer behind ToolSearch");
  assert.equal(dopl.timeout, 280_000);
  assert.deepEqual(dopl.headers, {
    Authorization: "Bearer device-token",
    "X-Dopl-Runtime": "desktop-session",
    "X-Workspace-Id": "9a1b2c3d-2222-4ccc-8ddd-eeeeeeeeeeee",
  });
});

// ── (2) what the INSTALLED SDK says the field is ───────────────────────────────

test("the installed SDK types per-server `tools` as a PERMISSION policy, not a name list", () => {
  // Read out of node_modules on purpose. If a future SDK ever accepts `tools?: string[]` on
  // a remote server config — i.e. actually gives us the allowlist the removed line assumed —
  // this fails, and sdk-loader's comment block is the thing to revisit. Until then, "it is a
  // permission policy" is a fact about the shipped version, not a belief.
  assert.match(
    SDK_DTS,
    /export declare type McpServerToolPolicy = \{\s*name: string;\s*permission_policy\?: 'always_allow' \| 'always_ask' \| 'always_deny';/,
    "McpServerToolPolicy is no longer {name, permission_policy} — re-read sdk-loader's block"
  );
  // …and that this is the type the http entry we build refers to.
  const http = SDK_DTS.slice(
    SDK_DTS.indexOf("export declare type McpHttpServerConfig = {"),
    SDK_DTS.indexOf("export declare type McpSdkServerConfig = {")
  );
  assert.ok(http.length > 0, "McpHttpServerConfig is gone from the SDK types");
  assert.match(http, /tools\?: McpServerToolPolicy\[\];/, "the http config's `tools` changed shape");
  assert.ok(!/tools\?: string\[\];/.test(http), "the http config now accepts a bare name list");
  assert.match(http, /alwaysLoad\?: boolean;/, "F-177's alwaysLoad left the http config");
});

// ── (3) the join that makes the removal safe ───────────────────────────────────

test("the deny lists already carry the bound the removed allowlist claimed", () => {
  // THE ARGUMENT, executed rather than asserted in prose: for each restricted profile, the
  // dopl tools NOT hard-denied are exactly the tools the old `doplToolsPolicy` named. If a
  // later edit adds a dopl tool to the surface, or drops one from a deny list, this fails —
  // which is the day the missing second bound would have mattered.
  const surface = [
    ...DOPL_SAFE_TOOLS, ...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS, DOPL_CHANNEL_TOOL,
  ];
  const sorted = (names) => [...new Set(names)].sort();
  for (const profile of ["read_only", "dopl_only"]) {
    const cfg = buildSessionToolConfig(profile);
    assert.ok(Array.isArray(cfg.doplToolsPolicy), `${profile} lost its doplToolsPolicy`);
    const reachable = surface.filter((t) => !cfg.disallowedTools.includes(t));
    assert.deepEqual(
      sorted(reachable.map(shortDoplName)),
      sorted(cfg.doplToolsPolicy),
      `${profile}: disallowedTools no longer covers the complement of the old allowlist`
    );
  }
  // `full` carried no policy, so there is nothing to cover and never was.
  assert.equal(buildSessionToolConfig("full").doplToolsPolicy, null);
});
