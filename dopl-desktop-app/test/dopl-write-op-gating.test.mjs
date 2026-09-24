// NO DOPL WRITE IS EVER AUTO-APPROVED BELOW THE WIDEST MODE — on any runtime, any profile.
// (2026-09-23. `dopl_agent` create/update/grant and `dopl_workspaces` create_home_channel sat in
// `DOPL_READ_TOOLS` because `session-dopl-tools.js › DOPL_WRITE_TOOLS` omitted them, so they were
// SHADOWED by Claude's `dopl_only.preApproved`, allowed by Claude's `auto` (the windowless floor)
// and by every Cursor mode.)
//
// THREE THINGS ARE PINNED, AND THE FIRST IS THE ONE THAT CATCHES THE NEXT TOOL:
//
//   1. THE GATE, DRIVEN FROM THE SERVER'S OWN TABLE. Every tool `packages/mcp-server/src/gating.ts
//      › WRITE_OPS` names (bar `dopl_channel`, which Axis B owns) × every write op × every runtime ×
//      every profile it declares × every Axis-A mode but the widest resolves `gate` or `deny` through
//      the REAL `grantDecision`. A tool the server gives a write op tomorrow is covered the day it
//      lands, with no edit here.
//   2. THE LISTS. No such tool is in `DOPL_READ_TOOLS` or in any runtime × profile `preApproved`
//      (a pre-approval is a SHADOW: the call never reaches `canUseTool` at all).
//   3. THE OP-SCOPED READS. `dopl-read-ops.js › DOPL_READ_OPS` holds no write op, and for each tool
//      it scopes it is exactly the server's published op enum MINUS its WRITE_OPS.
//
// Run: `node --test dopl-desktop-app/test/dopl-write-op-gating.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = (...p) => join(HERE, "..", "main", ...p);

const RUNTIMES = require(M("runtime", "index.js"));
const SPR = require(M("session-profiles-runtime.js"));
const { grantDecision, grantDecisionDetail } = require(M("session-profiles.js"));
const { DOPL_READ_TOOLS, DOPL_WRITE_TOOLS } = require(M("session-dopl-tools.js"));
const { DOPL_SAFE_TOOLS } = require(M("tool-profiles.js"));
const { DOPL_READ_OPS, isDoplReadOpCall } = require(M("dopl-read-ops.js"));

const SERVER = join(HERE, "..", "..", "packages", "mcp-server", "src");
// ⚠ A MISSING SERVER TREE IS A FAILURE, NOT A SKIP — a guard that quietly stops guarding is the bug.
const readServer = (...p) => readFileSync(join(SERVER, ...p), "utf8");
const full = (short) => `mcp__dopl__${short}`;

/** `WRITE_OPS`, every tool, parsed out of gating.ts (quoted words inside each `new Set([ … ])`). */
function serverWriteOps() {
  const src = readServer("gating.ts");
  const at = src.indexOf("export const WRITE_OPS");
  assert.notEqual(at, -1, "WRITE_OPS moved — re-anchor this parse");
  const end = src.indexOf("\n};", at);
  assert.ok(end > at, "WRITE_OPS is unterminated");
  const body = src.slice(at, end);
  const out = {};
  const re = /^\s*(dopl_[a-z_]+): new Set\(\[([\s\S]*?)\]\)/gm;
  let m;
  while ((m = re.exec(body))) {
    out[m[1]] = (m[2].match(/"([a-z_.]+)"/g) || []).map((s) => s.slice(1, -1));
  }
  return out;
}

/** A tool's PUBLISHED op enum: a `const X = [ … ]` list, or an inline `.enum([ … ])` after an anchor. */
function listAfter(src, anchor, open) {
  const at = src.indexOf(anchor);
  assert.notEqual(at, -1, `${anchor} moved — re-anchor this parse`);
  const start = src.indexOf(open, at);
  const close = src.indexOf("]", start + open.length);
  assert.ok(start !== -1 && close > start, `${anchor}: list unterminated`);
  return (src.slice(start + open.length, close).match(/"([a-z_]+)"/g) || []).map((s) => s.slice(1, -1));
}

