// FIX F3b — THE PROMPT MAY NOT ORDER A TOOL THE PROFILE DENIES (2026-08-04).
//
// THE DEFECT. `prompt-framing.firstActions` opened every session turn with
// "Your FIRST action is ToolSearch("select:mcp__dopl__dopl_channel")" — and `ToolSearch` sits
// in `tool-profiles.DENIED_BUILTINS` under "capability escalation", which
// `session-profiles.buildSessionToolConfig` hard-denies on ALL THREE profiles (read_only and
// dopl_only take DENIED_BUILTINS directly; `full` takes SESSION_HARD_DENY, which is
// DENIED_BUILTINS minus the live-gated work tools, and ToolSearch is not one of those). So
// `grantDecision` answered 'deny' before any button could appear and the FIRST imperative of
// every session was a call that comes back "Blocked for this session". No comment anywhere
// reconciled the two, because nothing read both.
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
// SCOPE, deliberately narrow: `prompt-framing.js` only. `attended-prompt.js` carries the SAME
// ToolSearch order and MUST keep it — that prompt runs in the operator's own Claude Code,
// which this containment table does not bound. The last test pins that asymmetry so a later
// reader does not "fix" the healthy copy by symmetry with this one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const load = (rel) => require(fileURLToPath(new URL(rel, import.meta.url)));

const { buildFencedTurn } = load("../main/prompt-framing.js");
const { buildSessionToolConfig } = load("../main/session-profiles.js");
const { DENIED_BUILTINS } = load("../main/tool-profiles.js");
const attended = load("../main/attended-prompt.js");

const PROFILES = ["read_only", "dopl_only", "full"];

const CH = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";

/** Every shape of turn this module can build, so no branch escapes the scan. */
function everyTurn() {
  const turns = [];
  const contexts = [
    { channelName: "Ops" },
    { channelName: "Ops", channelId: CH, workspaceId: WS },
    { channelName: "Ops", channelId: CH, workspaceId: WS, taskId: TASK },
  ];
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

test("ToolSearch is denied on every session profile (the fact the prompt has to respect)", () => {
  // Stated first and on its own, so a later change that GRANTS ToolSearch fails HERE — where
  // the reason is written down — rather than silently making the scan below vacuous.
  assert.ok(DENIED_BUILTINS.includes("ToolSearch"), "ToolSearch left the shared blacklist");
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    assert.ok(
      cfg.disallowedTools.includes("ToolSearch"),
      `${profile}: ToolSearch is no longer hard-denied — re-read prompt-framing.firstActions`
    );
  }
});

test("no built session turn ORDERS a tool the profile hard-denies", () => {
  for (const profile of PROFILES) {
    const denied = buildSessionToolConfig(profile).disallowedTools;
    for (const { label, text } of everyTurn()) {
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
  for (const { label, text } of everyTurn()) {
    assert.ok(!/ToolSearch/.test(text), `${label}: ToolSearch is back in a session turn`);
  }
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

// ── the asymmetry, pinned so nobody "fixes" the healthy copy ───────────────────

test("attended-prompt KEEPS its ToolSearch order — it is not bound by this table", () => {
  // `buildAttendedPrompt` runs in the OPERATOR'S OWN Claude Code, which the session profiles do
  // not contain, and there the deferred-schema lookup is both available and necessary. If this
  // ever fails because the order was removed by symmetry with the fix above, that is a
  // regression of F3 on the one surface where F3 was right.
  const args = { channelId: CH, workspaceId: WS, threadId: TASK };
  for (const [name, build] of [
    ["buildAttendedPrompt", attended.buildAttendedPrompt],
    ["buildAttendedPromptCompact", attended.buildAttendedPromptCompact],
  ]) {
    const built = build(args);
    assert.ok(built, `${name} built nothing for a complete id triple`);
    assert.ok(/ToolSearch\(/.test(built), `${name} lost its ToolSearch order`);
  }
});
