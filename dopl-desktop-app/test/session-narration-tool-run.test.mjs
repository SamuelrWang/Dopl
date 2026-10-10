// THE RUN'S TOOL-USE ORDINAL (main/session-narration.js › stampToolRun) — regression for "the tool count
// went DOWN" (Samuel, 2026-10-10: it reached 105 and then decreased).
//
// WHY THE NUMBER CANNOT BE DERIVED ON THE READING SIDE. The ring evicts its oldest entries past either bound
// (`narration-ring.js`: `NARRATION_MAX` = 200 entries, `RING_CHAR_BUDGET` = 60k chars), and a tool use is TWO
// frames (the call and its result) — so a run longer than ~100 uses starts dropping its own head while it is
// still growing. The stream row recomputed its count from the frames it still held, so it counted down. The
// ordinal is therefore stamped at the APPEND, on the newest frames, which a ring never drops.
//
// Run: `node --test dopl-desktop-app/test/session-narration-tool-run.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const m = createRequire(import.meta.url)(join(MAIN, "session-narration.js"));
const ring = createRequire(import.meta.url)(join(MAIN, "narration-ring.js"));

const NOW = 1_700_000_000_000;
const tool = (i) => ({ at: NOW + i, kind: "tool", tool: "mcp__dopl__dopl_edit_object", text: "x" });
const result = (i) => ({ at: NOW + i, kind: "result", ok: true, text: "ok" });

// ── the stamp ─────────────────────────────────────────────────────────────────

test("a tool frame advances the run; its result carries the SAME ordinal", () => {
  const s = {};
  assert.equal(m.stampToolRun(s, tool(1)).runCount, 1);
  assert.equal(m.stampToolRun(s, result(2)).runCount, 1, "a call and its result are ONE use");
  assert.equal(m.stampToolRun(s, tool(3)).runCount, 2);
  assert.equal(m.stampToolRun(s, result(4)).runCount, 2);
});

test("any non-tool frame ENDS the run, mirroring the reader's run break", () => {
  const s = {};
  m.stampToolRun(s, tool(1));
  m.stampToolRun(s, tool(2));
  // `agent-stream-lanes.ts › LANE_BY_KIND` puts everything but `tool`/`result` outside the tool lane.
  for (const kind of ["assistant", "thinking", "post", "status", "operator", "private"]) {
    const sx = { toolRun: 7 };
    const out = m.stampToolRun(sx, { at: NOW, kind, text: "..." });
    assert.equal(out.runCount, undefined, `${kind} carries no ordinal`);
    assert.equal(sx.toolRun, 0, `${kind} resets the run`);
  }
  assert.equal(m.stampToolRun(s, { at: NOW, kind: "assistant", text: "done" }).runCount, undefined);
  assert.equal(m.stampToolRun(s, tool(4)).runCount, 1, "the next run starts from one");
});

test("a result with no run behind it carries NOTHING, never a zero", () => {
  const out = m.stampToolRun({}, result(1));
  assert.equal(out.runCount, undefined, "absent is the honest answer; 0 would read as a measurement");
});

test("the stamp never mutates the entry it was handed", () => {
  const entry = tool(1);
  const out = m.stampToolRun({}, entry);
  assert.equal(entry.runCount, undefined);
  assert.notEqual(out, entry);
});

// ── the property the defect was ───────────────────────────────────────────────

test("REGRESSION: the ordinal survives the ring evicting the head of a long run", () => {
  // 120 uses = 240 frames: past `NARRATION_MAX` (200), so the head is gone by construction.
  const s = {};
  const USES = 120;
  for (let i = 0; i < USES; i += 1) {
    ring.push(s, m.stampToolRun(s, tool(i * 2)));
    ring.push(s, m.stampToolRun(s, result(i * 2 + 1)));
  }
  const kept = m.ringFor(s);
  assert.ok(kept.length < USES * 2, "the ring did evict — otherwise this test proves nothing");

  // What the reading side used to do: count the frames it still holds. It is now SHORT.
  const counted = kept.filter((e) => !!e.tool).length;
  assert.ok(counted < USES, `the old derivation under-reports (${counted} < ${USES})`);

  // What it does now: the highest ordinal on a surviving frame, which is exact.
  const stamped = kept.reduce((max, e) => (typeof e.runCount === "number" && e.runCount > max ? e.runCount : max), 0);
  assert.equal(stamped, USES);
});

test("REGRESSION: the reported count never decreases as a run grows past the ring", () => {
  const s = {};
  let last = 0;
  for (let i = 0; i < 150; i += 1) {
    ring.push(s, m.stampToolRun(s, tool(i * 2)));
    ring.push(s, m.stampToolRun(s, result(i * 2 + 1)));
    const kept = m.ringFor(s);
    const named = kept.filter((e) => !!e.tool).length;
    const stamped = kept.reduce((max, e) => (typeof e.runCount === "number" && e.runCount > max ? e.runCount : max), 0);
    // The reader's rule: the larger of the two (`agent-stream-model.ts › toolUses`).
    const shown = Math.max(named, stamped);
    assert.ok(shown >= last, `count went backwards at use ${i + 1}: ${shown} after ${last}`);
    assert.equal(shown, i + 1, "and it is the run's real size, not merely non-decreasing");
    last = shown;
  }
});

// ── the append path uses it ───────────────────────────────────────────────────

test("`note` stamps through the real append path, and an ended line resets the run", () => {
  const s = { key: "c1:t1:a1" };
  m.note(s, { type: "tool_use", payload: { toolUseId: "u1", name: "Read", inputSummary: "{}" } });
  m.note(s, { type: "tool_result", payload: { toolUseId: "u1", ok: true, resultSummary: "ok" } });
  m.note(s, { type: "tool_use", payload: { toolUseId: "u2", name: "Read", inputSummary: "{}" } });
  const entries = m.ringFor(s);
  assert.deepEqual(
    entries.map((e) => e.runCount),
    [1, 1, 2]
  );
  m.noteEnded(s, { type: "ended", reason: "inactive" });
  assert.equal(s.toolRun, 0, "a status line ends the run");
});
