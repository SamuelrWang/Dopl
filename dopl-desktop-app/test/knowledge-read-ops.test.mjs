// THE OP-SCOPED `dopl_kb` READ — the parity pin, and the gate driven BOTH WAYS.
// (2026-08-22, OQ-1, resolved by orchestrator. `main/knowledge-ops.js` carries the argument.)
//
// TWO THINGS ARE PINNED HERE AND THEY FAIL FOR DIFFERENT REASONS:
//
//   1. PARITY. `main/knowledge-ops.js › KNOWLEDGE_READ_OPS` is a POSITIVE allow-list, so it is
//      fail-closed at runtime — but it is still a HAND COPY of a set the MCP server owns, and
//      `packages/mcp-server/src/gating.ts` states the discipline for its own consumers: "Keep
//      each set in sync with the tool's `op` enum: a new write op MUST be added here." This file
//      is the desktop's half of that discipline. It parses the SERVER SOURCE — the tool's `op`
//      enum out of `tools/knowledge.ts` and `WRITE_OPS.dopl_kb` out of `gating.ts` — and asserts
//      the desktop's list is exactly `enum − WRITE_OPS`. A new READ op nobody copied fails as a
//      GAP; a new WRITE op fails as a STALE LIST. Neither can fail as a silent grant.
//      ⚠ THE SAME SOURCE-TEXT PARSE `packages/mcp-server/src/tools/parity-harness.ts` uses, for
//      the same reason: the server is TypeScript and this suite is plain `node --test`.
//
//   2. THE GATE, both ways, through the REAL `grantDecision`. A read op allows at the windowless
//      tool floor; every write op still gates (and a windowless gate is a deny); `read_only`
//      denies the tool outright at step 1 and this branch cannot reopen it.
//
// Run: `node --test dopl-desktop-app/test/knowledge-read-ops.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const { KNOWLEDGE_TOOL, KNOWLEDGE_READ_OPS, isKnowledgeReadCall } = require(
  join(HERE, "..", "main", "knowledge-ops.js")
);
const { grantDecision, grantDecisionDetail, floorWindowlessTool } = require(
  join(HERE, "..", "main", "session-profiles.js")
);

// ── The server's own two sets, read out of its source ────────────────────────
const SERVER = join(HERE, "..", "..", "packages", "mcp-server", "src");

function readServer(...p) {
  const file = join(SERVER, ...p);
  // ⚠ A MISSING SERVER TREE IS A FAILURE, NOT A SKIP. A parity guard that quietly stops
  // guarding is the exact shape this file exists to prevent.
  return readFileSync(file, "utf8");
}

/**
 * The `dopl_kb` op enum, parsed out of the tool's zod schema.
 *
 * ⚠ ANCHORED ON THE SHAPE CONST, NOT ON THE REGISTRAR, SINCE 2026-09-02 (A14).
 * This looked forward from `register("dopl_kb"` for the next `.enum([`, which
 * worked only while the shape was an object literal written INSIDE the
 * registrar call. A14 hoisted it to `const KB_INPUT_SHAPE` above the call — so
 * `tool-style.ts › composeDescription` can render the tool's limits from the
 * same object the registrar enforces — and the forward scan then found nothing
 * and failed as "the op enum moved". It had not moved; the parse had.
 *
 * ⚠ THE REGISTRAR ASSERTION STAYS, AND IT IS NOW DOING REAL WORK: it pins that
 * the shape this function parsed is the shape that is actually REGISTERED. An
 * enum read out of some other const would be a parity check against a schema no
 * client ever sees, which is a guard that passes while the grant drifts.
 */
