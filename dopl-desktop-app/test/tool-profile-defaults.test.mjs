// WHAT A PROFILE RESOLVES TO, AND WHAT FLOOR APPLIES UNDER ALL OF THEM (C-10 / C-11).
//
// §2 SPLIT (2026-08-08). `tool-profiles.test.mjs` is about what each profile GRANTS — the
// per-profile allow lists, the four containment layers, the drift alarm against the MCP
// server's real registration sites. These two questions are a different subject and they
// pushed that file past the 500-line cap:
//   C-11  what does an UNRECOGNIZED profile mean? It used to mean `full`, i.e. the widest
//         scope, chosen by nobody — while `session-park.knownProfile` answered the same
//         question with `read_only` one file over. Two deliberate, opposite answers.
//   C-10  which denies apply to EVERY profile, `full` included? The SDK lane
//         (`session-profiles.SESSION_HARD_DENY`) has always hard-denied the retired and
//         admin dopl tools under `full`; this lane short-circuited `full` to `[]`.
//         F-177 (2026-08-08) finished it: SESSION_HARD_DENY *is* UNIVERSAL_HARD_DENY now, so
//         the two lanes give one answer for `full` instead of agreeing on a floor and
//         differing above it. The bottom two tests pin the equality.
//
// THE FRAMING THAT BOUNDS BOTH, and the reason this file asserts as much POSITIVELY as it
// refuses: `full` granting the operator's real tools — their global MCP servers, Slack,
// Gmail, Supabase, every connector — is the PRODUCT. A teammate's request reaching your
// agent's actual tools is the value proposition, not a privilege hole. Nothing here narrows
// it: no positive `--tools` bound, no allow list, no scoped settings file, and specifically
// no `--strict-mcp-config` on the `full` path. What changes is only the deny FLOOR (retired
// tools that no longer exist, and workspace admins a channel session must never reach) and
// what an UNRESOLVABLE value falls back to.
//
// Run: `node --test dopl-desktop-app/test/tool-profile-defaults.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "tool-profiles.js"), "utf8");

const from = SRC.indexOf("// ─── BEGIN TOOL-PROFILE TABLE");
const to = SRC.indexOf("// ─── END TOOL-PROFILE TABLE");
assert.ok(from !== -1 && to > from, "tool-profile sentinels missing or out of order");
const BLOCK = SRC.slice(from, to);

const {
  buildAllowedTools, buildDeniedTools, buildBuiltinTools, buildRestrictionArgs,
  DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS,
} = new Function(
  `${BLOCK}
   return { buildAllowedTools, buildDeniedTools, buildBuiltinTools, buildRestrictionArgs,
            DOPL_ADMIN_TOOLS, RETIRED_DOPL_TOOLS };`
)();

const RESTRICTED = ["read_only", "dopl_only"];

// ── full: unchanged v1.1 behavior ────────────────────────────────────────────

// C-10 (2026-08-08) — `full` IS UNRESTRICTED, PLUS ONE UNIVERSAL DENY FLOOR.
//
// This test used to read "no lists, no flags at all", and that was the gap: the SDK lane
// (`session-profiles.SESSION_HARD_DENY`) has always hard-denied the retired and admin dopl
// tools even under `full`, while this lane short-circuited to `[]` and applied nothing. Two
// lanes, one profile name, two answers — and the retirement test below was scoped to
// RESTRICTED, which is why nothing caught it.
//
// WHAT MUST NOT CHANGE, and is asserted positively here: `full` granting the operator's real
// tools — their global MCP servers included — is the PRODUCT. No positive bound, no allow
// list, no scoped settings, and specifically no `--strict-mcp-config`.
test("full -> unrestricted, except the universal retired/admin deny floor", () => {
  assert.deepEqual(buildAllowedTools("full"), [], "no --allowedTools bound");
  assert.deepEqual(buildBuiltinTools("full"), [], "no --tools bound: every built-in stays offered");
  assert.deepEqual(buildDeniedTools("full").sort(),
    [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS].sort(),
    "the floor, and NOTHING else — no work tools, no web, no escape built-ins");
  const args = buildRestrictionArgs("full", "/tmp/settings.json");
  assert.deepEqual(args, ["--disallowedTools", [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS].join(",")]);
});

test("full keeps the operator's own MCP servers — the flag that would take them is NOT set", () => {
  // The whole value proposition: a teammate's request reaches the agent's REAL tools.
  const args = buildRestrictionArgs("full", "/tmp/settings.json");
  assert.ok(!args.includes("--strict-mcp-config"), "full must never be fenced to the Dopl server");
  assert.ok(!args.includes("--tools"), "and never bounded to a built-in subset");
  assert.ok(!args.includes("--settings"), "and never given a scoped permissions file");
  // The restricted profiles still get all four layers, unchanged.
  for (const p of RESTRICTED) {
    const a = buildRestrictionArgs(p, "/tmp/s.json");
    for (const flag of ["--tools", "--allowedTools", "--disallowedTools", "--settings", "--strict-mcp-config"]) {
      assert.ok(a.includes(flag), `${p} must still carry ${flag}`);
    }
  }
});

