// FIX F3b — THE PROMPT MAY NOT ORDER A TOOL THE PROFILE DENIES (2026-08-04).
//
// THE DEFECT. `prompt-framing.firstActions` opened every session turn with
// "Your FIRST action is ToolSearch("select:mcp__dopl__dopl_channel")" — and `ToolSearch` sits
// in `tool-profiles.DENIED_BUILTINS` under "capability escalation", which
// `session-profiles.buildSessionToolConfig` hard-denied on ALL THREE profiles. So
// `grantDecision` answered 'deny' before any button could appear and the FIRST imperative of
// every session was a call that comes back "Blocked for this session". No comment anywhere
// reconciled the two, because nothing read both. (F-177, 2026-08-08: `full` gates it now
// rather than denying it — the join below is unchanged and reads the REAL lists, so it simply
// tracks the move.)
//
// WHY IT IS ITS OWN SUITE. This is the same drift class as the whole 2026-08-04 incident: two
// parallel declarations of one fact (what a session may do), each internally coherent, neither
// reading the other. prompt-framing.test.mjs pins what the prompt SAYS; session-profiles /
// sdk-grant pin what a session MAY DO. Nothing joined them, so the prompt could order anything.
// This file is that join, and it reads the REAL deny lists via `require` rather than restating
// them — a copy would drift exactly like the thing it is guarding.
//
// WHAT IT DOES NOT CLAIM. It is not a ban on NAMING a denied tool: the prompt legitimately
// talks about the `task_*` kinds it refuses, and one day may name a tool to say "do not use
// it". It bans the CALL SHAPE — `Name(` — which is what an agent reads as an instruction to
// invoke, and which is precisely what shipped.
//
// SCOPE, deliberately narrow: `prompt-framing.js` only. (`attended-prompt.js` carried the SAME
// ToolSearch order and MUST keep it — that prompt runs in the operator's own Claude Code,
// which this containment table does not bound. The last test pins that asymmetry so a later
// reader does not "fix" the healthy copy by symmetry with this one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const load = (rel) => require(fileURLToPath(new URL(rel, import.meta.url)));

const { buildFencedTurn } = load("../main/prompt-framing.js");
const { buildSessionToolConfig } = load("../main/session-profiles.js");
const { DENIED_BUILTINS } = load("../main/tool-profiles.js");

const PROFILES = ["read_only", "dopl_only", "full"];

const CH = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";

// ⚠ A TEMPLATE-BUILT TURN IS ONE OF THE SHAPES (2026-08-22, agent templates). An AGENT TEMPLATE
// splices a ROLE BLOCK into the requester turn, and that block can NAME TOOLS — it teaches the
// KB calls for the bases a template attached. So a template turn has to be inside every scan in
// this file, or the one turn shape that can order a tool by data would be the one shape nobody
// checked. ⚠ THE PROFILE IS PART OF THE INPUT for that shape: `templateRoleFraming` gates the KB
// instruction on it, and `read_only` HARD-DENIES `mcp__dopl__dopl_kb`.
const TEMPLATE = {
  name: "Code Auditor",
  instructions: "Audit the diff. Cite file and line.",
  model: null,
  fields: [{ key: "repo", value: "acme/api" }],
  knowledgeBases: [{ id: "kb-1111", name: "Handbook" }],
  authoredByCaller: false,
};

/** Every shape of turn this module can build, so no branch escapes the scan. */
function everyTurn(profile = "full") {
  const turns = [];
  const contexts = [
    { channelName: "Ops" },
    { channelName: "Ops", channelId: CH, workspaceId: WS },
    { channelName: "Ops", channelId: CH, workspaceId: WS, taskId: TASK },
  ];
  for (const context of contexts) {
    turns.push({
      label: `template requester ${Object.keys(context).length} ids / ${profile}`,
      text: buildFencedTurn({
        side: "requester", message: "x", nonce: "n",
        context: { ...context, profile, template: TEMPLATE },
      }),
    });
  }
  for (const context of contexts) {
    for (const side of ["responder", "requester"]) {
      turns.push({
        label: `${side} ${Object.keys(context).length} ids`,
        text: buildFencedTurn({ side, message: "x", nonce: "n", context }),
      });
    }
    turns.push({
      label: `team ${Object.keys(context).length} ids`,
      text: buildFencedTurn({
        bind: "room",
        message: "x",
        nonce: "n",
        context: { ...context, agentName: "quartz", ownerName: "Sam", agentId: TASK },
      }),
    });
  }
  return turns;
}

