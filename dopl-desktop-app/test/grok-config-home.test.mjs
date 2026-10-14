// Grok's private home and env scrub: HOME, GROK_HOME and GROK_AUTH_PATH inside Dopl's own dir, Dopl's two
// config files rewritten on every launch (the ask rule, the MCP allow-list), Grok's knobs set, every inherited
// credential and GROK_/XAI_ knob stripped, ambient config refused, a linked credential removed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, statSync, readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { g } from "./_grok-harness.mjs";

const home = g("config-home.js");
const root = () => mkdtempSync(join(tmpdir(), "dopl-grok-home-"));

test("isolatedEnv: HOME, GROK_HOME, GROK_AUTH_PATH and XDG_* live inside Dopl's private home, owner-only", () => {
  const r = root();
  const env = home.isolatedEnv({ PATH: "/usr/bin", HOME: "/Users/operator" }, r);
  const dir = home.privateHome(r);
  for (const k of ["HOME", "GROK_HOME", "GROK_AUTH_PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
    assert.ok(env[k].startsWith(dir), `${k}=${env[k]} escapes the private home`);
  }
  assert.equal(env.GROK_AUTH_PATH, home.authFile(r));
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(env.GROK_DISABLE_AUTOUPDATER, "1");
  assert.equal(env.GROK_TELEMETRY_ENABLED, "0");
  for (const v of ["CLAUDE", "CURSOR"]) for (const s of ["AGENTS", "RULES", "SKILLS", "MCPS", "HOOKS", "SESSIONS"]) {
    assert.equal(env[`GROK_${v}_${s}_ENABLED`], "false");
  }
  assert.equal(env.GROK_CODEX_SESSIONS_ENABLED, "false");
  assert.equal(env.PATH, "/usr/bin");
});

test("Dopl's config.toml carries the ask rule for its MCP server; requirements.toml allow-lists ONLY that server", () => {
  const r = root();
  const env = home.isolatedEnv({}, r);
  const cfg = readFileSync(join(env.GROK_HOME, "config.toml"), "utf8");
  const req = readFileSync(join(env.GROK_HOME, "requirements.toml"), "utf8");
  assert.match(cfg, /\[permission\]\nask = \["MCPTool\(dopl_session__\*\)"\]/, "the exact form the smoke measured (smoke-s2)");
  assert.match(cfg, /remember_tool_approvals = false/);
  assert.match(cfg, /auto_update = false/);
  assert.match(cfg, /use_leader = false/);
  assert.doesNotMatch(cfg, /yolo|always_approve/i);
  assert.match(req, /enable_all_project_mcp_servers = false/);
  assert.match(req, /\[\[allowed_mcp_servers\]\]\nserver_name = "dopl_session"/);
  assert.equal((req.match(/server_name/g) || []).length, 1);
  assert.equal(statSync(join(env.GROK_HOME, "config.toml")).mode & 0o777, 0o600);
  // Rewritten whole on the next launch: an edit (or Grok's own append) does not survive.
  writeFileSync(join(env.GROK_HOME, "config.toml"), "[permission]\nallow = [\"MCPTool(dopl_session__*)\"]\n");
  home.isolatedEnv({}, r);
  assert.equal(readFileSync(join(env.GROK_HOME, "config.toml"), "utf8"), home.CONFIG_TOML);
});

test("buildScrubbedEnv drops XAI_API_KEY / GROK_CODE_XAI_API_KEY (they would replace the subscription) and every GROK_/XAI_ knob", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { XAI_API_KEY: "k", GROK_CODE_XAI_API_KEY: "k2", GROK_CONFIG: "{}", GROK_DEFAULT_SELECTED_PERMISSION: "yolo",
      GROK_AUTH_COMMAND: "/x", XAI_BASE_URL: "x", OPENAI_API_KEY: "o", KEEP_ME: "yes" });
    const env = home.buildScrubbedEnv();
    for (const k of ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY", "GROK_CONFIG", "GROK_DEFAULT_SELECTED_PERMISSION", "GROK_AUTH_COMMAND", "XAI_BASE_URL", "OPENAI_API_KEY"]) {
      assert.equal(env[k], undefined, `${k} reached the child`);
    }
    assert.equal(env.KEEP_ME, "yes");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("ambient config in the private home refuses the launch, by name (~/.claude settings load even with compat off — measured)", () => {
  for (const [rel, isDir] of [[".claude", true], [".claude.json", false], [".mcp.json", false], [".codex", true], [".grok/plugins", true], [".grok/skills", true], [".grok/hooks", true], [".grok/managed_config.toml", false]]) {
    const r = root();
    const p = join(home.privateHome(r), rel);
    mkdirSync(isDir ? p : join(p, ".."), { recursive: true });
    if (!isDir) writeFileSync(p, "{}");
    assert.throws(() => home.isolatedEnv({}, r), new RegExp(rel.split("/").pop().replace(".", "\\.")), rel);
  }
});

test("Dopl's credential: a regular file reads present (never opened); a SYMLINK is removed, never followed; sign-out removes it", () => {
  const r = root();
  home.isolatedEnv({}, r);
  assert.equal(home.hasAuth(r), false);
  const operator = join(root(), "auth.json");
  writeFileSync(operator, "{}");
  symlinkSync(operator, home.authFile(r));
  assert.equal(home.hasAuth(r), false);
  assert.equal((() => { try { lstatSync(home.authFile(r)); return true; } catch (_) { return false; } })(), false);
  assert.equal(existsSync(operator), true, "the operator's own file is untouched");
  const login = home.loginEnv({}, r);
  writeFileSync(login.authFile, "{}");
  home.installAuth(login.authFile, r);
  assert.equal(home.hasAuth(r), true);
  assert.equal(statSync(home.authFile(r)).mode & 0o777, 0o600);
  home.removeAuth(r);
  assert.equal(home.hasAuth(r), false);
});

test("the login home is fresh and separate, with Dopl's config files and the same fences", () => {
  const r = root();
  const a = home.loginEnv({ HOME: "/Users/operator" }, r);
  assert.notEqual(a.home, home.privateHome(r));
  assert.equal(a.env.HOME, a.home);
  assert.equal(a.env.GROK_AUTH_PATH, a.authFile);
  assert.equal(a.authFile, join(a.home, ".grok", "auth.json"));
  assert.ok(existsSync(join(a.home, ".grok", "requirements.toml")));
  assert.equal(a.env.GROK_DISABLE_AUTOUPDATER, "1");
});
