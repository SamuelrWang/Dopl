// SESSION DETAIL (main/session-detail.js) — the finer activity signal beside the pill.
//
// WHY THIS FILE EXISTS SEPARATELY FROM session-summary.test.mjs: that file is at the
// 500-line cap this tree lints with ZERO exemptions, and it is about the PILL. This is
// about the refinement, which has its own truth table and its own failure mode — a detail
// that outlives the state it describes, or one that speaks over a pill that is not
// `working`.
//
// SOURCE EXTRACTION, the session-reopen idiom: the module's one dependency (`mcpShortName`)
// sits ABOVE the sentinel, so the block below it is evaluated verbatim with the REAL
// normalizer injected — the point of this module is that it does not carry a second copy
// of the tool-name rule (F-139), and a stub here would hide exactly that.
//
// Run: `node --test dopl-desktop-app/test/session-detail.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const SRC = readFileSync(join(MAIN, "session-detail.js"), "utf8");
const req = createRequire(import.meta.url);
const { mcpShortName } = req(join(MAIN, "mcp-tool-names.js"));

const BEGIN = "// ─── BEGIN SESSION-DETAIL-PURE";
const from = SRC.indexOf(BEGIN);
const to = SRC.indexOf("module.exports = {");
assert.notEqual(from, -1, "BEGIN SESSION-DETAIL-PURE sentinel missing");
assert.ok(to > from, "module.exports not found after the sentinel");
const BLOCK = SRC.slice(from, to);

// The purity assertion IS a test: this module runs inside `dispatch`, on every SDK event,
// so a require / network / fs reference here is a cost paid inside the SDK event loop.
for (const banned of ["require(", "electron", "child_process", "fetch(", "setTimeout("]) {
  assert.ok(!BLOCK.includes(banned), `the extracted block must not reference ${banned}`);
}

const EXPORTED = ["DETAIL_KINDS", "TOOL_LABEL_CAP", "noteEvent", "toolLabel", "detailFor"];

function load() {
  return new Function(
    "mcpShortName",
    `${BLOCK}\n return { ${EXPORTED.join(", ")} };`
  )(mcpShortName);
}

const m = load();

// ── 1. THE TABLE ─────────────────────────────────────────────────────────────────────
//
// Every (activity, last event) shape the engine really produces over a WORKING pill, and
// the detail it must become. The `why` column is the module's own reasoning, restated
// where it is checked.
const TABLE = [
  {
    name: "a turn just pushed, nothing rendered yet",
    state: { phase: "running", activity: "working" },
    last: undefined,
    detail: "thinking",
    why: "the ported thinkingVisible rule: in flight, no artifact",
  },
  {
    name: "a steer that has produced no event yet",
    state: { phase: "running", activity: "working" },
    last: "steer",
    detail: "thinking",
  },
  {
    name: "a tool result the model is now reading",
    state: { phase: "running", activity: "working" },
    last: "tool_result",
    detail: "thinking",
    why: "a result is not agent OUTPUT — the agent is deciding again",
  },
  {
    name: "a tool call in flight",
    state: { phase: "running", activity: "working" },
    last: "tool_use",
    detail: "tool",
  },
  {
    name: "the agent posting to the peer",
    state: { phase: "running", activity: "working" },
    last: "outbound_post",
    detail: "posting",
  },
  {
    name: "the agent has drafted text",
    state: { phase: "running", activity: "working" },
    last: "assistant",
    detail: null,
    why: "agent output CLEARS the chip, exactly as thinkingVisible does",
  },
  {
    name: "blocked on a permission card",
    state: { phase: "awaiting_permission", activity: "awaiting_permission" },
    last: "tool_use",
    detail: "permission",
    why: "a human decision outranks what it was doing when it hit the gate",
  },
  {
    name: "posted, waiting on the other machine",
    state: { phase: "running", activity: "awaiting_peer" },
    last: "result",
    detail: "awaiting_peer",
  },
  {
    name: "a reply held for an Accept",
    state: { phase: "awaiting_inbound", activity: "awaiting_inbound" },
    last: "inbound_arrived",
    detail: "awaiting_inbound",
  },
];

for (const row of TABLE) {
  test(`DETAIL: ${row.name} -> ${row.detail === null ? "no detail" : row.detail}`, () => {
    assert.equal(m.detailFor(row.state, row.last, "working"), row.detail);
  });
}

test("DETAIL: every value the table can produce is in the declared vocabulary", () => {
  for (const row of TABLE) {
    if (row.detail === null) continue;
    assert.ok(
      m.DETAIL_KINDS.includes(row.detail),
      `${row.detail} is not in DETAIL_KINDS — the renderer maps that list and would draw nothing`
    );
  }
});

// ── 2. IT ONLY EVER SPEAKS OVER A WORKING PILL ───────────────────────────────────────
//
// ⚠ THE PROPERTY THAT KEEPS IT A REFINEMENT RATHER THAN A SECOND OPINION. A detail over an
// `idle` or `ended` pill is the two-readers-one-fact defect in miniature: the card would
// say "Idle" and "Thinking…" at once, and nothing would say which is right.

