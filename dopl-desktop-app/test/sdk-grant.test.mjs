// Tests for the SESSION-mode per-call grant decision (main/session-profiles.js
// `grantDecision`, Track T1) — the pure function the engine's canUseTool bridge
// consults. SOURCE EXTRACTION with INJECTION (same block + real constants as
// session-profiles.test.mjs), focused here on the DECISION truth table and the
// load-bearing SHADOW INVARIANT: a pre-approved tool must resolve to 'preapproved'
// and can therefore NEVER reach the gate (§A.5 / research §3).
//
// SECURITY (adversarial review): grantDecision OP-SCOPES `dopl_channel` (FIX H1 — no
// blanket pre-approval) and reflects `full`'s HARD-DENY subset (FIX H2/H3). v2.5 D2
// went further: NO dopl_channel op auto-allows any more, own-channel posts included,
// and the shadow check below proves the tool stays out of allowedTools so that gate can
// actually fire. The op/grant-key cases live in session-profiles.test.mjs; this file
// pins the invariants + the profile universe.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SRC = readFileSync(join(HERE, "..", "main", "session-profiles.js"), "utf8");

const tp = require(join(HERE, "..", "main", "tool-profiles.js"));
const { READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL, normalizeProfile } = tp;

const from = SRC.indexOf("// ─── BEGIN SESSION-PROFILE TABLE");
const to = SRC.indexOf("// ─── END SESSION-PROFILE TABLE");
assert.ok(from !== -1 && to > from, "SESSION-PROFILE TABLE sentinels missing/out of order");
const BLOCK = SRC.slice(from, to);

const { buildSessionToolConfig, grantDecision } = new Function(
  "READ_BUILTINS", "WEB_TOOLS", "DOPL_SAFE_TOOLS", "DENIED_BUILTINS",
  "DOPL_ADMIN_TOOLS", "DOPL_CHANNEL_TOOL", "normalizeProfile",
  `${BLOCK}
   return { buildSessionToolConfig, grantDecision };`
)(READ_BUILTINS, WEB_TOOLS, DOPL_SAFE_TOOLS, DENIED_BUILTINS, DOPL_ADMIN_TOOLS, DOPL_CHANNEL_TOOL, normalizeProfile);

const PROFILES = ["read_only", "dopl_only", "full"];
const ownPost = (channel) => ({ op: "post", channel });

// ── The shadow invariant (the whole point of this file) ────────────────────────

test("SHADOW INVARIANT: every pre-approved tool resolves to 'preapproved', never gates", () => {
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    for (const tool of cfg.preApproved) {
      const d = grantDecision({ profile, toolName: tool });
      assert.equal(d, "preapproved", `${profile}: pre-approved ${tool} must be 'preapproved', got '${d}'`);
    }
  }
});

test("a pre-approved tool stays 'preapproved' even if it is (redundantly) in allowForTask", () => {
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    const tool = cfg.preApproved[0];
    assert.equal(grantDecision({ profile, toolName: tool, allowForTask: [tool] }), "preapproved");
  }
});

// ── Deny truth table ───────────────────────────────────────────────────────────

test("every disallowed tool resolves to 'deny' on its profile", () => {
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    for (const tool of cfg.disallowedTools) {
      assert.equal(grantDecision({ profile, toolName: tool }), "deny", `${profile}: ${tool} must deny`);
    }
  }
});

test("a hard-denied tool denies even when the operator tries to allow it for the task", () => {
  assert.equal(grantDecision({ profile: "read_only", toolName: "Bash", allowForTask: ["Bash"] }), "deny");
});

// ── Gate truth table ───────────────────────────────────────────────────────────

test("under 'full', an ungranted work tool GATES; granting it for the task -> 'allow'", () => {
  for (const tool of ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch"]) {
    assert.equal(grantDecision({ profile: "full", toolName: tool }), "gate", `${tool} should gate under full`);
    assert.equal(grantDecision({ profile: "full", toolName: tool, allowForTask: [tool] }), "allow", `${tool} allowed-for-task`);
  }
});

test("FIX H1 + D2: read_only / dopl_only gate NOTHING in their profile universe; dopl_channel ALWAYS gates", () => {
  // The profile's static universe (preApproved + disallowed) never gates — but
  // dopl_channel, which is in NEITHER set, gates for EVERY op as of v2.5 D2.
  for (const profile of ["read_only", "dopl_only"]) {
    const cfg = buildSessionToolConfig(profile);
    for (const tool of cfg.preApproved.concat(cfg.disallowedTools)) {
      assert.notEqual(grantDecision({ profile, toolName: tool }), "gate", `${profile}: ${tool} must not gate`);
    }
    // D2: the own-channel post (the delivery message) gates too — it used to auto-allow.
    assert.equal(grantDecision({ profile, toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: ownPost("c1") }), "gate");
    assert.equal(grantDecision({ profile, toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: { op: "open", direct: true } }), "gate");
  }
});

test("D2 SHADOW CHECK: dopl_channel is in NO profile's allowedTools, so the gate can actually fire", () => {
  // The shadow rule (§A.5): anything named in allowedTools auto-approves BEFORE
  // canUseTool runs. A gated post is only real if the tool stays out of that list.
  for (const profile of PROFILES) {
    const cfg = buildSessionToolConfig(profile);
    assert.ok(!cfg.preApproved.includes(DOPL_CHANNEL_TOOL), `${profile}: dopl_channel must not be shadowed`);
    assert.ok(!cfg.disallowedTools.includes(DOPL_CHANNEL_TOOL), `${profile}: it must still be offered`);
  }
});

// ── FIX H2 / H3: the dangerous subset hard-denies under every profile ────────────

test("FIX H3: Task + Agent resolve 'deny' (never 'gate') under EVERY session profile", () => {
  for (const profile of PROFILES) {
    assert.equal(grantDecision({ profile, toolName: "Task" }), "deny", `${profile}: Task`);
    assert.equal(grantDecision({ profile, toolName: "Agent" }), "deny", `${profile}: Agent`);
  }
});

test("FIX H2: full hard-denies the persistence/exfil/delegation subset (deny, not gate)", () => {
  for (const tool of ["Task", "Agent", "CronCreate", "CronDelete", "SendMessage", "RemoteTrigger", "ScheduleWakeup", "Monitor", "Skill", "ToolSearch"]) {
    assert.equal(grantDecision({ profile: "full", toolName: tool }), "deny", `full must deny ${tool}`);
  }
  for (const tool of DOPL_ADMIN_TOOLS) {
    assert.equal(grantDecision({ profile: "full", toolName: tool }), "deny", `full must deny ${tool}`);
  }
});

// ── Robustness ───────────────────────────────────────────────────────────────

test("grantDecision tolerates missing args and unknown profiles (normalize to full)", () => {
  assert.equal(grantDecision({ toolName: "Bash" }), "gate", "no profile -> full -> Bash gates");
  // FIX H1 + D2: dopl_channel gates whatever the input is — no input, and an
  // own-channel post, both land on the operator's dock.
  assert.equal(grantDecision({ profile: "nonsense", toolName: DOPL_CHANNEL_TOOL }), "gate");
  assert.equal(grantDecision({ profile: "nonsense", toolName: DOPL_CHANNEL_TOOL, channelId: "c1", input: ownPost("c1") }), "gate");
  assert.equal(grantDecision(), "gate", "no args -> full -> unknown tool gates");
});
