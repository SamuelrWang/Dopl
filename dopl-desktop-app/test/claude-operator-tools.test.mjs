// "Use my tools" on Claude: the operator's USER-scope servers join Dopl's (Dopl's win a clash, and no
// second route to Dopl is admitted), Agent/Skill are offered, the connector lane's off switch and the
// Chrome flag are lifted, and nothing reads their settings (`settingSources` stays `[]`).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = join(HERE, "..", "main");
const { withOperatorTools, userMcpServers } = require(join(MAIN, "runtime", "claude", "operator-tools.js"));
const { MCP_URL } = require(join(MAIN, "config.js"));

function home(mcpServers) {
  const dir = mkdtempSync(join(tmpdir(), "dopl-op-home-"));
  writeFileSync(join(dir, ".claude.json"), JSON.stringify({
    mcpServers,
    projects: { "/some/repo": { mcpServers: { projectOnly: { type: "http", url: "https://p.example/mcp" } } } },
  }));
  return dir;
}

const OPERATOR = {
  dopl: { type: "http", url: "https://www.usedopl.com/api/mcp", headers: { Authorization: "Bearer device" } },
  doplAlias: { type: "http", url: MCP_URL },
  supabase: { type: "http", url: "https://mcp.supabase.com/mcp" },
  local: { command: "node", args: ["server.js"] },
  junk: "not an entry",
};

test("user scope only; Dopl's entry and any alias of it never ride in", () => {
  assert.deepEqual(Object.keys(userMcpServers(home(OPERATOR))).sort(), ["local", "supabase"]);
  assert.deepEqual(userMcpServers(join(tmpdir(), "no-such-home")), {}, "no config reads as none");
});

test("the spawn gains the operator's tooling and Dopl's entries win a name clash", () => {
  const doplEntry = { type: "http", url: MCP_URL, headers: { Authorization: "Bearer locked" } };
  const options = {
    mcpServers: { dopl: doplEntry, supabase: { type: "http", url: "https://dopl-owned.example" } },
    tools: ["Read", "Edit"],
    env: { ENABLE_CLAUDEAI_MCP_SERVERS: "0", PATH: "/bin" },
    settingSources: [],
  };
  const out = withOperatorTools(options, home(OPERATOR));
  assert.equal(out.mcpServers.dopl, doplEntry, "the session's own credential stays");
  assert.equal(out.mcpServers.supabase.url, "https://dopl-owned.example");
  assert.deepEqual(out.mcpServers.local, OPERATOR.local);
  assert.deepEqual(out.tools, ["Read", "Edit", "Agent", "Skill"]);
  assert.equal("ENABLE_CLAUDEAI_MCP_SERVERS" in out.env, false);
  assert.deepEqual(out.extraArgs, { chrome: null });
  assert.deepEqual(out.settingSources, [], "the operator's settings are never loaded");
  assert.equal(out.plugins, undefined, "no userData here, so no skills plugin (and no throw)");
});

test("only a session stamped with a scope takes the widening", () => {
  const src = readFileSync(join(MAIN, "runtime", "claude", "launch-spec.js"), "utf8");
  assert.match(src, /if \(s\.operatorTools\) operatorTools\.withOperatorTools\(options\);/);
  assert.match(src, /settingSources: \[\],/);
});