function serverOpEnum() {
  const src = readServer("tools", "knowledge.ts");
  const shape = src.indexOf("const KB_INPUT_SHAPE = {");
  assert.notEqual(shape, -1, "KB_INPUT_SHAPE moved — re-anchor this parse");
  const at = src.indexOf('register(\n    "dopl_kb"');
  assert.notEqual(at, -1, "the dopl_kb registrar moved — re-anchor this parse");
  assert.ok(
    src.indexOf("KB_INPUT_SHAPE", at) !== -1,
    "dopl_kb no longer registers KB_INPUT_SHAPE — this parse would be reading a schema nobody is served"
  );
  // ⚠ **IT READS `KB_OPS`, NOT THE `.enum([…])` LITERAL, SINCE 2026-09-02.**
  // B15 made the runtime enum a SPREAD — `.enum([...KB_OPS, ...RETIRED_COPY_OP_NAMES])`
  // over a `.meta({ enum: [...KB_OPS] })` that publishes only the first half —
  // so slicing between `.enum([` and `])` parsed the two identifiers as ops and
  // this test failed with "only parsed 2". **The published set is the right
  // subject anyway**: a retired name PARSES for one release and no client can
  // SEE it, so deriving a desktop grant from the wider set would have granted
  // windowless sessions ops that are not on the surface. It is the same rule
  // `packages/mcp-server/src/tools/parity-harness.ts › opEnum` states
  // server-side — read what a CLIENT reads.
  const list = src.indexOf("const KB_OPS = [");
  assert.notEqual(list, -1, "KB_OPS moved — re-anchor this parse");
  assert.ok(
    src.indexOf("KB_OPS", shape) !== -1,
    "KB_INPUT_SHAPE no longer builds its enum from KB_OPS — this parse would be reading a list nobody is served"
  );
  const close = src.indexOf("]", list + "const KB_OPS = [".length);
  assert.ok(close > list, "KB_OPS is unterminated");
  return src
    .slice(list + "const KB_OPS = [".length, close)
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/** `WRITE_OPS.dopl_kb`, parsed out of gating.ts — quoted strings only, comments dropped. */
function serverWriteOps() {
  const src = readServer("gating.ts");
  const at = src.indexOf("dopl_kb: new Set([");
  assert.notEqual(at, -1, "WRITE_OPS.dopl_kb moved — re-anchor this parse");
  const close = src.indexOf("])", at);
  assert.ok(close > at, "WRITE_OPS.dopl_kb is unterminated");
  return (src.slice(at, close).match(/"([a-z_]+)"/g) || []).map((s) => s.slice(1, -1));
}

test("PARITY: the desktop's read list is exactly the server's enum MINUS its WRITE_OPS", () => {
  const enumOps = serverOpEnum();
  const writes = serverWriteOps();
  assert.ok(enumOps.length >= 10, `only parsed ${enumOps.length} ops — the parse is broken`);
  assert.ok(writes.length >= 5, `only parsed ${writes.length} write ops — the parse is broken`);
  for (const w of writes) {
    assert.ok(enumOps.includes(w), `WRITE_OPS names "${w}", which is not in the op enum`);
  }
  const derived = enumOps.filter((op) => !writes.includes(op)).sort();
  assert.deepEqual(
    KNOWLEDGE_READ_OPS.slice().sort(),
    derived,
    "knowledge-ops.js › KNOWLEDGE_READ_OPS has drifted from the server. If the server grew a " +
      "READ op, add it here (until you do, that op is DENIED to windowless sessions — a gap, " +
      "not a grant). If it grew a WRITE op, remove it here."
  );
});

test("PARITY: not one write op leaked onto the read list", () => {
  for (const w of serverWriteOps()) {
    assert.ok(!KNOWLEDGE_READ_OPS.includes(w), `${w} WRITES and is on the desktop's read list`);
  }
});

// ── The classifier, fail-closed three ways ───────────────────────────────────

test("isKnowledgeReadCall classifies the CALL, and fails closed on anything odd", () => {
  assert.equal(isKnowledgeReadCall(KNOWLEDGE_TOOL, { op: "get_tree" }), true);
  assert.equal(isKnowledgeReadCall(KNOWLEDGE_TOOL, { op: "write_file" }), false);
  assert.equal(isKnowledgeReadCall(KNOWLEDGE_TOOL, { op: "" }), false);
  assert.equal(isKnowledgeReadCall(KNOWLEDGE_TOOL, {}), false);
  assert.equal(isKnowledgeReadCall(KNOWLEDGE_TOOL, null), false);
  assert.equal(isKnowledgeReadCall(KNOWLEDGE_TOOL, { op: 7 }), false);
  // A future server op nobody classified: unknown GATES, it does not run.
  assert.equal(isKnowledgeReadCall(KNOWLEDGE_TOOL, { op: "purge_everything" }), false);
  // Another tool entirely, even with a read-shaped op.
  assert.equal(isKnowledgeReadCall("mcp__dopl__dopl_skill", { op: "read_file" }), false);
  assert.equal(isKnowledgeReadCall("Bash", { op: "get_tree" }), false);
});

// ── The gate, both ways, at the floor a windowless session really runs at ────
//
// ⚠ `floorWindowlessTool` IS THE MODE THAT MATTERS. Axis A starts at `manual` and RESETS to
// `manual` on park, so a table driven at `manual` would be testing a state a windowless session
// is never decided in (`session-io.js › grantArgs` applies the floor at the read).
const FLOOR = floorWindowlessTool("manual"); // 'auto'
const kb = (op, extra) => ({ toolName: KNOWLEDGE_TOOL, input: { op, ...(extra || {}) } });

test("a KB READ op ALLOWS at the windowless floor, under dopl_only and full", () => {
  for (const profile of ["dopl_only", "full"]) {
    for (const op of KNOWLEDGE_READ_OPS) {
      assert.equal(
        grantDecision({ ...kb(op, { base: "b" }), profile, toolMode: FLOOR }),
        "allow",
        `${profile}: op="${op}" must reach the base a template attached`
      );
    }
  }
});

test("every KB WRITE op still GATES at that same floor — and a windowless gate is a deny", () => {
  for (const profile of ["dopl_only", "full"]) {
    for (const op of serverWriteOps()) {
      assert.equal(
        grantDecision({ ...kb(op, { base: "b" }), profile, toolMode: FLOOR }),
        "gate",
        `${profile}: op="${op}" WRITES and must never resolve without a decision`
      );
    }
  }
});

test("read_only HARD-DENIES the tool, and the op branch cannot reopen it", () => {
  for (const op of KNOWLEDGE_READ_OPS) {
    assert.equal(
      grantDecision({ ...kb(op), profile: "read_only", toolMode: FLOOR }),
      "deny",
      `read_only: op="${op}" must stay denied — the tool is not offered to that profile at all`
    );
  }
});

test("manual / accept_edits still ASK — the branch grants where a Dopl READ already resolves", () => {
  // Unreachable in production (the floor makes it so) and pinned anyway: the branch is scoped to
  // the modes AUTO_TOOLS covers, not to "always".
  for (const mode of ["manual", "accept_edits"]) {
    assert.equal(grantDecision({ ...kb("get_tree"), profile: "full", toolMode: mode }), "gate");
  }
});

test("the verdict is EXPLAINED as an op-scoped read, not as a whole-tool grant", () => {
  const read = grantDecisionDetail({ ...kb("read_file"), profile: "full", toolMode: FLOOR });
  assert.deepEqual(read, { decision: "allow", reason: "knowledge-read-op" });
  // ⚠ Under `bypass` the whole tool really IS covered by Axis A, so the honest reason changes.
  const bypassed = grantDecisionDetail({ ...kb("read_file"), profile: "full", toolMode: "bypass" });
  assert.deepEqual(bypassed, { decision: "allow", reason: "tool-mode" });
  const write = grantDecisionDetail({ ...kb("write_file"), profile: "full", toolMode: FLOOR });
  assert.equal(write.decision, "gate");
});

test("the branch touches NO other Dopl write tool — one name, deliberately", () => {
  for (const tool of ["mcp__dopl__dopl_skill", "mcp__dopl__dopl_ontology", "mcp__dopl__dopl_chats"]) {
    assert.equal(
      grantDecision({ toolName: tool, input: { op: "read_file" }, profile: "full", toolMode: FLOOR }),
      "gate",
      `${tool} is not op-scoped and must not have been widened by association`
    );
  }
});