// C-11 (2026-08-08) — AN UNKNOWN PROFILE FAILS CLOSED, AND SAYS SO.
//
// It used to resolve to `full`. `myAgentToolProfile` is `null` for a non-member read, for an
// unrefreshed DTO and for any out-of-enum column value, so a profile that could not be
// resolved silently BECAME the widest one with nothing logged — while `session-park`'s
// `knownProfile` answered the same question with `read_only` one file over. The distinction:
// a user CHOOSING maximum access is fine; an unknown value BECOMING it is not.
test("unknown / absent profile fails CLOSED to read_only", () => {
  const readOnlyArgs = buildRestrictionArgs("read_only", "/tmp/s.json");
  for (const p of [undefined, null, "garbage", "", "FULL", "admin"]) {
    assert.deepEqual(buildAllowedTools(p), buildAllowedTools("read_only"), `allow for ${String(p)}`);
    assert.deepEqual(buildRestrictionArgs(p, "/tmp/s.json"), readOnlyArgs, `args for ${String(p)}`);
  }
});

test("an EXPLICIT 'full' is untouched — the DB column default still means what it says", () => {
  // The change is only about the unresolvable case. A normal membership row carries 'full'
  // and must behave exactly as it always did.
  assert.deepEqual(buildAllowedTools("full"), []);
  assert.deepEqual(buildBuiltinTools("full"), []);
  assert.ok(!buildRestrictionArgs("full", "/tmp/s.json").includes("--strict-mcp-config"));
});

test("the fail-closed coercion is REPORTED, so an evaporated setting has a signal", () => {
  // The operator whose explicit read_only silently became full had nothing to look at. The
  // reporter is injected (wired to diag outside the extracted block) so this file can drive it.
  const seen = [];
  const { normalizeProfile, onUnknownProfile } = new Function(
    `${BLOCK}\n return { normalizeProfile, onUnknownProfile };`
  )();
  onUnknownProfile((v) => seen.push(v));
  assert.equal(normalizeProfile("garbage"), "read_only");
  assert.equal(normalizeProfile(null), "read_only");
  assert.deepEqual(seen, ["garbage", null]);
  seen.length = 0;
  for (const p of ["read_only", "dopl_only", "full"]) assert.equal(normalizeProfile(p), p);
  assert.deepEqual(seen, [], "a recognized profile is never reported as unknown");
});

// ── THE TWO LANES, COMPARED DIRECTLY ────────────────────────────────────────────────

// F-177 (2026-08-08) — THE GAP IS CLOSED, AND THESE TWO TESTS NOW PIN THAT INSTEAD.
//
// C-10 left the lanes agreeing on the FLOOR while `session-profiles.SESSION_HARD_DENY` stayed
// broader — it also hard-denied the delegation / outbound / persistence / escalation BUILT-INS
// under `full`. The test below used to assert that residual as DELIBERATE. Samuel reversed the
// decision: a `full` channel session should be able to use those built-ins, so `full` now means
// the same thing in both lanes and the assertions are inverted rather than deleted.
//
// WHY THE OLD SPLIT WAS NEVER A BOUNDARY: `Bash` was live-gated under `full` in the SDK lane the
// whole time, and anyone with Bash has `curl`. What supervises `full` is the operator's
// PERMISSION PRESET, not the tool table — every released name is absent from AUTO_TOOLS and
// BYPASS_TOOLS, so each still stops on a button in every mode.
test("the two lanes give the SAME answer for `full` — not merely the same floor", () => {
  // A source pin, because the two lanes are two files: SESSION_HARD_DENY must BE this floor,
  // not merely contain it. (The old pin was a regex on `.concat(DOPL_ADMIN_TOOLS,
  // RETIRED_DOPL_TOOLS)` — which still matches, one profile over, on a line that has nothing to
  // do with `full`. That is a pin that survives the change it was guarding: exactly F-108.)
  const session = require(join(HERE, "..", "main", "session-profiles.js"));
  assert.deepEqual(
    session.buildSessionToolConfig("full").disallowedTools.slice().sort(),
    buildDeniedTools("full").slice().sort(),
    "SDK `full` and headless `full` must hard-deny exactly the same names"
  );
  for (const t of [...DOPL_ADMIN_TOOLS, ...RETIRED_DOPL_TOOLS]) {
    assert.ok(buildDeniedTools("full").includes(t), `the headless lane must deny ${t} under full too`);
  }
});

test("neither lane hard-denies the delegation / outbound / persistence built-ins under full", () => {
  const session = require(join(HERE, "..", "main", "session-profiles.js"));
  const headless = buildDeniedTools("full");
  const sdk = session.buildSessionToolConfig("full").disallowedTools;
  for (const t of ["Task", "Agent", "Artifact", "SendMessage", "CronCreate", "Skill", "EnterWorktree", "ToolSearch"]) {
    assert.ok(!headless.includes(t), `${t} must not be on the headless full-profile floor`);
    assert.ok(!sdk.includes(t), `${t} must not be hard-denied by the SDK lane under full either`);
    // …and it GATES rather than running silently: the preset is the control, not the table.
    for (const toolMode of ["manual", "auto", "bypass"]) {
      assert.equal(session.grantDecision({ profile: "full", toolName: t, toolMode }), "gate", `${t} @ ${toolMode}`);
    }
  }
  // …while the restricted profiles deny them, as they always did — in BOTH lanes.
  for (const p of RESTRICTED) {
    for (const t of ["Task", "Agent", "Artifact", "SendMessage"]) {
      assert.ok(buildDeniedTools(p).includes(t), `${p} must still deny ${t}`);
      assert.equal(session.grantDecision({ profile: p, toolName: t, toolMode: "bypass" }), "deny", `${p}/${t}`);
    }
  }
});
