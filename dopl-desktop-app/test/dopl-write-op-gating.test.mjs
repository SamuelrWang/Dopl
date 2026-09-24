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
//   4. CODEX REACHES THE GATE AT ALL. Claude and Cursor hand every call to `grantDecision`; Codex only
//      asks when Dopl's MCP entry makes the tool ask, and names the ask by `_meta.tool_title`. So every
//      write tool must ask there, and its ask — in Codex's wire shape — must come back with the same
//      verdict the gate gives. (Until 2026-09-23 only `dopl_channel` could ask on Codex, so every row of
//      pin 1 was true there and unreachable: each Dopl write ran unasked.)
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
const codexMcp = require(M("runtime", "codex", "mcp.js"));
const codexRequests = require(M("runtime", "codex", "server-requests.js"));

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

test("CODEX: every write tool ASKS, and its ask reaches the gate under its own name — same verdicts", async () => {
  const entry = codexMcp.buildDoplServerEntry(null);
  const asks = (short) => ((entry.tools[short] || {}).approval_mode || entry.default_tools_approval_mode) !== "approve";
  for (const tool of AXIS_A_WRITE_TOOLS) assert.ok(asks(tool), `${tool} writes and never asks on Codex`);
  for (const short of Object.keys(entry.tools)) {
    if (!asks(short)) assert.equal(WRITE_OPS[short], undefined, `${short} never asks on Codex and has write ops`);
  }
  // Codex's wire shape (`mcpServer/elicitation/request`), answered through the REAL translator and gate.
  const viaCodex = (c, tool, input) => codexRequests.answer({
    method: "mcpServer/elicitation/request",
    params: { serverName: codexMcp.SERVER_KEY, _meta: { codex_approval_kind: "mcp_tool_call", tool_title: tool, tool_params: input } },
  }, async (name, args) => (grantDecision({
    runtime: "codex", profile: c.profile, toolMode: c.mode, toolName: name, input: args,
  }) === "allow" ? "allow" : "deny"));
  const leaks = [];
  for (const c of cells().filter((x) => x.runtime === "codex")) {
    for (const tool of AXIS_A_WRITE_TOOLS) {
      for (const op of WRITE_OPS[tool]) {
        const input = { op, name: "x" };
        const want = grantDecision({ runtime: "codex", profile: c.profile, toolMode: c.mode, toolName: full(tool), input }) === "allow";
        const { action } = await viaCodex(c, tool, input);
        if (action !== (want ? "accept" : "decline")) leaks.push(`${c.profile}/${c.mode} ${tool}.${op} -> ${action}`);
        if (!c.widest && action === "accept") leaks.push(`${c.profile}/${c.mode} ${tool}.${op} accepted below the widest mode`);
      }
    }
  }
  assert.deepEqual(leaks, [], `Codex answered a write differently from the gate:\n${leaks.join("\n")}`);
  // Not a blanket decline: the widest mode on `full` really accepts, as on every runtime.
  const widest = { profile: "full", mode: SPR.widestToolModeFor("codex") };
  assert.deepEqual(await viaCodex(widest, "dopl_agent", { op: "create", name: "x" }), { action: "accept" });
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

// ── THE GRANULAR SURFACE (DMP-013) ──────────────────────────────────────────────────────────
// A granular call reaches the gate as the legacy call it runs (`mcp-tool-names.js ›
// canonicalDoplCall`, called by `session-gate-bridge.js › gateCall`); the pins below run the same
// rewrite and then the REAL gate, so a granular write is held to every legacy row above. Write ops
// still come from the server's `WRITE_OPS` source text, never from the generated table.

const TABLE = require(M("dopl-tool-table.json")).tools;
const { parseBinding } = require(M("dopl-tool-table.js"));
const { canonicalDoplCall } = require(M("mcp-tool-names.js"));
const { GRANULAR_READ_TOOLS, GRANULAR_SAFE_TOOLS } = require(M("session-dopl-tools.js"));

// `gating.ts › isWriteOp`'s grain: an entry names the op whole (`manage`) or one action (`rooms.open`).
const isWrite = (key) => {
  const { tool, op, action } = parseBinding(key);
  const writes = WRITE_OPS[tool] || [];
  return op !== undefined && (writes.includes(op) || (action !== undefined && writes.includes(`${op}.${action}`)));
};
/** Every (tool, job, binding) with the input a granular call for that job carries. */
const JOBS = TABLE.flatMap((row) => (typeof row.bind === "string" ? [[null, row.bind]] : Object.entries(row.bind))
  .map(([job, key]) => ({ row, key, input: { name: "x", body: "b", ...(job === null ? {} : { [row.select]: job }) } })));
/** What the production gate does (`gateCall`): canonicalise, then the REAL `grantDecision`. */
const viaGate = (c, name, input) => {
  const call = canonicalDoplCall(name, input);
  return grantDecision({ runtime: c.runtime, profile: c.profile, toolMode: c.mode, toolName: call.name, input: call.input });
};

test("GRANULAR: the generated read class agrees with the server's WRITE_OPS, job by job", () => {
  for (const row of TABLE) {
    const writes = JOBS.filter((j) => j.row === row && isWrite(j.key));
    assert.equal(row.read, writes.length === 0, `${row.name}: read=${row.read} but writes ${writes.map((j) => j.key)}`);
  }
  assert.ok(JOBS.filter((j) => isWrite(j.key)).length >= 40, "the parse found too few granular write jobs");
});

test("GRANULAR GATE: no granular write job is allowed or pre-approved below the widest mode, anywhere", () => {
  const leaks = [];
  for (const c of cells()) {
    if (c.widest) continue;
    for (const j of JOBS.filter((x) => isWrite(x.key))) {
      const v = viaGate(c, full(j.row.name), j.input);
      if (v !== "gate" && v !== "deny") leaks.push(`${c.runtime}/${c.profile}/${c.mode} ${j.row.name}(${j.key}) -> ${v}`);
    }
  }
  assert.deepEqual(leaks, [], `granular writes auto-approved:\n${leaks.join("\n")}`);
});

test("GRANULAR LISTS: only whole-tool reads are pre-approved or never-ask, and each job resolves as its legacy read", () => {
  assert.deepEqual(GRANULAR_READ_TOOLS.slice().sort(), ["dopl_get_map", "dopl_get_member", "dopl_get_status", "dopl_list_members"].map(full),
    "the granular whole-tool reads moved — a new one must be argued, not inherited");
  const granular = new Set(TABLE.map((r) => full(r.name)));
  const readNames = new Set(TABLE.filter((r) => r.read).map((r) => full(r.name)));
  for (const id of RUNTIMES.ids()) {
    for (const profile of Object.keys(RUNTIMES.descriptorFor(id).containment.profiles)) {
      const cfg = SPR.buildSessionToolConfig(profile, id);
      for (const name of cfg.preApproved.filter((t) => granular.has(t) && !DOPL_READ_TOOLS.includes(t))) {
        assert.ok(readNames.has(name), `${id}/${profile} pre-approves the granular write ${name}`);
        for (const j of JOBS.filter((x) => full(x.row.name) === name)) {
          const v = viaGate({ runtime: id, profile, mode: SPR.toolModesFor(id)[0] }, name, j.input);
          assert.equal(v, "preapproved", `${id}/${profile} shadows ${name} but its legacy call resolves ${v}`);
        }
      }
    }
  }
  const entry = codexMcp.buildDoplServerEntry(null);
  for (const row of TABLE) {
    const approve = (entry.tools[row.name] || {}).approval_mode === "approve";
    if (approve) assert.ok(row.read, `${row.name} writes and never asks on Codex`);
  }
});

test("GRANULAR OFFER: a restricted profile offers the server's set and denies what binds only the surface it denies", () => {
  for (const id of RUNTIMES.ids()) {
    for (const profile of ["read_only", "dopl_only"]) {
      if (!RUNTIMES.descriptorFor(id).containment.profiles[profile]) continue;
      const cfg = SPR.buildSessionToolConfig(profile, id);
      for (const row of TABLE) {
        const offered = cfg.doplToolsPolicy.includes(row.name);
        const bound = JOBS.filter((j) => j.row === row).map((j) => parseBinding(j.key).tool);
        assert.equal(offered, bound.some((t) => cfg.doplToolsPolicy.includes(t)), `${id}/${profile} ${row.name}: offer does not follow its bound tools`);
        if (profile !== "read_only") continue;
        assert.equal(cfg.disallowedTools.includes(full(row.name)), !offered, `${id}/read_only ${row.name}: deny is not the offer's complement`);
        // A job outside the offer is denied at the gate as its legacy tool, even on an offered tool.
        for (const j of JOBS.filter((x) => x.row === row && !cfg.doplToolsPolicy.includes(parseBinding(x.key).tool))) {
          assert.equal(viaGate({ runtime: id, profile, mode: SPR.widestToolModeFor(id) }, full(row.name), j.input), "deny", `${id}/read_only ${row.name}(${j.key})`);
        }
      }
    }
  }
  assert.equal(GRANULAR_SAFE_TOOLS.length, 26, "the granular tools binding only the non-channel surface moved");
});

test("CODEX: a granular ask is named by its title and answered exactly as its legacy call", async () => {
  const leaks = [];
  for (const c of cells().filter((x) => x.runtime === "codex")) {
    for (const j of JOBS) {
      const want = viaGate(c, full(j.row.name), j.input) === "allow";
      const { action } = await codexRequests.answer({
        method: "mcpServer/elicitation/request",
        params: { serverName: codexMcp.SERVER_KEY, _meta: { codex_approval_kind: "mcp_tool_call", tool_title: j.row.name, tool_params: j.input } },
      }, async (name, args) => (viaGate(c, name, args) === "allow" ? "allow" : "deny"));
      if (action !== (want ? "accept" : "decline")) leaks.push(`${c.profile}/${c.mode} ${j.row.name}(${j.key}) -> ${action}`);
      if (!c.widest && isWrite(j.key) && action === "accept") leaks.push(`${c.profile}/${c.mode} ${j.row.name}(${j.key}) accepted below the widest mode`);
    }
  }
  assert.deepEqual(leaks, [], `Codex answered a granular call differently from the gate:\n${leaks.join("\n")}`);
  // Not a blanket decline: the widest mode on `full` accepts a granular write, as on every runtime.
  const widest = { runtime: "codex", profile: "full", mode: SPR.widestToolModeFor("codex") };
  assert.equal(viaGate(widest, "dopl_manage_agent", { action: "create", name: "x" }), "allow");
});
