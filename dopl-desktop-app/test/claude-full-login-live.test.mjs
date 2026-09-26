// "ENABLE CHROME & CONNECTORS" (Samuel, 2026-09-25, ruling 4), MEASURED ON THE BUNDLED CLI. A spawn shaped
// like a "Use my tools" one on the full login — no `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`
// at a private store holding a claude.ai login's scopes, `--chrome` — turns Claude in Chrome on and takes the
// connector lane past its scope check; the same spawn on Dopl's setup-token env turns on neither.
//
// The credential is FAKE (a plaintext `.credentials.json` in a scratch store, which the CLI reads when no
// Keychain item exists for that store) and the API URL is dead, so no model turn runs and nothing is billed;
// the one request that leaves the machine is the connector list, sent with the fake bearer (it answers 401).
// HOME is a scratch directory, so nothing of the operator's (`~/.claude.json`, Chrome's native-host manifests,
// which `--chrome` writes under HOME) is read or written. It proves the WIRING; a real claude.ai login is what
// then returns the operator's connectors.
//
// Opt-in, the no-turn Claude tier: `CLAUDE_SDK_LIVE=1 node --test test/claude-full-login-live.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const BUDGET_MS = 30000;
const FAKE = "sk-ant-oat01-dopl-probe-not-a-token";
const CLAUDE_AI_SCOPES = ["user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers", "user:file_upload"];

function bundledBinary() {
  try {
    const bin = join(dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)), "claude");
    return existsSync(bin) ? bin : null;
  } catch (_) {
    return null;
  }
}

/** One spawn to its `init` message: the connected MCP servers and the CLI's debug lines about the two lanes. */
async function initOf(bin, env, root) {
  const sdk = await import(require.resolve("@anthropic-ai/claude-agent-sdk"));
  const ac = new AbortController();
  async function* prompt() {
    yield { type: "user", message: { role: "user", content: "hi" }, parent_tool_use_id: null, session_id: "" };
    await new Promise(() => {});
  }
  const q = sdk.query({ prompt: prompt(), options: {
    pathToClaudeCodeExecutable: bin, settingSources: [], permissionMode: "default", env, cwd: env.HOME,
    extraArgs: { chrome: null, "debug-file": join(root, "debug.log") }, abortController: ac, maxTurns: 1,
    canUseTool: async () => ({ behavior: "deny", message: "probe" }),
  } });
  const timer = setTimeout(() => ac.abort(), BUDGET_MS);
  let servers = null;
  try {
    for await (const m of q) {
      if (m.type === "system" && m.subtype === "init") { servers = m.mcp_servers; break; }
    }
  } catch (_) { /* the abort */ }
  clearTimeout(timer);
  ac.abort();
  const log = existsSync(join(root, "debug.log")) ? readFileSync(join(root, "debug.log"), "utf8") : "";
  return { servers, log };
}

function scratch(name) {
  const root = mkdtempSync(join(tmpdir(), `dopl-full-login-${name}-`));
  mkdirSync(join(root, "home"));
  return root;
}

const baseEnv = (root) => ({ PATH: "/usr/bin:/bin", USER: process.env.USER, HOME: join(root, "home"), ANTHROPIC_BASE_URL: "http://127.0.0.1:9" });

test("LIVE: the full login's private store turns Chrome and the connector lane on; Dopl's setup-token env does not",
  { timeout: 2 * BUDGET_MS + 10000 }, async (t) => {
    if (process.env.CLAUDE_SDK_LIVE !== "1") {
      t.diagnostic("SKIPPED, NOT PASSED — set CLAUDE_SDK_LIVE=1 to run the bundled CLI (no turn; one 401 connector-list request)");
      t.skip("CLAUDE_SDK_LIVE is not 1");
      return;
    }
    const bin = bundledBinary();
    assert.ok(bin, "the bundled Claude binary must resolve for this platform");

    const full = scratch("store");
    const store = join(full, "store");
    mkdirSync(store, { mode: 0o700 });
    writeFileSync(join(store, ".credentials.json"), JSON.stringify({ claudeAiOauth: {
      accessToken: FAKE, refreshToken: null, expiresAt: Date.now() + 3600000, scopes: CLAUDE_AI_SCOPES, subscriptionType: "max",
    } }), { mode: 0o600 });
    const token = scratch("token");
    try {
      const on = await initOf(bin, { ...baseEnv(full), CLAUDE_SECURESTORAGE_CONFIG_DIR: store }, full);
      assert.ok(on.servers, "the full-login spawn reached init");
      assert.deepEqual(on.servers.find((s) => s.name === "claude-in-chrome"), { name: "claude-in-chrome", status: "connected" },
        "Claude in Chrome is on");
      assert.match(on.log, /\[claudeai-mcp\] Fetching from https:\/\/api\.anthropic\.com\/v1\/mcp_servers/,
        "the connector lane is past its scope check (a real login then lists the operator's connectors)");
      assert.ok(readdirSync(join(full, "home")).length > 0 && !existsSync(join(store, ".claude.json")),
        "the session wrote under its HOME, and nothing but the credential lives in the store");

      const off = await initOf(bin, { ...baseEnv(token), CLAUDE_CODE_OAUTH_TOKEN: FAKE }, token);
      assert.ok(off.servers, "the setup-token spawn reached init");
      assert.equal(off.servers.some((s) => s.name === "claude-in-chrome"), false, "no Chrome on user:inference");
      assert.match(off.log, /Missing user:mcp_servers scope/, "and no connectors");
    } finally {
      rmSync(full, { recursive: true, force: true });
      rmSync(token, { recursive: true, force: true });
    }
  });
