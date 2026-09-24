// A GRANULAR DOPL CALL IS JUDGED AS THE LEGACY CALL IT RUNS (DMP-013 B4).
//
// `main/dopl-tool-table.json` is the server manifest's projection (pinned byte-for-byte by
// `packages/mcp-server/src/desktop-tool-table.test.ts`); `main/mcp-tool-names.js › canonicalDoplCall`
// rewrites a granular call to its legacy `{ name, input }` before the gate. Pinned here: every job
// lands on its binding, the fixed args win over the caller's, and anything unplaceable fails closed.
//
// Run: `node --test dopl-desktop-app/test/dopl-tool-table.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (...p) => join(HERE, "..", "main", ...p);

const TABLE = require(M("dopl-tool-table.json"));
const { GRANULAR_NAMES, parseBinding } = require(M("dopl-tool-table.js"));
const { canonicalDoplCall, canonicalDoplName, isDoplToolName, DOPL_SHORT_NAMES } = require(M("mcp-tool-names.js"));
const { DOPL_CHANNEL_TOOL, DOPL_SAFE_TOOLS } = require(M("tool-profiles.js"));
const { grantDecision } = require(M("session-profiles.js"));
const RUNTIMES = require(M("runtime", "index.js"));

const LEGACY = new Set([DOPL_CHANNEL_TOOL, ...DOPL_SAFE_TOOLS]);

test("the table is the 39-tool manifest, and every name joins the Dopl vocabulary", () => {
  assert.equal(TABLE.tools.length, 39);
  assert.equal(GRANULAR_NAMES.length, 39);
  for (const name of GRANULAR_NAMES) {
    assert.ok(DOPL_SHORT_NAMES.includes(name), name);
    assert.equal(canonicalDoplName(`mcp__6a12c8bd-4187-40eb-9b21-eb230264f726__${name}`), `mcp__dopl__${name}`);
    assert.ok(isDoplToolName(`mcp__claude_ai_Dopl__${name}`));
  }
  assert.equal(new Set(DOPL_SHORT_NAMES).size, DOPL_SHORT_NAMES.length, "dopl_search is listed once");
});

test("every job of every tool lands on its binding's legacy tool, op and action", () => {
  for (const row of TABLE.tools) {
    const jobs = typeof row.bind === "string" ? [[null, row.bind]] : Object.entries(row.bind);
    for (const [job, key] of jobs) {
      const input = { channel: "c1", body: "hi", ...(job === null ? {} : { [row.select]: job }) };
      const call = canonicalDoplCall(`mcp__dopl__${row.name}`, input);
      const { tool, op, action } = parseBinding(key);
      assert.equal(call.name, `mcp__dopl__${tool}`, `${row.name}/${job}`);
      assert.ok(LEGACY.has(call.name), `${row.name}/${job} -> ${call.name} is not a legacy tool`);
      assert.equal(call.input.op, op, `${row.name}/${job} op`);
      assert.equal(call.input.action, action, `${row.name}/${job} action`);
      if (row.select) assert.ok(!(row.select in call.input) || row.select === "action", `${row.name}: selector consumed`);
      assert.equal(call.input.body, "hi", "other args pass through");
    }
  }
});

test("the fixed args win: a caller cannot re-point op, action or a preset", () => {
  const decision = canonicalDoplCall("dopl_request_decision", { body: "b", kind: "message", op: "read" });
  assert.deepEqual(decision, { name: DOPL_CHANNEL_TOOL, input: { body: "b", op: "send", kind: "decision" } });
  const read = canonicalDoplCall("dopl_read_channel", { op: "send", action: "launch", wait_ms: 5 });
  assert.deepEqual(read.input, { wait_ms: 5, op: "read" });
  const invite = canonicalDoplCall("dopl_invite_to_channel", { action: "list", to: "x" });
  assert.deepEqual(invite.input, { to: "x", op: "rooms", action: "invite" });
});

test("a default selector applies only when absent; the shared name keeps its legacy meaning", () => {
  assert.deepEqual(canonicalDoplCall("dopl_search", { query: "q" }), { name: "mcp__dopl__dopl_search", input: { query: "q" } });
  assert.deepEqual(canonicalDoplCall("mcp__dopl__dopl_search", { query: "q", within: "knowledge" }),
    { name: "mcp__dopl__dopl_kb", input: { query: "q", op: "search" } });
  assert.deepEqual(canonicalDoplCall("dopl_list_workspaces", undefined), { name: "mcp__dopl__dopl_workspaces", input: { op: "list" } });
});

test("a pulled job resolves as dopl_map; a bound job of the same tool as its binding", () => {
  assert.deepEqual(canonicalDoplCall("dopl_get_guide", { topic: "knowledge", section: "x" }), { name: "mcp__dopl__dopl_map", input: {} });
  assert.equal(canonicalDoplCall("dopl_get_guide", { topic: "channels" }).name, DOPL_CHANNEL_TOOL);
});

test("FAIL CLOSED: a job the tool does not have keeps a name no list classifies", () => {
  const bad = [
    ["dopl_manage_session", { action: "delete" }],
    ["dopl_manage_session", {}],
    ["dopl_get_channel", { action: "constructor" }],
    ["dopl_browse_knowledge", { action: ["tree"] }],
  ];
  for (const [name, input] of bad) {
    const call = canonicalDoplCall(name, input);
    assert.equal(call.name, `mcp__dopl__${name}`, JSON.stringify(input));
    for (const id of RUNTIMES.ids()) {
      for (const profile of Object.keys(RUNTIMES.descriptorFor(id).containment.profiles)) {
        const v = grantDecision({ runtime: id, profile, toolMode: "bypass", toolName: call.name, input: call.input });
        assert.ok(v === "gate" || v === "deny", `${id}/${profile} ${name}(${JSON.stringify(input)}) -> ${v}`);
      }
    }
  }
});

test("the shared name unplaced stays the legacy read it was (the server refuses the value)", () => {
  assert.deepEqual(canonicalDoplCall("dopl_search", { within: 7, query: "q" }), { name: "mcp__dopl__dopl_search", input: { within: 7, query: "q" } });
});

test("any other name passes through untouched, input included", () => {
  const input = { op: "read" };
  for (const name of ["mcp__dopl__dopl_channel", "mcp__claude_ai_Dopl__dopl_kb", "Bash", "", undefined]) {
    const call = canonicalDoplCall(name, input);
    assert.equal(call.name, name);
    assert.equal(call.input, input);
  }
});
