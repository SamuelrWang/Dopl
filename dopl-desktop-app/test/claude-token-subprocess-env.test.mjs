// CAN AN AGENT'S SHELL READ DOPL'S CLAUDE TOKEN? The bundled CLI builds every subprocess env — the Bash
// tool, hooks, stdio MCP servers — through one function that deletes `CLAUDE_CODE_OAUTH_TOKEN` whenever it
// is set (claude 2.1.220). This drives the REAL binary with a FAKE token and a dead API URL (no network, no
// model turn) and reads the env a SessionStart hook, built by that same function, is handed. The token's
// value is never printed: the hook counts matches.
//
// Opt-in, the no-turn Claude tier: `CLAUDE_SDK_LIVE=1 node --test test/claude-token-subprocess-env.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const BUDGET_MS = 30000;

function bundledBinary() {
  try {
    const bin = join(dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)), "claude");
    return existsSync(bin) ? bin : null;
  } catch (_) {
    return null;
  }
}

test("LIVE: a subprocess of the CLI (the Bash tool's env builder) never carries the token", { timeout: BUDGET_MS + 5000 }, async (t) => {
  if (process.env.CLAUDE_SDK_LIVE !== "1") {
    t.diagnostic("SKIPPED, NOT PASSED — set CLAUDE_SDK_LIVE=1 to run the bundled CLI (no turn, no network)");
    t.skip("CLAUDE_SDK_LIVE is not 1");
    return;
  }
  const bin = bundledBinary();
  assert.ok(bin, "the bundled Claude binary must resolve for this platform");
  const root = mkdtempSync(join(tmpdir(), "dopl-claude-token-env-"));
  const home = join(root, "home");
  mkdirSync(home);
  const out = join(root, "hook.out");
  const hook = `printf '%s %s' "$(env | grep -c '^CLAUDE_CODE_OAUTH_TOKEN=')" "$(ps -E -ww -p $PPID | grep -c 'CLAUDE_CODE_OAUTH_TOKEN=')" > '${out}'`;
  const settings = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: hook }] }] } });
  const child = spawn(bin, ["-p", "hi", "--settings", settings, "--setting-sources", "", "--max-turns", "1"], {
    stdio: "ignore",
    env: {
      HOME: home,
      PATH: "/usr/bin:/bin",
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-dopl-probe-not-a-token",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  });
  try {
    const deadline = Date.now() + BUDGET_MS;
    while (!existsSync(out) || !readFileSync(out, "utf8").includes(" ")) {
      assert.ok(Date.now() < deadline, "the SessionStart hook never ran");
      await new Promise((r) => setTimeout(r, 200));
    }
    const [inherited, parent] = readFileSync(out, "utf8").trim().split(" ").map(Number);
    t.diagnostic(`subprocess env: ${inherited}; the CLI process's own launch env, read by the subprocess with ps -E: ${parent}`);
    assert.equal(inherited, 0, "the token is not in a subprocess's environment");
  } finally {
    child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