/** A CALL of `name` in prompt text: the tool name followed by an open paren. */
function callsTool(text, name) {
  return new RegExp(`\\b${name}\\s*\\(`).test(text);
}

// ── the join ───────────────────────────────────────────────────────────────────

test("ToolSearch is denied on the RESTRICTED profiles, and merely GATED under full (F-177)", () => {
  // Stated first and on its own, so a change to either half fails HERE — where the reason is
  // written down — rather than silently making the scan below vacuous.
  //
  // F-177 (2026-08-08) MOVED the `full` half of this. `full` no longer hard-denies ToolSearch;
  // it gates it like every other released built-in. The rule the prompt has to respect is
  // UNCHANGED and is the scan below: a turn must never ORDER a call the session cannot make
  // freely. `gate` is not `deny`, but ordering it as a FIRST ACTION would still stall every
  // session on a card the operator has to clear before the agent has done anything.
  assert.ok(DENIED_BUILTINS.includes("ToolSearch"), "ToolSearch left the shared blacklist");
  for (const profile of ["read_only", "dopl_only"]) {
    const cfg = buildSessionToolConfig(profile);
    assert.ok(
      cfg.disallowedTools.includes("ToolSearch"),
      `${profile}: ToolSearch is no longer hard-denied — re-read prompt-framing.firstActions`
    );
  }
  assert.ok(!buildSessionToolConfig("full").disallowedTools.includes("ToolSearch"),
    "full still hard-denies ToolSearch — F-177 was reverted, so re-read sdk-loader's alwaysLoad note");
});

// F-177 — WHY THE `full` HALF IS SAFE TO RELEASE, pinned where it would otherwise be re-derived.
// Every MCP tool is deferred behind `ToolSearch` once tool search is on, and tool search is on by
// default in the bundled runtime. Denying ToolSearch is what USED to keep `mcp__dopl__dopl_channel`
// eagerly present on every profile — not `doplToolsPolicy`, which is a permission policy. Releasing
// it under `full` would have deferred the session's own delivery path, i.e. the F3 incident again,
// so the dopl MCP entry carries `alwaysLoad: true`. If that field goes, the prompt below starts
// naming a tool the model has only as a deferred stub.
test("the dopl MCP server is pinned alwaysLoad, so nothing the prompt names is deferred", () => {
  const loader = readFileSync(fileURLToPath(new URL("../main/sdk-loader.js", import.meta.url)), "utf8");
  assert.match(loader, /^\s*alwaysLoad: true,$/m, "sdk-loader's dopl entry lost alwaysLoad");
});

test("no built session turn ORDERS a tool the profile hard-denies", () => {
  for (const profile of PROFILES) {
    const denied = buildSessionToolConfig(profile).disallowedTools;
    for (const { label, text } of everyTurn(profile)) {
      for (const tool of denied) {
        assert.ok(
          !callsTool(text, tool),
          `${profile} / ${label}: the turn instructs a call to ${tool}, which this profile denies`
        );
      }
    }
  }
});

test("the specific regression: no session turn tells the agent to call ToolSearch", () => {
  // The scan above would catch this, but the named case is what a reader greps for.
  for (const profile of PROFILES) {
    for (const { label, text } of everyTurn(profile)) {
      assert.ok(!/ToolSearch/.test(text), `${label}: ToolSearch is back in a session turn`);
    }
  }
});

