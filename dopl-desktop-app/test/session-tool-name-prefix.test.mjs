// F-139 (2026-08-05) — THE MCP SERVER PREFIX IS THE CLIENT'S, AND EVERY MATCHER ASSUMED OURS.
//
// Two machines on 1.8.6, identical fully-permissive postures, opposite behaviour:
//   working  session gate: dopl_channel op=read allow auto-inbound-read tool=bypass msg=auto_both
//   broken   session gate: mcp__claude_ai_Dopl__dopl_channel gate unclassified-tool tool=bypass msg=auto_both
// The only difference is the server segment. `mcp__dopl__` is what OUR registration produces;
// the claude.ai connector says `mcp__claude_ai_Dopl__`; other clients use a UUID. Every list in
// session-profiles.js is written in the first form and was matched by exact string, so under any
// other server name the WHOLE table missed at once — the channel tool skipped AXIS B and gated as
// `unclassified-tool` in every posture (`bypass` included, so no setting could fix it), the Dopl
// read/write tools were covered by no mode, and the HARD-DENY set was walked past.
//
// This file is the truth table for the fix, split out of session-permission-hardening.test.mjs at
// the §2 cap (the F3 matcher test stays there, where its finding lives). The property being
// pinned is ONE sentence: WHICH RULE ANSWERS A TOOL MUST NOT DEPEND ON WHICH CLIENT NAMED THE
// SERVER. The direction that matters most is the deny half — a gate is one operator click away
// from running a tool the table says can never be opened at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (p) => join(HERE, "..", "main", p);

const profiles = require(M("session-profiles.js"));
const names = require(M("mcp-tool-names.js"));
const { grantDecision, grantKeyFor, TOOL_MODES, MESSAGE_MODES } = profiles;

const CH = "ch1";
const decide = (over) => grantDecision({ profile: "full", channelId: CH, ...over });

// ── the normalizer itself ─────────────────────────────────────────────────────────

test("F-139: the short name is the segment after the LAST `__`, under any server", () => {
  assert.equal(names.mcpShortName("mcp__dopl__dopl_channel"), "dopl_channel");
  assert.equal(names.mcpShortName("mcp__claude_ai_Dopl__dopl_channel"), "dopl_channel");
  assert.equal(names.mcpShortName("mcp__6a12c8bd-4187-40eb-9b21-eb230264f726__dopl_kb"), "dopl_kb");
  assert.equal(names.mcpShortName("dopl_channel"), "dopl_channel", "a bare name is already short");
  assert.equal(names.mcpShortName("Bash"), "Bash", "a built-in is untouched");
  assert.equal(names.mcpShortName(""), "");
  assert.equal(names.mcpShortName(null), "", "and a non-string never throws");
  assert.equal(names.mcpShortName(undefined), "");
});

test("F-139: canonicalization rewrites ONLY the known Dopl vocabulary", () => {
  assert.equal(names.canonicalDoplName("mcp__claude_ai_Dopl__dopl_kb"), "mcp__dopl__dopl_kb");
  assert.equal(names.canonicalDoplName("mcp__dopl__dopl_kb"), "mcp__dopl__dopl_kb", "idempotent");
  assert.equal(names.canonicalDoplName("dopl_search"), "mcp__dopl__dopl_search", "the bare form too");
  assert.equal(names.canonicalDoplName("current_workspace"), "mcp__dopl__current_workspace");
  // Everything else comes back untouched, so it stays unclassified and keeps gating.
  for (const n of ["Bash", "mcp__other__some_tool", "mcp__claude_ai_Dopl__not_a_dopl_tool", "", "x__y"]) {
    assert.equal(names.canonicalDoplName(n), n, n);
  }
  assert.equal(names.canonicalDoplName(null), "", "a non-string is not a tool name");
});

// ── F-139: the SAME miss, on every OTHER prefix-dependent matcher in the table ─────
// The channel tool was the visible half. Every list in session-profiles.js is written in the
// `mcp__dopl__…` form, so on a connector-named server the Dopl read/write tools were covered by
// no mode either, and — the serious direction — the HARD-DENY set was walked past.
test("F-139: the HARD-DENY set cannot be escaped by ANY server prefix", () => {
  // The four live admin companions PLUS the two the 2026-08-07 retirement unregistered:
  // a retired tool keeps its hard-deny (RETIRED_DOPL_TOOLS in tool-profiles.js), so this
  // list is unchanged and that is the point — unregistering must not loosen the gate.
  const ADMINS = ["dopl_kb_admin", "dopl_cluster_admin", "dopl_skill_admin",
    "dopl_ontology_admin", "dopl_chats_admin", "dopl_workflow_admin"];
  const PREFIXES = ["mcp__dopl__", "mcp__claude_ai_Dopl__",
    "mcp__6a12c8bd-4187-40eb-9b21-eb230264f726__", "mcp__anything_at_all__", ""];
  for (const short of ADMINS) {
    for (const prefix of PREFIXES) {
      const name = prefix + short;
      for (const profile of ["read_only", "dopl_only", "full"]) {
        // Not 'gate' — DENY. A gate is one operator click away from running it, and the whole
        // point of the hard-deny set is that no click, no grant and no `bypass` can open it.
        assert.equal(decide({ profile, toolName: name, input: {}, toolMode: "bypass", messageMode: "auto_both",
          allowForTask: [grantKeyFor(name, {}, CH)] }), "deny", `${name} @ ${profile}`);
      }
    }
  }
});

