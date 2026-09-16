/**
 * **A MESSAGE REFERENCE IN A BODY — `#1759`, `seq 1759`** (Samuel, 2026-09-15).
 *
 * Agents cite each other's posts by `seq` constantly in this product ("re #1759",
 * "see #1800"), and a reader had to scroll and count. This is the one place that
 * decides what counts as a citation; `message-markdown-refs.tsx` renders it.
 *
 * ⚠ **CONSERVATIVE BY CONSTRUCTION, BECAUSE A FALSE POSITIVE IS WORSE THAN A
 * MISS.** A pill that jumps nowhere teaches the reader to distrust every pill; a
 * plain number that could have been a pill costs them one scroll. So the pattern
 * refuses everything it cannot argue for:
 *   • **2+ DIGITS.** `#1` is a list item, a rank, a jersey. Channel seqs are
 *     table-wide and four digits by the time anyone cites one.
 *   • **NO LETTER OR `#` BEFORE THE HASH**, so `#fff`, `##2` and a markdown
 *     heading's `#` cannot open one, and `a#12` is not a citation.
 *   • **NO WORD CHARACTER AND NO DECIMAL TAIL AFTER THE DIGITS**, so `#1759x` and
 *     `#17.59` are left alone — a run that continues is not a seq, and a version
 *     number is the case that actually bit: `(?!\w)` alone matched the `#17`.
 *   • **`seq` MUST BE THE WHOLE WORD**, case-insensitive, one space: `seq 1759`.
 *     `sequence 1759` is prose about sequences.
 *
 * ⚠ **AND THE PATTERN IS NOT THE LAST GATE.** Matching only makes a candidate;
 * the renderer still refuses to draw a pill for a seq this channel cannot have
 * (`isCitableSeq`). Two cheap gates in series is what keeps "1200 people" —
 * written as `#1200` by someone — from becoming a dead link.
 *
 * ⚠ **CAPTURING SPLIT.** The regex carries ONE capture group so `String.split`
 * keeps the tokens in the output array, which is exactly the shape
 * `lib/mentions.ts › MENTION_TOKEN_RE` produces and the leaf already walks.
 */

/**
 * The citation token, as a splitting pattern. ⚠ `g` is deliberate and the flag
 * is the reason this is a `const` rather than inline: a `lastIndex` carried
 * between calls is the classic shared-regex bug, and `split` is stateless with
 * respect to it.
 */
export const MESSAGE_REF_TOKEN_RE =
  /((?<![\w#])#\d{2,}(?!\w|\.\d)|(?<![\w])seq \d{2,}(?!\w|\.\d))/gi;

/**
 * The seq a token names, or `null` when the string is not one.
 *
 * ⚠ ANCHORED. The split above hands back both matched tokens and the plain text
 * between them, and an unanchored read would find a number inside ordinary prose
 * that the pattern deliberately declined to match.
 */
export function messageRefSeq(token: string): number | null {
  const m = /^(?:#|seq )(\d{2,})$/i.exec(token.trim());
  if (m === null) return null;
  const seq = Number(m[1]);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null;
}

/**
 * **IS THIS SEQ SOMETHING THIS CHANNEL COULD HOLD** — the second gate.
 *
 * ⚠ **`newestSeq` IS THE CEILING AND IT IS THE WHOLE POINT.** `seq` is
 * table-wide and monotonic (INVARIANTS §5), so a citation above the newest row
 * the reader has names a message that does not exist yet — a typo, or a number
 * that was never a seq. Those render as plain text.
 *
 * ⚠ **THERE IS NO FLOOR BEYOND `> 0`, DELIBERATELY.** An OLD seq is the normal
 * case for a citation and is usually outside the loaded window; refusing what is
 * not currently on screen would make the feature work only where it is least
 * needed.
 *
 * ⚠ **`null` NEWEST MEANS "CANNOT SAY", AND NOTHING IS DRAWN** — a pane that has
 * not loaded a page yet knows no ceiling, and guessing one would draw pills it
 * cannot stand behind (INVARIANTS §11).
 */
export function isCitableSeq(seq: number, newestSeq: number | null): boolean {
  return newestSeq !== null && seq > 0 && seq <= newestSeq;
}

/**
 * **WHICH MESSAGE A CITATION SHOULD SCROLL TO, INCLUDING WHEN THERE ISN'T ONE**
 * (2026-09-15) — the host's half of the pill, as a pure function.
 *
 * ⚠ **IT ALWAYS RETURNS A TARGET, AND THAT IS THE WHOLE REASON IT EXISTS.** The
 * first cut of `channel-surface.tsx › jumpToSeq` returned early when the seq was
 * not in the loaded rows, expecting the pane's `SCROLL_TARGET_MISSING_NOTE` to
 * explain the miss. It cannot: that notice is derived from a LIVE scroll target
 * that matches nothing (`message-pane.tsx › missing`), so returning early set no
 * target and the click did nothing whatsoever — no scroll, no sentence. **A
 * citation pill that silently does nothing is the precise failure this feature
 * was built to refuse**, so the miss has to travel rather than be swallowed.
 *
 * ⚠ **THE MISS SENTINEL IS NOT A MESSAGE ID.** `seq:<n>` cannot collide with a
 * real id and is only ever compared against `row.id` / queried as
 * `[data-message-id]`, both of which simply fail to match — exactly what a real
 * but unloaded id does. Nothing may start treating `ScrollTarget.messageId` as a
 * guaranteed-real id without handling this case first.
 * ⚠ **A MISS IS NOT AN ERROR.** `isCitableSeq` already proved the seq is one this
 * channel could hold, so "not in `rows`" means the message is real and simply
 * outside the loaded window — the same state a Tags-inbox mention reaches when it
 * is older than the page, and it reuses that notice rather than minting a second.
 *
 * Pure and exported so the miss path is testable without mounting a surface —
 * which is what let the silent-return bug exist behind a green suite.
 */
export function citationScrollTargetId(
  rows: ReadonlyArray<{ id: string; seq: number }>,
  seq: number
): string {
  return rows.find((row) => row.seq === seq)?.id ?? `seq:${seq}`;
}