// ── ⚠ THE CONTAINMENT TEST FOR AGENT TEMPLATES (2026-08-22) ─────────────────────────────────
//
// ⚠ IT IS A NAME SCAN, NOT `callsTool`, AND THE DIFFERENCE IS THE WHOLE POINT. `callsTool` looks
// for `Name(` — the shape a BUILT-IN call takes. An MCP tool is never taught that way in this
// tree: the framing writes `mcp__dopl__dopl_channel with op "read"`, and the role block writes
// `mcp__dopl__dopl_kb, op "get_tree"`. So the loop above, run over the dopl family, would answer
// "no call ordered" about a turn that names a hard-denied tool in the only form an agent would
// ever act on. For the DOPL half the honest assertion is that the NAME does not appear at all.
//
// ⚠ WHAT IT CATCHES, CONCRETELY: `read_only` puts the whole of `DOPL_SAFE_TOOLS` into
// `disallowedTools`, `mcp__dopl__dopl_kb` among them, and a template's ATTACHED KNOWLEDGE section
// is the one part of a prompt built from OPERATOR DATA that would order it. The block gates on
// `kbReadable(profile)` and lists the base NAMES with no call under `read_only` — §11's
// UNKNOWN-is-not-EMPTY rule — and this is what fails if that gate is ever dropped.
test("a TEMPLATE-built turn names no dopl tool its profile hard-denies", () => {
  const doplDenied = (profile) =>
    buildSessionToolConfig(profile).disallowedTools.filter((t) => t.startsWith("mcp__dopl__"));
  for (const profile of PROFILES) {
    const denied = doplDenied(profile);
    assert.ok(denied.length > 0, `${profile}: the deny list carries no dopl name — re-read the table`);
    for (const { label, text } of everyTurn(profile)) {
      for (const tool of denied) {
        assert.ok(!text.includes(tool), `${label}: names ${tool}, which this profile hard-denies`);
      }
    }
  }
});

test("…and under a profile that CAN reach it, the template turn really does name the KB tool", () => {
  // ⚠ THE OTHER HALF, because a scan that only ever asserts an absence passes just as happily
  // against a block that emits nothing at all. Under `dopl_only` / `full` the KB read resolves
  // `allow` at the windowless floor (OQ-1), so ordering it is correct rather than merely allowed.
  for (const profile of ["dopl_only", "full"]) {
    const [{ text }] = everyTurn(profile);
    assert.ok(text.includes("mcp__dopl__dopl_kb"), `${profile}: the KB instruction went missing`);
  }
  const [{ text: readOnly }] = everyTurn("read_only");
  assert.ok(!readOnly.includes("mcp__dopl__dopl_kb"), "read_only must order no KB call");
  assert.ok(readOnly.includes("Handbook"), "read_only still NAMES the base — UNKNOWN is not EMPTY");
});

test("what F3 was really protecting survives: never report the channel tool missing", () => {
  // The lookup order is gone; the REPORTING rule is not. The 2026-08-01 failure was an agent
  // posting "CONFIRMED: I do not have the mcp__dopl__dopl_channel tool" through that very tool,
  // which is a reporting failure and would not have been fixed by any lookup.
  for (const { label, text } of everyTurn()) {
    const flat = text.replace(/\s+/g, " ");
    assert.ok(/GRANTED to this session/.test(flat), `${label}: the grant is not stated`);
    assert.ok(
      /[Nn]ever report\s+that you have no dopl channel tool/.test(flat),
      `${label}: the do-not-report-it-missing rule is gone`
    );
  }
});

// ⚠ THE ASYMMETRY TEST STOOD HERE AND WENT WITH ITS SUBJECT (2026-08-20, F-228).
// `attended-prompt.js` built the prefill for an ATTENDED HANDOFF — the operator opening the
// exchange in their OWN Claude Code — and it KEPT its `ToolSearch(` order deliberately, because
// that session is not bound by the session profiles this table is about. The handoff is
// deleted: its only entry point was `session-ipc.js`'s `session:attended-handoff` handler,
// resolved from a pre-consent card's window.
//
// ⚠ THE RULE THE TEST GUARDED IS STILL LIVE AND IS STILL ABOVE: F3 says a CONTAINED session's
// prompt may not order a tool the profile denies. What is gone is the counter-example, not the
// rule — and with it the risk of "fixing" the healthy copy by symmetry.
