// THE NARRATION RING’S TWO BOUNDS AND ITS ONE APPEND — §2 SPLIT out of `session-narration.js`
// (2026-09-14, the 500-line cap). Pure, requires nothing, and every name is re-exported from
// that file unchanged, so no caller and no test moved.

// The per-session ring. See the header for the arithmetic; 200 is roughly an hour of a
// busy agent and comfortably more than a human scrolls back through.
const NARRATION_MAX = 200;

/**
 * THE RING'S SECOND BOUND — CHARACTERS, NOT ENTRIES (2026-08-30, the 17 GB dev incident).
 *
 * ⚠ THE BUG. `flush()` sends the WHOLE ring for each dirty session, `sendToWindows` fans that
 * payload out to EVERY live window, and `note()` marks a session dirty on EVERY SDK event — so
 * the feed re-serializes the entire ring at up to `1000 / PUSH_COALESCE_MS` = 5 Hz, per session,
 * per window. `webContents.send` STRUCTURE-CLONES its payload into a Mojo message pipe, which is
 * NATIVE memory: it exerts no GC pressure, it shows up in RSS and not in a heap snapshot, and a
 * renderer that is slow to drain (a dev renderer under HMR, one mid-refetch-storm, one with
 * DevTools attached) queues it with no backpressure whatsoever.
 *
 * ⚠ WHAT MADE IT AN INCIDENT RATHER THAN A COST. `PROSE_CAP` rose 300 → 2000 on 2026-08-27, and
 * that constant's own note does the arithmetic — "the worst case rises from 200 × 300 = 60k to
 * 200 × 2000 = 400k chars per session per flush". What the note leaves out is the FAN-OUT: the
 * payload is cloned once per live window, and there can be nine (the SPA plus
 * `popout-window.js › MAX_POPOUTS` plus `agent-window.js › MAX_AGENT_TABS`). 400k × 6
 * sessions × 9 windows × 5 Hz is a rate, not a size, and nothing in this file bounded a rate.
 * That note ALSO named the two acceptable fixes — "tighten `NARRATION_MAX` or send a delta
 * instead of the ring" — and this is the first of them, generalized.
 *
 * ⚠ 60_000 IS EXACTLY THE PRE-2026-08-27 CEILING (200 × `TEXT_CAP`), and that is the whole
 * argument for the number. It restores the byte ceiling the feed was designed around WITHOUT
 * undoing `PROSE_CAP`: a long line still arrives WHOLE, never cut mid-word, never cut silently
 * — it simply costs more of the ring, so what pays is the OLDEST ENTRIES, which is what a ring
 * is for. **Do not "fix" a future over-run by lowering `PROSE_CAP`. That reintroduces the silent
 * cut Samuel's 2026-08-27 ruling deleted; lower this, or send a delta.**
 *
 * Pinned by test/session-narration.test.mjs (regression: 17 GB dev RSS, 2026-08-30).
 */
const RING_CHAR_BUDGET = 60_000;

/** Per-entry overhead beyond `text` — `at` / `kind` / `lane` / `toolUseId` / `tool` / `ok` /
 *  `pending` and their JSON punctuation. Approximate ON PURPOSE: the budget is a ceiling on a
 *  wire payload, not an accounting record, and a fixed charge per entry is what stops 200
 *  empty-text frames from being free. */
const ENTRY_OVERHEAD_CHARS = 64;

function entryChars(entry) {
  const text = entry && typeof entry.text === 'string' ? entry.text.length : 0;
  return text + ENTRY_OVERHEAD_CHARS;
}

/**
 * Append to a session's ring, dropping the oldest past EITHER bound. Returns the ring.
 *
 * ⚠ TWO BOUNDS, AND THE SECOND IS THE ONE THAT MATTERS FOR MEMORY. `NARRATION_MAX` bounds how
 * far back a watcher can scroll; `RING_CHAR_BUDGET` bounds what `flush()` re-serializes to every
 * window five times a second. See `RING_CHAR_BUDGET`'s note.
 * ⚠ THE LAST ENTRY IS NEVER DROPPED, even alone over budget: a single maximal `PROSE_CAP` line
 * must still reach the window it was widened for. The budget bounds a BACKLOG, never the present.
 */
function push(s, entry) {
  if (!s.narration) s.narration = [];
  s.narration.push(entry);
  if (s.narration.length > NARRATION_MAX) {
    s.narration = s.narration.slice(s.narration.length - NARRATION_MAX);
  }
  let chars = 0;
  for (const e of s.narration) chars += entryChars(e);
  let drop = 0;
  while (drop < s.narration.length - 1 && chars > RING_CHAR_BUDGET) {
    chars -= entryChars(s.narration[drop]);
    drop += 1;
  }
  if (drop > 0) s.narration = s.narration.slice(drop);
  return s.narration;
}

module.exports = { NARRATION_MAX, RING_CHAR_BUDGET, ENTRY_OVERHEAD_CHARS, entryChars, push };
