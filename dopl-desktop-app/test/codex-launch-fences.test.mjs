// CXP-3A — THE THREAD-CONFIG FENCES EVERY CODEX LAUNCH CARRIES (2026-09-22).
//
// Split from `codex-gate.test.mjs` for the 500-line cap. The measurements behind each fence are in
// the live tier: `codex-mcp-discovery.test.mjs` (the `features` fence — `codex_apps` and the
// multi-agent tools off the discovery surface), `codex-project-trust.test.mjs` (the
// `projects` fence — no auto-trust of the agent's folder, no project `.codex/config.toml`) and
// `codex-persistence-fence-live.test.mjs` (goals, `clock.sleep`, memories, hooks, `notify`).

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
  dispatch: () => {},
});

// 🔒 THE WHOLE `features` VALUE, SPELLED ON THE WIRE — never by reading the constants back.
const WIRE_FEATURES = {
  apps: false, plugins: false, multi_agent: false,
  goals: false, sleep_tool: false, memories: false, hooks: false,
};

test("every launch carries the `features` fence — apps, delegation AND persistence off on EVERY profile", () => {
  // 🔒 2026-09-22: delegation off on all four, matching Claude's `Agent` removal on every profile;
  // persistence (C26) off on all four, matching Claude's `CronCreate`/`ScheduleWakeup` removal.
  for (const profile of ["read_only", "dopl_only", "channel_agent", "full"]) {
    const f = specFor(profile, { token: "t" }).threadStart.config.features;
    assert.deepEqual(f, WIRE_FEATURES, profile);
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

// 🔒 C26: `notify` is pinned EMPTY at thread level on every profile and every Axis-A mode, token or
// not — measured, a thread `[]` silences a lower layer's program (`codex-persistence-fence-live`).
test("every launch pins `notify` empty and carries the persistence flags, whatever the mode or token", () => {
  const modes = ["untrusted", "granular", "on-request", "never", "bogus"];
  for (const profile of ["read_only", "dopl_only", "channel_agent", "full"]) {
    for (const toolMode of modes) {
      for (const token of [{ token: "t" }, null]) {
        const spec = launchSpec.buildLaunchSpec({
          session: { profile, channelId: null, state: { toolMode }, workspaceId: "ws-1", model: "", containerToken: token },
          dispatch: () => {},
        });
        const c = spec.threadStart.config;
        assert.deepEqual(c.notify, [], `${profile}/${toolMode}`);
        for (const k of ["goals", "sleep_tool", "memories", "hooks"]) assert.equal(c.features[k], false, `${profile}/${toolMode}/${k}`);
        // Nothing persistence-shaped rides argv either: the one `-c` a session adds is the catalog.
        assert.deepEqual(spec.args, [], `${profile}/${toolMode}`);
      }
    }
  }
});

test("a launch's `notify` is a fresh array — no session can mutate the next one's fence", () => {
  const a = specFor("full", { token: "t" }).threadStart.config;
  a.notify.push("/bin/true");
  a.features.goals = true;
  const b = specFor("full", { token: "t" }).threadStart.config;
  assert.deepEqual(b.notify, []);
  assert.equal(b.features.goals, false);
});
