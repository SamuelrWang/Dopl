// THE NARRATION RING'S SECOND BOUND — CHARACTERS, NOT ENTRIES (regression: 17 GB dev RSS,
// 2026-08-30).
//
// ⚠ §2 SPLIT OUT OF `test/session-narration.test.mjs` ON 2026-08-31, under the §1 500-line cap.
// THE SEAM IS THE SUBJECT: that file is about WHAT A FRAME SAYS — which event becomes which kind,
// what is bounded, what never enters the ring. This one is about WHAT A FLUSH COSTS.
//
// THE PROPERTY, restated so this file stands alone: `flush()` sends the WHOLE ring per dirty
// session and `sendToWindows` structure-clones it into EVERY live window's message pipe, at up to
// 5 Hz — so a per-session ENTRY count is not a bound on anything that matters. `RING_CHAR_BUDGET`
// is, and what pays when a long line arrives is the OLDEST entries, never the newest line and
// never a silent mid-word cut.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

const MAIN = join(import.meta.dirname, "..", "main");
const m = createRequire(import.meta.url)(join(MAIN, "session-narration.js"));

const NOW = 1_700_000_000_000;

// ── 4. THE SECOND BOUND: CHARACTERS, NOT ENTRIES ─────────────────────────────────────
//
// REGRESSION: 17 GB dev RSS, 2026-08-30. `flush()` sends the WHOLE ring per dirty session,
// `sendToWindows` clones it into EVERY live window's message pipe (up to nine), and `note()`
// marks a session dirty on EVERY SDK event — so the feed re-serializes at up to 5 Hz per
// session per window, into NATIVE memory (no GC pressure, nothing in a heap snapshot, no
// backpressure from a renderer slow to drain). `PROSE_CAP` rose 300 → 2000 on 2026-08-27,
// taking the per-flush ceiling from 60k chars to 400k; that constant's note did the SIZE
// arithmetic and named the two acceptable fixes, but accounted for neither the FAN-OUT nor the
// RATE. RING_CHAR_BUDGET restores the pre-2026-08-27 ceiling WITHOUT undoing PROSE_CAP: a long
// line still arrives whole, never cut mid-word — what pays is the OLDEST ENTRIES.

test("BOUND: the char budget is exactly the pre-PROSE_CAP ceiling (NARRATION_MAX × TEXT_CAP)", () => {
  // ⚠ THE NUMBER IS DERIVED, NOT CHOSEN. If this ever drifts, the comment explaining
  // where 60_000 came from has stopped being true.
  assert.equal(m.RING_CHAR_BUDGET, m.NARRATION_MAX * m.TEXT_CAP);
  assert.equal(m.RING_CHAR_BUDGET, 60_000);
});

test("BOUND: a ring of maximal PROSE_CAP lines stays under the budget", () => {
  const s = { key: "c:t:a" };
  const long = "x".repeat(m.PROSE_CAP);
  for (let i = 0; i < m.NARRATION_MAX * 2; i++) {
    m.push(s, { at: NOW + i, kind: "assistant", text: long });
  }
  const chars = s.narration.reduce(
    (n, e) => n + e.text.length + m.ENTRY_OVERHEAD_CHARS,
    0
  );
  assert.ok(chars <= m.RING_CHAR_BUDGET, `ring is ${chars} chars, budget is ${m.RING_CHAR_BUDGET}`);
  assert.ok(s.narration.length <= m.NARRATION_MAX, "the entry bound still holds too");
  // ⚠ AND THE PAYLOAD IS WHAT SHRANK — this is the number that used to reach every window
  // five times a second. Before the budget it was NARRATION_MAX × PROSE_CAP.
  assert.ok(
    JSON.stringify(m.ringFor(s)).length < m.NARRATION_MAX * m.PROSE_CAP,
    "the flushed payload must be smaller than the old unbounded-by-chars ceiling"
  );
});

test("BOUND: what pays is the OLDEST entries — the newest line is never truncated", () => {
  const s = { key: "c:t:a" };
  const long = "y".repeat(m.PROSE_CAP);
  for (let i = 0; i < 100; i++) m.push(s, { at: NOW + i, kind: "assistant", text: long });
  const last = s.narration[s.narration.length - 1];
  assert.equal(last.text.length, m.PROSE_CAP, "the newest entry keeps its full PROSE_CAP text");
  assert.equal(last.at, NOW + 99, "and it is the most recent one, not an older survivor");
  // No entry is ever rewritten — eviction is whole-entry, never a mid-word cut (the thing
  // Samuel's 2026-08-27 ruling deleted).
  for (const e of s.narration) assert.equal(e.text.length, m.PROSE_CAP);
});

test("BOUND: a single over-budget entry survives alone — the budget bounds a BACKLOG", () => {
  const s = { key: "c:t:a" };
  m.push(s, { at: NOW, kind: "assistant", text: "z".repeat(m.RING_CHAR_BUDGET * 2) });
  assert.equal(s.narration.length, 1, "the present is never evicted, only the backlog");
  assert.equal(s.narration[0].text.length, m.RING_CHAR_BUDGET * 2, "and it is not truncated");
});

test("BOUND: a ring of short captions is untouched — the budget is a ceiling, not a retune", () => {
  const s = { key: "c:t:a" };
  for (let i = 0; i < m.NARRATION_MAX; i++) {
    m.push(s, { at: NOW + i, kind: "result", ok: true, text: "ok" });
  }
  assert.equal(s.narration.length, m.NARRATION_MAX, "a realistic ring still holds the full 200");
});
