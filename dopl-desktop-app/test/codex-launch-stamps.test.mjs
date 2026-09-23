// Two things the BUILT Codex launch spec must carry (`launch-spec.js › buildLaunchSpec`):
//
// CX-03 (security)  the Dopl bearer rides the app-server's env, and Codex builds every shell
//   command's env from its own. The thread pins `shell_environment_policy.exclude` over the whole
//   `DOPL_MCP_*` set. Measured on codex-cli 0.155.1 with NO model turn (`thread/shellCommand`
//   `env | grep DOPL_`): no policy → every var visible, including `*TOKEN*` names (the default
//   KEY/TOKEN/SECRET exclude is OFF by default); `exclude: ['DOPL_MCP_*']` → none of them.
// CX-12 (parity)    the Dopl entry carries `X-Dopl-Tool-Profile`, the same header and the same
//   normalized value Claude stamps, so the server offers each profile the same surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");
const launchSpec = require(join(MAIN, "runtime", "codex", "launch-spec.js"));
const mcp = require(join(MAIN, "runtime", "codex", "mcp.js"));
const { normalizeProfile } = require(join(MAIN, "tool-profiles.js"));

const PROFILES = ["read_only", "dopl_only", "channel_agent", "full"];
const specFor = (profile) => launchSpec.buildLaunchSpec({
  session: { profile, channelId: null, state: {}, workspaceId: "ws-1", model: "", containerToken: { token: "tok-SECRET" } },
  dispatch: () => {}, emitQuiet: () => {},
});

/** Codex's `exclude` entries are case-insensitive globs over the variable NAME. */
const globRe = (glob) => new RegExp(`^${glob.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
const excluded = (policy, name) => (policy.exclude || []).some((g) => globRe(g).test(name));

test("CX-03: every launch hides the Dopl bearer (and its pins) from shell commands", () => {
  for (const profile of PROFILES) {
    const spec = specFor(profile);
    const policy = spec.threadStart.config.shell_environment_policy;
    assert.ok(policy && Array.isArray(policy.exclude), profile);
    // The value is really in the child env, under the name the entry reads…
    assert.equal(spec.env[mcp.BEARER_ENV], "tok-SECRET", profile);
    assert.equal(spec.threadStart.config.mcp_servers.dopl.bearer_token_env_var, mcp.BEARER_ENV);
    // …and every env var carrying a secret or a pin is excluded from command shells.
    const secretNames = Object.keys(spec.env).filter((k) => spec.env[k] === "tok-SECRET");
    assert.deepEqual(secretNames, [mcp.BEARER_ENV], "the bearer rides ONE variable");
    for (const name of [mcp.BEARER_ENV, mcp.WORKSPACE_ENV, mcp.SESSION_ENV]) {
      assert.ok(excluded(policy, name), `${profile}: ${name} reaches command shells`);
    }
    assert.ok(!excluded(policy, "PATH") && !excluded(policy, "HOME"), "the exclude is narrow");
    assert.equal(policy.inherit, undefined, "the operator's environment otherwise rides as before");
  }
  // Belt: a name Codex's own `*TOKEN*` default exclude also matches wherever that exclude is on.
  assert.match(mcp.BEARER_ENV, /TOKEN/);
  // A fresh object per launch — one session cannot widen the next one's fence.
  specFor("full").threadStart.config.shell_environment_policy.exclude.length = 0;
  assert.ok(specFor("full").threadStart.config.shell_environment_policy.exclude.length > 0);
});

test("CX-12: the Codex Dopl entry is stamped X-Dopl-Tool-Profile exactly as Claude's is", () => {
  const loader = readFileSync(join(MAIN, "runtime", "claude", "loader.js"), "utf8");
  const claudeHeader = /const TOOL_PROFILE_HEADER = '([^']+)';/.exec(loader);
  assert.ok(claudeHeader, "loader.js › TOOL_PROFILE_HEADER moved — re-pin this parity");
  assert.equal(mcp.TOOL_PROFILE_HEADER, claudeHeader[1], "one header name on both runtimes");
  const serverSrc = readFileSync(join(MAIN, "..", "..", "src", "shared", "auth", "tool-profile-header.ts"), "utf8");
  const server = /TOOL_PROFILE_HEADER = "([^"]+)";/.exec(serverSrc);
  assert.equal(mcp.TOOL_PROFILE_HEADER.toLowerCase(), server[1], "and the one the server reads");
  for (const profile of PROFILES) {
    const headers = specFor(profile).threadStart.config.mcp_servers.dopl.http_headers;
    assert.equal(headers[mcp.TOOL_PROFILE_HEADER], normalizeProfile(profile), profile);
    assert.equal(headers["X-Dopl-Runtime"], "desktop-session", "the custody header is untouched");
  }
  // An unknown profile narrows (the same fail-closed read the deny list uses), never widens.
  const odd = specFor("wide_open").threadStart.config.mcp_servers.dopl.http_headers;
  assert.equal(odd[mcp.TOOL_PROFILE_HEADER], "read_only");
});
