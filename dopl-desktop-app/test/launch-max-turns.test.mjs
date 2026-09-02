// THE LOOP BRAKE — `maxTurns` on every spawn (2026-09-02, MCP/architecture v2 slice A10, G19).
//
// ⚠ WHAT WAS BROKEN. "Respond and loop until the goal is met, then STOP" was in every turn
// framing this app writes and was enforced by NOTHING: the SDK exposes `maxTurns` and this
// runtime set it nowhere, so a query that stopped producing `result` events had no ceiling at
// all. Dopl's own cap (`main/session-state.js › DEFAULT_TURN_CAP`) is counted by the REDUCER at
// each `result`, which is exactly the event such a session never reaches.
//
// ⚠ THE PROPERTY IS "ON EVERY SPAWN SHAPE", not "on a launch". A fresh launch, a parked resume,
// a recreated shell and the post-sign-in relaunch ALL re-enter `buildOptions`, so proving it
// there proves it for all four — and a bound a park could shed would not be one.
//
// METHOD is the directory idiom and the harness is `session-model.test.mjs`'s: slice the REAL
// `buildOptions` and drive it with fakes, injecting the module-scope references it reads. The
// VALUE is read out of the shipped source rather than restated, so this file cannot drift from
// the constant that ships (`sdk-mcp-token.test.mjs` does the same for mcp-config's timeout).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const SPEC = M("runtime/claude/launch-spec.js");
const STATE = M("session-state.js");

const shipped = (src, name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(src);
  assert.ok(m, `${name} is no longer declared where this test reads it`);
  return Number(m[1]);
};

const SESSION_MAX_TURNS = shipped(SPEC, "SESSION_MAX_TURNS");
const DEFAULT_TURN_CAP = shipped(STATE, "DEFAULT_TURN_CAP");

function assembled(s) {
  const src = `${fnOf(SPEC, "buildOptions")}\n return buildOptions;`;
  return new Function(
    "tools", "channelDirs", "loader", "sessionAuth", "sessionOutbound", "axisB", "diag",
    "store", "sessionModel", "sessionCredential", "agentOps", "SESSION_MAX_TURNS", src
  )(
    { buildSessionToolConfig: () => ({ preApproved: [], disallowedTools: [], doplToolsPolicy: "full", builtinTools: [] }) },
    { sessionSpawnDir: () => "/tmp" },
    {
      buildSecretPathDenyRules: () => [],
      buildMcpServers: () => ({}),
      buildScrubbedEnv: () => ({}),
      withSessionStamp: () => {},
      resolveClaudeExecutable: () => null,
    },
    { withStoredCredential: (e) => e },
    { wrapGate: () => () => {} },
    { makeCanUseTool: () => () => {}, makeAgentOpsServer: () => null },
    () => {},
    { slotKey: () => "c1:t1" },
    require("../main/session-model.js"),
    { sessionBearer: () => "" },
    { AGENT_OPS_TOOL_NAMES: [], SERVER_KEY: "dopl_agents" },
    SESSION_MAX_TURNS
  )(s);
}

const session = (over) => ({ profile: "full", channelId: "c1", workspaceId: "w1", taskId: "t1", ...over });

test("a FRESH launch carries the brake", () => {
  assert.equal(assembled(session({})).maxTurns, SESSION_MAX_TURNS);
});

test("a RESUME carries it too — one assembly point, so park/resume cannot shed it", () => {
  const opts = assembled(session({ resumeSdkId: "sdk-1" }));
  assert.equal(opts.maxTurns, SESSION_MAX_TURNS);
  assert.equal(opts.resume, "sdk-1", "and the resume is still the only field that differs");
});

test("EVERY PROFILE gets the same number — a tool profile is not a turn budget", () => {
  // ⚠ THE ARGUMENT, RESTATED AS A TEST. A profile bounds what a session may DO; a per-profile
  // ceiling would be a permission axis wearing a budget's clothes, and a `read_only` session
  // that hit a lower one would end with a message about turns for a reason that was about tools.
  for (const profile of ["read_only", "dopl_only", "full"]) {
    assert.equal(assembled(session({ profile })).maxTurns, SESSION_MAX_TURNS, profile);
  }
});

test("it is a RUNAWAY BACKSTOP: far above the cap the reducer actually enforces", () => {
  // ⚠ THE ORDERING IS THE WHOLE DESIGN. `session-reducer.js` ends a session with `turn_cap` at
  // DEFAULT_TURN_CAP and tells the operator so; that stays the real, visible limit and fires
  // first. This one exists only for the case the reducer cannot see — a query that never reaches
  // another `result` event — and the SDK's answer when it fires is `error_max_turns`, a DEAD
  // session rather than a paused one. A value near the reducer's cap would start killing long
  // sessions for a bound nobody asked for.
  assert.ok(
    SESSION_MAX_TURNS > DEFAULT_TURN_CAP * 10,
    `SESSION_MAX_TURNS (${SESSION_MAX_TURNS}) must stay well above DEFAULT_TURN_CAP (${DEFAULT_TURN_CAP})`
  );
});

test("the module exports the constant, so nothing has to re-read the source to know it", () => {
  // ⚠ SOURCE-READ HERE ONLY BECAUSE REQUIRING THE MODULE PULLS IN ELECTRON. The export exists so
  // a future reader (a settings surface, a diag line) has one place to ask.
  assert.match(SPEC, /module\.exports = \{[^}]*SESSION_MAX_TURNS/);
});
