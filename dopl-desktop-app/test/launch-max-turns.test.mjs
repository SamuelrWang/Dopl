// THE LOOP BRAKE — `maxTurns` on every spawn (2026-09-02, MCP/architecture v2 slice A10, G19).
//
// 🔒 **THIS FILE OUTLIVED ITS SIBLINGS ON PURPOSE, AND HERE IS WHY** (2026-09-07). Samuel ruled
// the operator-facing turn and cost caps DELETED, and `turn-cap-issuer.test.mjs` went with them —
// a repaired pin on a deleted feature is fake coverage. This one stays because the brake it pins
// is NOT that cap: it is the SDK runaway backstop, the only bound left in this app, and the only
// thing that now stops a looping agent at all. Deleting it alongside its siblings would be the
// NaN trap with a one-refactor delay — the brake would sit unpinned until somebody tidied it away
// and nothing failed. If you are here to remove a cap test, this is not one.
//
// ⚠ WHAT WAS BROKEN. "Respond and loop until the goal is met, then STOP" was in every turn
// framing this app writes and was enforced by NOTHING: the SDK exposes `maxTurns` and this
// runtime set it nowhere, so a query that stopped producing `result` events had no ceiling at
// all. Dopl's own cap was counted by the REDUCER at each `result`, which is exactly the event
// such a session never reaches — and that cap is now gone, so this bound no longer has anything
// firing ahead of it.
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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fnOf } from "./helpers/source-probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");

const SPEC = M("runtime/claude/launch-spec.js");

// ⚠ THE SOURCE ASSERTIONS BELOW READ **CODE**, NOT PROSE (2026-09-07). This file's own tombstones
// name `OPERATOR_TURN_CAP` and `DEFAULT_TURN_CAP` — that is the record of why the brake is a
// literal again, and it belongs in `launch-spec.js`'s header. A raw-source `doesNotMatch` cannot
// tell a citation from a reference and failed on the comment that explains the very deletion it
// is checking for, which would have been "fixed" by deleting the explanation. So the comments come
// off first and the assertion keeps its full strength over everything that executes.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
  .join("\n");
const SPEC_CODE = stripComments(SPEC);

const shipped = (src, name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(src);
  assert.ok(m, `${name} is no longer declared where this test reads it`);
  return Number(m[1]);
};

// ⚠ READ OUT OF THE SHIPPED SOURCE, STILL — the rule survives the deletion even though the value
// is a literal again. It was `MAX_TURNS_FACTOR * OPERATOR_TURN_CAP` and is now `8000`, because
// `OPERATOR_TURN_CAP` no longer exists: left derived, the brake would have evaluated to `NaN`,
// and `maxTurns: NaN` is no bound at all. Reading it here rather than restating it is what keeps
// this file honest about whatever ships.
const SESSION_MAX_TURNS = shipped(SPEC, "SESSION_MAX_TURNS");

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
      // ⚠ A3's `X-Dopl-Tool-Profile` stamp (2026-09-02), stubbed: this suite is
      // about the turn brake. `session-tool-profile.test.mjs` owns the header.
      withToolProfileStamp: () => {},
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

test("it is a RUNAWAY BACKSTOP and not a ceiling — nothing fires ahead of it now", () => {
  // ⚠ THE ORDERING USED TO BE THE WHOLE DESIGN, AND THE ORDER IS NOW A LIST OF ONE. The reducer
  // ended a session at the Dopl cap and told the operator so; that was the real, visible limit
  // and it fired first. It is deleted (2026-09-07), so this bound is no longer the second line of
  // defence — it is the only one, and the SDK's answer when it fires is `error_max_turns`, a DEAD
  // session rather than a paused one.
  // ⚠ WHICH IS WHY THE FLOOR MATTERS MORE THAN IT USED TO. A value low enough to be reached in
  // ordinary work would now kill long sessions with nothing having warned them, and the deletion
  // was RULED precisely to stop marathon workers being killed by a ceiling. 8000 is what the old
  // derivation evaluated to (40 × the retired 200-turn default), kept rather than re-picked.
  assert.ok(
    SESSION_MAX_TURNS >= 2000,
    `SESSION_MAX_TURNS (${SESSION_MAX_TURNS}) is low enough to fire in ordinary work`
  );
  // ⚠ A LITERAL, AND THE TEST SAYS SO OUT LOUD. It was derived, and the derivation's factor was
  // deleted with the caps — so this asserts the shape that ships rather than the one that used
  // to. If somebody re-derives it from a constant that no longer exists, this fails instead of
  // the app silently launching with `maxTurns: NaN`.
  assert.match(
    SPEC_CODE, /const SESSION_MAX_TURNS = \d+;/,
    "the brake must be a self-contained literal — see this file's header"
  );
  assert.doesNotMatch(
    SPEC_CODE, /OPERATOR_TURN_CAP|DEFAULT_TURN_CAP/,
    "the brake must not reference a deleted cap constant"
  );
});

test("ONE ASSEMBLY POINT: nothing else in main/ sets a maxTurns", () => {
  // ⚠ **THIS USED TO ASSERT THE EXPORT LINE WITH A REGEX** and that was a test of a line of
  // SOURCE, not of a behaviour — the export has no consumer in `main/`, so it could be deleted
  // and nothing would break except the case pinning it. What the header actually CLAIMS is that
  // `buildOptions` is the one assembly point, which is what makes "a park cannot shed the brake"
  // true, and nothing checked it.
  //
  // ⚠ A SECOND PRODUCER IS THE REGRESSION, and it is silent: a resume path or a recreated shell
  // assembling its own options with a different ceiling would pass every case above (they all
  // drive `buildOptions`) while shipping a session with no brake, or with somebody else's.
  const producers = [];
  for (const file of readdirSync(join(HERE, "..", "main", "runtime", "claude"))) {
    if (!file.endsWith(".js")) continue;
    const src = M(join("runtime", "claude", file));
    // Comments discuss the field; only an object KEY assembles it.
    for (const line of src.split("\n")) {
      if (line.trimStart().startsWith("//")) continue;
      if (/\bmaxTurns\s*:/.test(line)) producers.push(`${file}: ${line.trim()}`);
    }
  }
  // ⚠ **ONE ENTRY SINCE 2026-09-02 (ruling B6).** There were two: `triage.js` assembled a
  // `maxTurns: 1` for the wake ROUTER, a second kind of query with a bound of its own. The triage
  // tier is deleted, so the session launch is once again the only thing on this platform that
  // sets a turn brake — and a SECOND producer appearing here is a decision somebody makes here.
  assert.deepEqual(
    producers,
    ["launch-spec.js: maxTurns: SESSION_MAX_TURNS,"],
    "a new maxTurns producer, or the session one stopped naming the constant"
  );
});
