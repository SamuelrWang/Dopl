// CXP-3A — THE THREAD-CONFIG FENCES EVERY CODEX LAUNCH CARRIES (2026-09-22).
//
// Split from `codex-gate.test.mjs` for the 500-line cap. The measurements behind each fence are in
// the live tier: `codex-mcp-discovery.test.mjs` (the `features` fence — `codex_apps` and the
// multi-agent tools off the discovery surface) and `codex-project-trust.test.mjs` (the
// `projects` fence — no auto-trust of the agent's folder, no project `.codex/config.toml`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CODEX = join(HERE, "..", "main", "runtime", "codex");
const launchSpec = require(join(CODEX, "launch-spec.js"));
const configHome = require(join(CODEX, "config-home.js"));

const specFor = (profile, containerToken) => launchSpec.buildLaunchSpec({
  session: { profile, channelId: null, state: {}, workspaceId: "ws-1", model: "", containerToken },
  dispatch: () => {}, emitQuiet: () => {},
});

test("every launch carries the `features` fence — apps off always, delegation off when restricted", () => {
  for (const profile of ["read_only", "dopl_only"]) {
    const f = specFor(profile, { token: "t" }).threadStart.config.features;
    assert.deepEqual(f, { apps: false, plugins: false, multi_agent: false }, profile);
  }
  for (const profile of ["channel_agent", "full"]) {
    const f = specFor(profile, { token: "t" }).threadStart.config.features;
    assert.deepEqual(f, { apps: false, plugins: false }, profile);
  }
  // ⚠ NO TOKEN, NO DOPL ENTRY — AND STILL THE FENCE: `codex_apps` mounts from the operator's auth.
  const bare = specFor("read_only", null).threadStart.config;
  assert.equal(bare.mcp_servers, undefined);
  assert.equal(bare.features.apps, false);
});

test("every launch carries the project-trust fence for its own cwd", () => {
  for (const profile of ["read_only", "dopl_only", "channel_agent", "full"]) {
    const spec = specFor(profile, { token: "t" });
    assert.deepEqual(spec.threadStart.config.projects, configHome.projectTrustFence(spec.cwd), profile);
    assert.equal(spec.threadStart.config.projects[spec.cwd].trust_level, "untrusted", profile);
  }
});
