// ONE VOCABULARY, CHECKED ACROSS EVERY TREE (2026-10-08). Each runtime's tool-mode words are declared ONCE,
// in its adapter's descriptor (`main/runtime/<id>/index.js › toolMode.options`). The web schema, the shared
// contracts, the MCP server's enum and the database CHECK cannot import the desktop, so they hold copies —
// and this suite fails the moment any copy differs from the descriptor. A word added, renamed or dropped in
// an adapter is a red build until every tree agrees, never a silent mismatch in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const require = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const RUNTIMES = ["claude", "codex", "cursor"];
const wordsOf = (id) => require(join(HERE, "..", "main", "runtime", id, "index.js")).descriptor.toolMode.options.map((o) => o.value);

/** The quoted strings inside the first `[...]` after `<key>:` in a TS source. */
function listAfter(text, key) {
  const m = new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(text);
  assert.ok(m, `no list for ${key}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g), (x) => x[1]);
}

/** The newest migration that writes the launch-directive tool-word CHECK. */
function newestToolWordMigration() {
  const dir = join(ROOT, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().reverse();
  const hit = files.find((f) => /channel_launch_directives/.test(f) && /applied_tool_mode/.test(readFileSync(join(dir, f), "utf8")));
  assert.ok(hit, "no migration writes the tool-word CHECK");
  return readFileSync(join(dir, hit), "utf8");
}

for (const id of RUNTIMES) {
  test(`${id}: the web's per-runtime list IS the descriptor's, in order`, () => {
    assert.deepEqual(listAfter(read("src/features/channels/schema-launch-modes.ts"), id), wordsOf(id));
  });

  test(`${id}: the contracts type, the MCP enum and the DB CHECK each carry every word`, () => {
    const contracts = read("packages/contracts/src/directives.ts");
    const mcp = read("packages/mcp-server/src/tools/channel-schema-launch-fields.ts");
    const sql = newestToolWordMigration();
    for (const w of wordsOf(id)) {
      assert.ok(contracts.includes(`"${w}"`), `contracts LaunchToolMode lacks "${w}"`);
      assert.ok(mcp.includes(`"${w}"`), `MCP posture.tools enum lacks "${w}"`);
      assert.ok(sql.includes(`'${w}'`), `the DB CHECK lacks '${w}'`);
    }
  });
}

test("no tree carries a tool word NO runtime declares (a dropped word must leave every copy)", () => {
  const all = new Set(RUNTIMES.flatMap(wordsOf).concat(["ask", "auto", "full"]));
  const mcpEnum = /tools:\s*z\s*\.enum\(\[([\s\S]*?)\]\)/.exec(read("packages/mcp-server/src/tools/channel-schema-launch-fields.ts"));
  assert.ok(mcpEnum, "MCP posture.tools enum not found");
  for (const [, w] of mcpEnum[1].matchAll(/"([^"]+)"/g)) assert.ok(all.has(w), `MCP enum has "${w}", which no runtime declares`);
  const web = read("src/features/channels/schema-launch-modes.ts");
  for (const id of RUNTIMES) for (const w of listAfter(web, id)) assert.ok(all.has(w), `web has "${w}"`);
});