// Where each op-scoped tool's published enum lives. A tool added to DOPL_READ_OPS with no row here
// fails the parity test below by name, so the table cannot grow unparsed.
const ENUM_SOURCES = {
  dopl_kb: () => listAfter(readServer("tools", "knowledge.ts"), "const KB_OPS = [", "["),
  dopl_agent: () => listAfter(readServer("tools", "agent.ts"), "const AGENT_OPS = [", "["),
  dopl_workspaces: () => listAfter(readServer("meta-tools.ts"), "const WORKSPACES_SHAPE = {", ".enum(["),
};

const WRITE_OPS = serverWriteOps();
// Axis B's tool: `grantDecision` branches it before Axis A or `preApproved` is ever asked.
const AXIS_A_WRITE_TOOLS = Object.keys(WRITE_OPS).filter((t) => t !== "dopl_channel");

function cells() {
  const out = [];
  for (const id of RUNTIMES.ids()) {
    const modes = SPR.toolModesFor(id);
    const widest = SPR.widestToolModeFor(id);
    for (const profile of Object.keys(RUNTIMES.descriptorFor(id).containment.profiles)) {
      for (const mode of modes) out.push({ runtime: id, profile, mode, widest: mode === widest });
    }
  }
  return out;
}

test("the parse is live: WRITE_OPS covers the tools this incident was about", () => {
  assert.ok(AXIS_A_WRITE_TOOLS.length >= 6, `only parsed ${AXIS_A_WRITE_TOOLS.length} tools`);
  assert.deepEqual(WRITE_OPS.dopl_agent, ["create", "update", "grant"]);
  assert.deepEqual(WRITE_OPS.dopl_workspaces, ["create_home_channel"]);
  for (const t of AXIS_A_WRITE_TOOLS) {
    assert.ok(DOPL_SAFE_TOOLS.includes(full(t)), `${t} writes and is not on DOPL_SAFE_TOOLS`);
  }
});

test("GATE: no write op is allowed or pre-approved below the widest Axis-A mode, anywhere", () => {
  const leaks = [];
  for (const c of cells()) {
    if (c.widest) continue;
    for (const tool of AXIS_A_WRITE_TOOLS) {
      for (const op of WRITE_OPS[tool]) {
        const v = grantDecision({
          runtime: c.runtime, profile: c.profile, toolMode: c.mode,
          toolName: full(tool), input: { op, name: "x" },
        });
        if (v !== "gate" && v !== "deny") leaks.push(`${c.runtime}/${c.profile}/${c.mode} ${tool}.${op} -> ${v}`);
      }
    }
  }
  assert.deepEqual(leaks, [], `writes auto-approved:\n${leaks.join("\n")}`);
});

test("GATE: the windowless floor does not open a write (the common case, not an odd one)", () => {
  for (const c of cells()) {
    const floored = SPR.floorWindowlessTool(c.mode, c.runtime);
    if (floored === SPR.widestToolModeFor(c.runtime)) continue;
    for (const [tool, op] of [["dopl_agent", "create"], ["dopl_agent", "grant"], ["dopl_workspaces", "create_home_channel"]]) {
      const v = grantDecision({ runtime: c.runtime, profile: c.profile, toolMode: floored, toolName: full(tool), input: { op } });
      assert.ok(v === "gate" || v === "deny", `${c.runtime}/${c.profile}@${floored} ${tool}.${op} -> ${v}`);
    }
  }
});

test("LISTS: no tool with a write op is a whole-tool read or pre-approved on any profile", () => {
  for (const t of AXIS_A_WRITE_TOOLS) {
    assert.ok(!DOPL_READ_TOOLS.includes(full(t)), `${t} writes and is on DOPL_READ_TOOLS`);
    assert.ok(DOPL_WRITE_TOOLS.includes(full(t)), `${t} writes and is not on DOPL_WRITE_TOOLS`);
  }
  for (const id of RUNTIMES.ids()) {
    for (const profile of Object.keys(RUNTIMES.descriptorFor(id).containment.profiles)) {
      const cfg = SPR.buildSessionToolConfig(profile, id);
      for (const t of AXIS_A_WRITE_TOOLS) {
        assert.ok(!cfg.preApproved.includes(full(t)), `${id}/${profile} pre-approves ${t} (a shadow past the gate)`);
      }
    }
  }
});