// THE PROPERTY THAT WAS BROKEN: which AXIS answers a channel call must not depend on which
// client named the server. This is the same truth table as the canonical tool, run under every
// server segment seen in the field — the connector's, a UUID one, and the bare short name.
test("F-139: AXIS B governs the channel tool under ANY server name, not just ours", () => {
  const SERVERS = ["mcp__dopl__", "mcp__claude_ai_Dopl__",
    "mcp__6a12c8bd-4187-40eb-9b21-eb230264f726__", ""];
  for (const server of SERVERS) {
    const tool = server + "dopl_channel";
    const own = { op: "post", body: "hi" };
    // Axis B sends an own-channel post; this is the line that gated forever on Anthony's machine.
    assert.equal(decide({ toolName: tool, input: own, messageMode: "auto_both" }), "allow", `${tool} post @ auto_both`);
    assert.equal(decide({ toolName: tool, input: own, messageMode: "auto_outbound" }), "allow", `${tool} post @ auto_outbound`);
    assert.equal(decide({ toolName: tool, input: own, messageMode: "ask" }), "gate", `${tool} post @ ask`);
    // ...and the ops that must never auto-run still do not, under this server either.
    for (const op of ["open", "invite"]) {
      for (const messageMode of MESSAGE_MODES) {
        assert.equal(decide({ toolName: tool, input: { op, direct: true, member: "evil@x" }, messageMode }),
          "gate", `${tool} ${op} @ ${messageMode}`);
      }
    }
    // THE INVARIANT: no TOOL posture answers this tool, whatever the server called it. Before
    // the fix a foreign prefix fell through to exactly this axis.
    for (const toolMode of TOOL_MODES) {
      assert.equal(decide({ toolName: tool, input: own, toolMode }), "gate", `${tool} post @ tool=${toolMode}`);
    }
    // The `_v2` variant rides the same rule under the same server.
    assert.equal(decide({ toolName: tool + "_v2", input: own, messageMode: "auto_both" }), "allow", `${tool}_v2`);
    assert.equal(decide({ toolName: tool + "_v2", input: own, toolMode: "bypass" }), "gate", `${tool}_v2 @ bypass`);
  }
});

test("F-139: the dopl READ/WRITE tools are covered by auto/bypass under ANY server prefix", () => {
  const PREFIXES = ["mcp__dopl__", "mcp__claude_ai_Dopl__", "mcp__6a12c8bd-4187__"];
  for (const prefix of PREFIXES) {
    const read = prefix + "dopl_search";
    const write = prefix + "dopl_kb";
    // `auto` covers the read half and deliberately still asks about the workspace-WRITE half.
    assert.equal(decide({ toolName: read, input: {}, toolMode: "auto" }), "allow", `${read} @ auto`);
    assert.equal(decide({ toolName: write, input: {}, toolMode: "auto" }), "gate", `${write} @ auto`);
    // `bypass` covers both — which on a connector-named server it previously did not.
    assert.equal(decide({ toolName: read, input: {}, toolMode: "bypass" }), "allow", `${read} @ bypass`);
    assert.equal(decide({ toolName: write, input: {}, toolMode: "bypass" }), "allow", `${write} @ bypass`);
    // ...and `manual` still asks about every one of them.
    assert.equal(decide({ toolName: read, input: {}, toolMode: "manual" }), "gate", `${read} @ manual`);
  }
  // An unrelated tool on a foreign server is NOT canonicalized into anything and still gates in
  // every mode — the positive-allow-list rule (F3) is untouched by the wider prefix match.
  for (const toolMode of ["auto", "bypass"]) {
    assert.equal(decide({ toolName: "mcp__other__some_tool", input: {}, toolMode }), "gate");
    assert.equal(decide({ toolName: "mcp__claude_ai_Dopl__not_a_dopl_tool", input: {}, toolMode }), "gate");
  }
});
