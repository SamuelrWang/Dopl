// "Use my tools" on Codex: the operator's servers (from `codex mcp list --json`, forced to `prompt`),
// their tool-call approvals routed to Dopl's gate under an operator-tool name, and the native fences
// lifted only for a session launched private into a room that is still private.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const CODEX = join(MAIN, "runtime", "codex");

const room = { memberCount: 1 };
const listener = join(MAIN, "channel-listener.js");
require.cache[listener] = { id: listener, filename: listener, loaded: true, children: [], paths: [],
  exports: { watchedChannel: (id) => (id ? { id, memberCount: room.memberCount } : null) } };

const ops = require(join(CODEX, "operator-tools.js"));
const requests = require(join(CODEX, "server-requests.js"));
const launchSpec = require(join(CODEX, "launch-spec.js"));

const STDIO = { name: "node_repl", enabled: true, startup_timeout_sec: 120, tool_timeout_sec: null,
  transport: { type: "stdio", command: "/bin/node_repl", args: [], env: { K: "v" }, env_vars: [], cwd: null } };
const HTTP = { name: "supabase", enabled: true, transport: { type: "streamable_http", url: "https://mcp.supabase.com/mcp",
  bearer_token_env_var: null, http_headers: { Authorization: "Bearer x" }, env_http_headers: null, http_headers_helper: null } };

test("a list row becomes a prompt-mode thread entry; disabled, unknown and Dopl's own are dropped", () => {
  assert.deepEqual(ops.entryFor(STDIO), {
    default_tools_approval_mode: "prompt", command: "/bin/node_repl", args: [], env: { K: "v" }, env_vars: [], startup_timeout_sec: 120,
  });
  assert.deepEqual(ops.entryFor(HTTP), {
    default_tools_approval_mode: "prompt", url: "https://mcp.supabase.com/mcp", http_headers: { Authorization: "Bearer x" },
  });
  assert.equal(ops.entryFor({ ...STDIO, enabled: false }), null);
  assert.equal(ops.entryFor({ ...STDIO, transport: { type: "sse" } }), null);
  assert.equal(ops.entryFor({ name: "dopl", enabled: true, transport: { type: "streamable_http", url: "https://x.example/api/mcp" } }), null);
});

test("the list is read through the given binary; a failure is no servers and a diag line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dopl-codex-list-"));
  const bin = join(dir, "codex");
  writeFileSync(bin, `#!/bin/sh\n[ "$1 $2 $3" = "mcp list --json" ] && echo '${JSON.stringify([STDIO, HTTP])}'\n`);
  chmodSync(bin, 0o755);
  assert.deepEqual(Object.keys(await ops.operatorServers(bin, process.env, () => {})).sort(), ["node_repl", "supabase"]);
  const logged = [];
  assert.deepEqual(await ops.operatorServers(join(dir, "missing"), process.env, (...a) => logged.push(a.join(" "))), {});
  assert.match(logged[0], /could not read your MCP servers/);
  assert.deepEqual(await ops.operatorServers(null, process.env, () => {}), {});
});

const elicitation = (serverName, title) => ({
  serverName, _meta: { codex_approval_kind: "mcp_tool_call", tool_title: title, tool_params: { query: "select 1" } },
});

test("an operator server's tool call reaches the gate as an operator tool; any other server still declines unasked", async () => {
  const servers = ops.approvalServers({ supabase: {} }, false);
  assert.deepEqual(requests.operatorElicitation(elicitation("supabase", "execute_sql"), servers),
    { name: "mcp__supabase__execute_sql", input: { query: "select 1" } });
  assert.equal(requests.operatorElicitation(elicitation("other", "x"), servers), null);
  assert.equal(requests.operatorElicitation(elicitation("dopl", "dopl_channel"), new Set(["dopl"])), null);
  const asked = [];
  const reply = await requests.answer({ method: "mcpServer/elicitation/request", params: elicitation("supabase", "execute_sql") },
    async (name) => { asked.push(name); return "allow"; }, () => {}, servers);
  assert.deepEqual(reply, { action: "accept" });
  assert.deepEqual(asked, ["mcp__supabase__execute_sql"]);
  const unasked = await requests.answer({ method: "mcpServer/elicitation/request", params: elicitation("supabase", "execute_sql") },
    async () => "allow", () => {});
  assert.deepEqual(unasked, { action: "decline" }, "no operator servers, no route");
  assert.equal(ops.approvalServers({}, true).has("codex_apps"), true, "apps are the operator's too, private only");
});

const specFor = (operatorTools) => launchSpec.buildLaunchSpec({
  session: { profile: "full", channelId: "c1", state: {}, workspaceId: "ws-1", model: "", operatorTools },
  dispatch: () => {},
});

test("natives: lifted only for a private launch into a room that is still private", () => {
  room.memberCount = 1;
  const priv = specFor("private");
  assert.equal(priv.natives, true);
  assert.deepEqual(priv.threadStart.config.features, ops.NATIVE_FEATURES);
  assert.equal(priv.threadStart.config.features.hooks, false, "hooks stay off");
  assert.equal("skills" in priv.threadStart.config, false, "Codex's own skill discovery");
  for (const s of [specFor("shared"), specFor("")]) {
    assert.equal(s.natives, false);
    assert.equal(s.threadStart.config.features.multi_agent, false);
    assert.equal(typeof s.threadStart.config.skills, "object");
  }
  room.memberCount = 2;
  assert.equal(specFor("private").natives, false, "a peer joined: the relaunch is fenced");
});