// At the modes a session can actually be in: this tree mints only windowless sessions, so Axis A is always
// floored. (Below the floor, Claude `dopl_only` at `manual` pre-approves `dopl_search` but gates an op-scoped
// read — `dopl_kb`'s shape since OQ-1, and unreachable; `runtime/claude/tools.js` records the inversion.)
test("READS: an op-scoped read still resolves wherever a Dopl read tool does, and nowhere wider", () => {
  const reads = [["dopl_agent", { op: "list" }], ["dopl_agent", { op: "get", identity: "x" }],
    ["dopl_workspaces", { op: "list" }], ["dopl_workspaces", {}]];
  for (const c of cells()) {
    const mode = SPR.floorWindowlessTool(c.mode, c.runtime);
    const readTool = grantDecision({ runtime: c.runtime, profile: c.profile, toolMode: mode, toolName: "mcp__dopl__dopl_search", input: {} });
    for (const [tool, input] of reads) {
      const v = grantDecision({ runtime: c.runtime, profile: c.profile, toolMode: mode, toolName: full(tool), input });
      const open = (x) => x === "allow" || x === "preapproved";
      assert.equal(open(v), open(readTool), `${c.runtime}/${c.profile}/${mode} ${tool}(${JSON.stringify(input)}) -> ${v}, dopl_search -> ${readTool}`);
    }
  }
});

test("READS: the explainer names an op-scoped read honestly", () => {
  const d = grantDecisionDetail({ runtime: "claude", profile: "full", toolMode: "auto", toolName: "mcp__dopl__dopl_agent", input: { op: "list" } });
  assert.deepEqual(d, { decision: "allow", reason: "dopl-read-op" });
  const w = grantDecisionDetail({ runtime: "claude", profile: "full", toolMode: "auto", toolName: "mcp__dopl__dopl_agent", input: { op: "create" } });
  assert.equal(w.decision, "gate");
});

test("PARITY: DOPL_READ_OPS holds no write op, and each row is exactly enum − WRITE_OPS", () => {
  for (const name of Object.keys(DOPL_READ_OPS)) {
    const tool = name.replace(/^mcp__dopl__/, "");
    const writes = WRITE_OPS[tool] || [];
    for (const op of DOPL_READ_OPS[name]) assert.ok(!writes.includes(op), `${tool}.${op} WRITES and is on DOPL_READ_OPS`);
    assert.ok(ENUM_SOURCES[tool], `${tool} is op-scoped with no ENUM_SOURCES row — add its parse`);
    const enumOps = ENUM_SOURCES[tool]();
    assert.ok(enumOps.length >= 2, `${tool}: only parsed ${enumOps.length} ops`);
    for (const w of writes) assert.ok(enumOps.includes(w), `${tool}: WRITE_OPS names "${w}", not in the op enum`);
    assert.deepEqual(DOPL_READ_OPS[name].slice().sort(), enumOps.filter((o) => !writes.includes(o)).sort(),
      `${tool}: DOPL_READ_OPS drifted from the server (a new read is a GAP; a new write must leave the list)`);
  }
});

test("PARITY: every write tool whose reads a windowless agent relied on is op-scoped", () => {
  // These three were whole-tool reads before 2026-09-23 (and dopl_kb since OQ-1); moving them to the
  // write list without scoping their reads would have DENIED those reads in every windowless session.
  for (const t of ["dopl_kb", "dopl_agent", "dopl_workspaces"]) {
    assert.ok(DOPL_READ_OPS[full(t)], `${t} has no op-scoped read row`);
  }
});

test("CLASSIFIER: fail-closed; an absent op is a read ONLY where the server defaults it to one", () => {
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_agent", { op: "list" }), true);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_agent", { op: "create" }), false);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_agent", {}), false);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_agent", null), false);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_agent", { op: 7 }), false);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_workspaces", {}), true);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_workspaces", null), true);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_workspaces", { op: "create_home_channel" }), false);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_workspaces", { op: 7 }), false);
  assert.equal(isDoplReadOpCall("mcp__dopl__dopl_skill", { op: "list" }), false);
  assert.equal(isDoplReadOpCall("Bash", { op: "list" }), false);
  // The default is the server's: its schema must still say `op` is optional and defaults to "list".
  const src = readServer("meta-tools.ts");
  const shape = src.slice(src.indexOf("const WORKSPACES_SHAPE = {"), src.indexOf("name:", src.indexOf("const WORKSPACES_SHAPE = {")));
  assert.match(shape, /\.optional\(\)/, "dopl_workspaces.op is no longer optional — drop DEFAULT_READ_OP");
  assert.match(shape, /Default: "list"/, "dopl_workspaces.op no longer defaults to list — drop DEFAULT_READ_OP");
});