for (const pill of ["idle", "ended", "", null, undefined, "working "]) {
  test(`SCOPE: pill ${JSON.stringify(pill)} answers null whatever the last event was`, () => {
    for (const last of ["tool_use", "assistant", "outbound_post", "steer", undefined]) {
      assert.equal(m.detailFor({ phase: "running", activity: "working" }, last, pill), null);
    }
  });
}

test("SCOPE: a parked session reads idle and therefore has no detail", () => {
  // The pill is the caller's; `pillState` maps parked -> idle, so this is the shape that
  // reaches here. Stated explicitly because "parked" never appears in this module.
  assert.equal(m.detailFor({ phase: "parked", activity: "parked", parked: true }, "tool_use", "idle"), null);
});

test("SCOPE: an absent state over a working pill still answers, and answers thinking", () => {
  // A working pill means something IS running by construction, so the fallback leans the
  // opposite way from pillState's — which leans idle because it is guessing about whether
  // there is a session at all.
  assert.equal(m.detailFor(null, undefined, "working"), "thinking");
  assert.equal(m.detailFor(undefined, "nonsense-event", "working"), "thinking");
});

// ── 3. THE STAMP ─────────────────────────────────────────────────────────────────────

test("STAMP: noteEvent records the kind for a PASS-THROUGH event that changes no state", () => {
  // ⚠ THE WHOLE POINT. assistant / tool_use / tool_result are reducer pass-throughs — they
  // move no reducer state at all — and they are exactly the events that say what has been
  // RENDERED. A stamp taken from state changes alone would never see any of them.
  const s = {};
  m.noteEvent(s, { type: "assistant", payload: { type: "turn", text: "hi" } });
  assert.equal(s.lastEventKind, "assistant");
  m.noteEvent(s, { type: "tool_result", payload: { ok: true } });
  assert.equal(s.lastEventKind, "tool_result");
});

test("STAMP: a tool_use carries its tool label; a later non-tool event leaves it alone", () => {
  const s = {};
  m.noteEvent(s, { type: "tool_use", payload: { name: "Bash" } });
  assert.equal(s.lastToolLabel, "Bash");
  // The label is only MEANINGFUL under detail 'tool'; it is deliberately not cleared, so a
  // burst of tool_use -> tool_result -> tool_use does not blank the label mid-flight.
  m.noteEvent(s, { type: "tool_result" });
  assert.equal(s.lastToolLabel, "Bash");
  assert.equal(s.lastEventKind, "tool_result");
});

test("STAMP: it is inert on junk rather than throwing — it runs inside the SDK event loop", () => {
  const s = {};
  for (const junk of [null, undefined, {}, { type: 42 }, { type: null }]) {
    m.noteEvent(s, junk);
  }
  assert.equal(s.lastEventKind, undefined);
  m.noteEvent(null, { type: "assistant" }); // no session: must not throw
});

// ── 4. THE TOOL LABEL ────────────────────────────────────────────────────────────────

test("LABEL: an MCP name is shortened by the GATE's OWN normalizer, not a local regex", () => {
  // ⚠ F-139: `mcp__dopl__` is what OUR registration produces and is NOT what every client
  // produces — the connector and UUID server segments are both real. A second matcher here
  // would be a second answer to that question (INVARIANTS §11).
  assert.equal(m.toolLabel("mcp__dopl__dopl_channel"), "dopl_channel");
  assert.equal(m.toolLabel("mcp__claude_ai_Dopl__dopl_channel"), "dopl_channel");
  assert.equal(
    m.toolLabel("mcp__6a12c8bd-4187-40eb-9b21-eb230264f726__dopl_kb"),
    "dopl_kb"
  );
  // A bare built-in has no prefix and comes back unchanged.
  assert.equal(m.toolLabel("Read"), "Read");
});

test("LABEL: it agrees with mcpShortName by construction, on every form above", () => {
  for (const name of ["mcp__dopl__dopl_channel", "mcp__x__y", "Bash", "WebFetch"]) {
    assert.equal(m.toolLabel(name), mcpShortName(name));
  }
});

test("LABEL: bounded and one-line — it is display text on its way to a renderer", () => {
  const long = "a".repeat(200);
  assert.equal(m.toolLabel(long).length, m.TOOL_LABEL_CAP);
  assert.equal(m.toolLabel("two\nlines\there"), "two lines here");
});

test("LABEL: an absent or empty name is null, never an empty string", () => {
  // The renderer distinguishes "running a named tool" from "running a command"; an empty
  // string is truthy-adjacent enough to produce "Running " with nothing after it.
  for (const bad of [null, undefined, 42, {}, "", "   ", "mcp__dopl__"]) {
    assert.equal(m.toolLabel(bad), null);
  }
});
