/**
 * **HOW BIG A TRANSCRIPT PAGE IS, MEASURED IN LINES RATHER THAN IN ROWS**
 * (2026-09-08, Samuel: *"chunks shouldnt be by messages. Because a message can
 * be like 20 lines or it can be 2 lines. So we should chunk by lines instead …
 * lets do 300 as the line chunk."*).
 *
 * ⚠ **PURE, AND CLIENT- AND SERVER-SAFE ON PURPOSE — no `server-only` here.**
 * The service trims the page with {@link takeLineBudget} and the client tests
 * the same estimator; a second implementation on either side is how "300 lines"
 * comes to mean two different things.
 *
 * ⚠ **THIS IS AN ESTIMATE FOR PAGING AND FOR NOTHING ELSE. NEVER RENDER FROM
 * IT.** It knows nothing about the reader's column width, the font, the
 * attribution pill, an artifact card, or a markdown table; it exists so that one
 * page of history is roughly one page of history whether the channel is a
 * hundred two-line acknowledgements or four agent dumps. A layout decided from
 * this number would be wrong in a way nothing measures.
 */

/**
 * Characters per rendered line. ⚠ **A CONSTANT, NOT A MEASUREMENT** — the
 * transcript column is fluid and the reader's window is not ours to know. 80 is
 * the conventional wrap width and it is deliberately generous: over-estimating
 * a line makes pages SHORTER, which costs one extra fetch; under-estimating
 * makes them longer, which is the paint this whole change exists to bound.
 */
const CHARS_PER_LINE = 80;

/** A fenced code block opens and closes on a line whose first non-space run is
 *  three backticks or three tildes. */
const FENCE = /^\s*(?:```|~~~)/;

/**
 * **ESTIMATED RENDERED LINES FOR ONE MESSAGE BODY** (2026-09-08).
 *
 * The formula, stated once so a reader never has to infer it from the loop:
 *
 *   sum over PHYSICAL lines of `max(1, ceil(chars / 80))`, and at least 1 for
 *   the whole message.
 *
 * ⚠ **A LINE INSIDE A FENCED CODE BLOCK COUNTS 1, VERBATIM, HOWEVER LONG IT
 * IS.** Prose soft-wraps and a 240-character paragraph really is three lines on
 * screen; a `<pre>` does not wrap, so a 240-character command is one line with a
 * scrollbar under it. Dividing code by 80 would let a single pasted log claim
 * the whole budget and hand the reader a page of one message.
 *
 * ⚠ **AN EMPTY BODY IS 1, NOT 0.** Every message occupies a row, and a page of
 * empty bodies that summed to zero would never reach any budget — i.e. the row
 * cap would be the only bound left, silently.
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
 * `rows` is ASCENDING by `seq`, exactly as `repository-messages.ts ›
 * listMessages` returns a NEWEST or a `before` page, and the kept page is a
 * SUFFIX of it — the newest rows in the block. That is what keeps the keyset
 * cursor honest: the caller's next `before` is the OLDEST RETURNED row, and
 * everything this function dropped sits strictly below it, so page N+1 picks up
 * exactly where page N stopped and nothing is skipped.
 *
 * ⚠ **AT LEAST ONE ROW, ALWAYS.** A single message longer than the whole budget
 * is a page of one message, never a page of none — an empty page would latch the
 * client's `exhausted` and hide every older message in the channel behind a
 * message that happens to be long.
 *
 * ⚠ **`hasMore` IS THE SERVER'S ANSWER AND THE CLIENT MUST NOT RE-DERIVE IT.**
 * A line-budgeted page is SHORT BY DESIGN, so the old `rows.length === pageSize`
 * test — the one every paged list reaches for — reads "exhausted" on the very
 * first page of a channel of long messages. Two things make it true here, and
 * both have to:
 *   1. the budget dropped rows the query returned (`kept < rows`), or
 *   2. the query came back AT its own ceiling, which is indistinguishable from
 *      over it — the same rule `constants.ts › CHANNEL_THREAD_LIST_LIMIT` and
 *      `service-reads.ts › listChannelTasks` already apply to `truncated`.
 * Case 2 costs at most one extra fetch that comes back short and settles the
 * question; the opposite error hides history, which INVARIANTS §9 does not let
 * a bounded read do.
 *
 * `budget` of `undefined` means "no budget asked for" — every row is kept and
 * only rule 2 decides `hasMore`. That is the MCP / desktop / await path, which
 * pages by rows and is deliberately untouched by this change.
 */
export function takeLineBudget<T extends { body: string }>(
  rows: readonly T[],
  limit: number,
  budget: number | undefined
): { rows: T[]; hasMore: boolean } {
  const atCeiling = rows.length >= limit;
  if (budget === undefined) return { rows: [...rows], hasMore: atCeiling };
  let lines = 0;
  // ⚠ FROM THE NEWEST END BACKWARDS. The page the reader wants is the newest
  // one in the block; walking forwards would keep the oldest rows and hand the
  // scroll-up a page it has already read.
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
