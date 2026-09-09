/**
 * **HOW BIG A TRANSCRIPT PAGE IS, MEASURED IN LINES RATHER THAN IN ROWS**
 * (2026-09-08, Samuel: *"chunks shouldnt be by messages. Because a message can
 * be like 20 lines or it can be 2 lines. So we should chunk by lines instead …
 * lets do 300 as the line chunk."*).
 *
 * ⚠ **PURE, AND CLIENT- AND SERVER-SAFE ON PURPOSE — no `server-only` here.** The
 * service trims with {@link takeLineBudget} and the client tests the same
 * estimator; a second implementation is how "300 lines" comes to mean two things.
 *
 * ⚠ **AN ESTIMATE FOR PAGING AND FOR NOTHING ELSE. NEVER RENDER FROM IT.** It
 * knows nothing about column width, font, the attribution pill, an artifact card
 * or a markdown table; it exists so one page of history is roughly one page
 * whether the channel is a hundred acknowledgements or four agent dumps.
 */

/**
 * Characters per rendered line. ⚠ **A CONSTANT, NOT A MEASUREMENT** — the
 * transcript column is fluid and the reader's window is not ours to know. 80 is
 * deliberately generous: over-estimating makes pages SHORTER, costing one extra
 * fetch; under-estimating makes them longer, which is the paint this bounds.
 */
const CHARS_PER_LINE = 80;

/** A fenced code block opens and closes on a line whose first non-space run is
 *  three backticks or three tildes. */
const FENCE = /^\s*(?:```|~~~)/;

/**
 * **ESTIMATED RENDERED LINES FOR ONE MESSAGE BODY** (2026-09-08). The formula:
 * sum over PHYSICAL lines of `max(1, ceil(chars / 80))`, at least 1 per message.
 *
 * ⚠ **A LINE INSIDE A FENCED CODE BLOCK COUNTS 1, VERBATIM, HOWEVER LONG IT IS.**
 * A `<pre>` does not wrap, so a 240-character command is one line with a
 * scrollbar; dividing code by 80 would let one pasted log claim the whole budget.
 *
 * ⚠ **AN EMPTY BODY IS 1, NOT 0.** Every message occupies a row, and a page of
 * empty bodies summing to zero would leave the row cap as the only bound.
 */
export function estimateMessageLines(body: string): number {
  let total = 0;
  let inFence = false;
  for (const line of body.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      total += 1;
      continue;
    }
    total += inFence ? 1 : Math.max(1, Math.ceil(line.length / CHARS_PER_LINE));
  }
  return Math.max(1, total);
}

/**
 * **THE TRIM: one fetched block of rows → the page the UI actually gets, plus
 * whether more exists past it** (2026-09-08).
 *
 * `rows` is ASCENDING by `seq` (`repository-messages.ts › listMessages`) and the
 * kept page is a SUFFIX of it — the newest rows in the block. That keeps the
 * keyset cursor honest: the caller's next `before` is the OLDEST RETURNED row and
 * everything dropped sits strictly below it, so page N+1 skips nothing.
 *
 * ⚠ **AT LEAST ONE ROW, ALWAYS.** An empty page would latch the client's
 * `exhausted` and hide every older message behind one long message.
 *
 * ⚠ **`hasMore` IS THE SERVER'S ANSWER AND THE CLIENT MUST NOT RE-DERIVE IT.** A
 * line-budgeted page is SHORT BY DESIGN, so `rows.length === pageSize` reads
 * "exhausted" on the first page of a channel of long messages. Two things make it
 * true here, and both have to:
 *   1. the budget dropped rows the query returned (`kept < rows`), or
 *   2. the query came back AT its own ceiling, which is indistinguishable from
 *      over it — the rule `service-reads.ts › listChannelTasks` already applies
 *      to `truncated`.
 * Case 2 costs at most one extra fetch; the opposite error hides history, which
 * INVARIANTS §9 does not let a bounded read do.
 *
 * `budget` of `undefined` keeps every row and lets only rule 2 decide `hasMore` —
 * the MCP / desktop / await path, which pages by rows and is untouched here.
 */
export function takeLineBudget<T extends { body: string }>(
  rows: readonly T[],
  limit: number,
  budget: number | undefined
): { rows: T[]; hasMore: boolean } {
  const atCeiling = rows.length >= limit;
  if (budget === undefined) return { rows: [...rows], hasMore: atCeiling };
  let lines = 0;
  // ⚠ FROM THE NEWEST END BACKWARDS: walking forwards would keep the oldest rows
  // and hand the scroll-up a page it has already read.
  let start = rows.length;
  while (start > 0) {
    const next = start - 1;
    // The FIRST row taken is unconditional — that is the at-least-one rule.
    if (start < rows.length && lines >= budget) break;
    lines += estimateMessageLines(rows[next].body);
    start = next;
  }
  const kept = rows.slice(start);
  return { rows: kept, hasMore: atCeiling || kept.length < rows.length };
}
