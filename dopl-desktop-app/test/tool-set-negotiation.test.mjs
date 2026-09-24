// THE TOOL-SET NEGOTIATION (DMP-013 B4): a session asks for `granular` ONLY where the server said it
// serves it, read off the launch pre-flight's own `initialize` answer; everything else stays on the
// legacy default and sends no header at all.
//
//   new desktop × old server   → no advertisement → legacy, no header (today's bytes)
//   new desktop × new server   → advertisement    → `X-Dopl-Tool-Set: granular` on all three runtimes
//   old desktop × new server   → no header        → the server's legacy default
//
// Run: `node --test dopl-desktop-app/test/tool-set-negotiation.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = join(HERE, "..", "..");
const M = (...p) => join(HERE, "..", "main", ...p);

const mcpConnect = require(M("mcp-connect.js"));
const codexMcp = require(M("runtime", "codex", "mcp.js"));
const cursorMcp = require(M("runtime", "cursor", "mcp.js"));

const initAnswer = (experimental) => ({ jsonrpc: "2.0", id: 0, result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, ...(experimental && { experimental }) } } });
const ADVERTISED = { "dopl/toolSets": { sets: ["legacy", "granular"] } };
const response = (body, type = "application/json") => ({
  status: 200,
  headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) },
  text: async () => body,
});

test("the words are the server's own: capability name and header, read out of its source", () => {
  const manifest = readFileSync(join(ROOT, "packages", "mcp-server", "src", "tool-manifest.ts"), "utf8");
  assert.match(manifest, new RegExp(`export const TOOL_SETS_CAPABILITY = "${mcpConnect.TOOL_SETS_CAPABILITY}";`));
  assert.match(manifest, /export const TOOL_SETS = \["legacy", "granular"\] as const;/);
  const header = readFileSync(join(ROOT, "src", "shared", "auth", "tool-set-header.ts"), "utf8");
  assert.match(header, new RegExp(`export const TOOL_SET_HEADER = "${mcpConnect.TOOL_SET_HEADER.toLowerCase()}";`));
});

test("granular only when the answer names it; anything else is the default", () => {
  assert.equal(mcpConnect.advertisedToolSet(initAnswer(ADVERTISED)), "granular");
  for (const frame of [initAnswer(), initAnswer({ "dopl/toolSets": { sets: ["legacy"] } }), initAnswer({ "dopl/toolSets": "granular" }),
    { error: { message: "nope" } }, null, undefined, "granular"]) {
    assert.equal(mcpConnect.advertisedToolSet(frame), "legacy", JSON.stringify(frame));
  }
});

test("the pre-flight reads the advertisement off its own answer, JSON or SSE, and still answers its word", async () => {
  const heard = [];
  const onToolSet = (set) => heard.push(set);
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", onToolSet, fetchImpl: async () => response(JSON.stringify(initAnswer(ADVERTISED))) }), "http 200");
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", onToolSet,
    fetchImpl: async () => response(`event: message\ndata: ${JSON.stringify(initAnswer(ADVERTISED))}\n\n`, "text/event-stream") }), "http 200");
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", onToolSet, fetchImpl: async () => response(JSON.stringify(initAnswer())) }), "http 200");
  assert.deepEqual(heard, ["granular", "granular", "legacy"]);
});

test("…and an answer it cannot read teaches nothing and fails nothing", async () => {
  const heard = [];
  const onToolSet = (set) => heard.push(set);
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", onToolSet, fetchImpl: async () => ({ status: 401, text: async () => "{}" }) }), "http 401");
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", onToolSet, fetchImpl: async () => ({ status: 200 }) }), "http 200");
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", onToolSet,
    fetchImpl: async () => ({ status: 200, text: async () => { throw new Error("reset"); } }) }), "http 200");
  assert.equal(await mcpConnect.warmMcpRoute({ url: "u", onToolSet, fetchImpl: async () => response("not json") }), "http 200");
  assert.deepEqual(heard, ["legacy"], "only a parsed-but-silent answer says legacy; the rest say nothing");
});

test("every runtime's entry carries the header for granular, and nothing at all for legacy", () => {
  assert.deepEqual(mcpConnect.toolSetHeaders("legacy"), {});
  assert.deepEqual(mcpConnect.toolSetHeaders(undefined), {});
  assert.deepEqual(mcpConnect.toolSetHeaders("granular"), { "X-Dopl-Tool-Set": "granular" });

  for (const set of [undefined, "legacy", "granular"]) {
    const want = set === "granular" ? "granular" : undefined;
    assert.equal(codexMcp.buildDoplServerEntry(null, "full", set).http_headers["X-Dopl-Tool-Set"], want, `codex ${set}`);
    assert.equal(cursorMcp.buildWiring("ws", "tok", "slot", set).headers["X-Dopl-Tool-Set"], want, `cursor ${set}`);
  }
  // Claude's loader needs electron at load; its stamp is pinned by source and by the shared helper.
  const loader = readFileSync(M("runtime", "claude", "loader.js"), "utf8");
  assert.match(loader, /function withToolSetStamp\(servers, toolSet\) \{[\s\S]*?mcpConnect\.toolSetHeaders\(toolSet\)/);
  assert.match(readFileSync(M("runtime", "claude", "launch-spec.js"), "utf8"), /loader\.withToolSetStamp\(options\.mcpServers, s\.doplToolSet\);/);
});

test("a session is stamped before its first turn, and only ever moves back to the default", () => {
  const query = readFileSync(M("session-query.js"), "utf8");
  const engine = readFileSync(M("session-engine.js"), "utf8");
  assert.ok(engine.indexOf("await sessionQuery.stampToolSet(s);") < engine.indexOf("nameAndFrame(s, spec, rt);\n  // Spawn idle"),
    "the tool set must be known before the first turn spells a call in it");
  assert.match(query, /s\.doplToolSet = advertisedToolSet \|\| mcpConnect\.LEGACY_TOOL_SET;/);
  assert.match(query, /if \(heard === mcpConnect\.LEGACY_TOOL_SET && s\.doplToolSet === mcpConnect\.GRANULAR_TOOL_SET\) s\.doplToolSet = heard;/);
});
