"use client";

import { useEffect, useRef } from "react";
// ⚠ THE MISS PATH IS A PURE FUNCTION so it can be tested without mounting the
// surface — see its docblock for the silent-return bug that bought it.
import { citationScrollTargetId } from "../lib/message-refs";

/**
 * 🔒 **A CITATION PILL'S JUMP — THE HOST HALF OF THE FACE/ADDRESS CONTRACT**
 * (2026-09-15, finishing a553a9ff).
 *
 * ⚠ **THE PILL HANDS UP A SEQ AND THIS RESOLVES IT TO A MESSAGE ID.** The number
 * is the FACE a reader typed and read; the id is the ADDRESS the transcript
 * moves to. Nothing below this line navigates by number, which is what keeps the
 * feature correct whichever way the per-channel numbering ruling goes — a seq is
 * only ever resolved against the rows THIS surface is holding, never used as a
 * global coordinate.
 *
 * ⚠ **IT LIVES HERE BECAUSE THIS IS THE ONE PLACE THAT HOLDS BOTH HALVES**: the
 * loaded page (`rows`) and the scroll state (`sel.jumpToMessage`, the nonced
 * signal `use-channels-selection.ts` owns). `message-pane.tsx` has the rows and
 * could resolve — but its jump would have nowhere to land, and a second resolver
 * is a second answer to "which message is #1759" for the two to disagree over.
 *
 * 🔒 **A MISS STILL FIRES THE SIGNAL, AND THAT IS A CORRECTION TO THIS
 * FUNCTION'S FIRST CUT (2026-09-15).** It used to `return` when the seq was not
 * among the loaded rows, on the reasoning that the pane's
 * `SCROLL_TARGET_MISSING_NOTE` would explain the miss. **It cannot**: that notice
 * is derived from a LIVE scroll target whose id matches nothing
 * (`message-pane.tsx › missing`), so a bare return set no target, left `live`
 * false, and the click did nothing at all — no scroll, no sentence, no error.
 * A control that silently does nothing is the exact failure this feature was
 * built to refuse, and it had been reintroduced one layer above the pill.
 *
 * ⚠ **SO A MISS SENDS A TARGET THAT CANNOT MATCH, WHICH IS THE HONEST SHAPE.**
 * The pill's gate already proved the seq is one this channel could hold, so a
 * miss means the message is real and simply not in the loaded window — which is
 * precisely the state the Tags inbox reaches when its mention is older than the
 * page, and it reuses that exact notice rather than minting a second one.
 * ⚠ **THE SENTINEL IS NOT A MESSAGE ID AND MUST NEVER BE READ AS ONE.** It is
 * compared against `row.id` and used in one `[data-message-id]` DOM query, both
 * of which simply fail to match — the same behaviour a real-but-unloaded id
 * produces. Anything that starts treating `ScrollTarget.messageId` as a
 * guaranteed-real id has to account for this case first.
 * ⚠ **THE NOTICE'S WORDING IS RIGHT FOR THE COMMON MISS AND LOOSE FOR ONE
 * OTHER**: a cited message that lives inside a THREAD is not in the channel
 * view's rows either, and reads as "older than the loaded history" when it is
 * merely elsewhere. Still true that the transcript did not move, so it beats
 * silence — but it is the next thing to sharpen if citations across threads
 * become common.
 *
 * ⚠ **THE THREAD ARGUMENT IS THE VIEW WE ARE IN**, so a jump inside the channel
 * view stays in the channel view and one inside a thread stays in that thread.
 * These rows ARE that view's rows; passing anything else would re-point the
 * surface at a thread the reader never asked for.
 */

/**
 * 🔒 **AND THE SAME MECHANISM IS HOW A SEARCH HIT LANDS ON ITS MESSAGE (F-714,
 * 2026-09-17).** `GET /api/search` returns a message row carrying `seq`
 * (`search/contracts.ts › SearchItem`) and Samuel's ruling for the row is
 * *"open channel at that seq so the transcript jumps"* — but a HOST holds only a
 * channel id and a number, and the resolver above needs the loaded page, which
 * only the surface has.
 *
 * ⚠ **SO THE HOST PASSES AN INITIAL SEQ AND THIS FIRES THE EXISTING SIGNAL
 * ONCE THE TRANSCRIPT HAS ROWS — IT IS NOT A SECOND JUMP.** A citation pill, a
 * Tags-inbox mention and a search hit all end at `sel.jumpToMessage`, so there
 * is one answer to "which message is this" and one nonced scroll target for them
 * to share. **The \"older than the loaded history\" notice comes free**, because a
 * miss here takes the very same sentinel path a pill's miss takes.
 *
 * ⚠ **IT WAITS FOR ROWS AND THAT WAIT IS THE WHOLE HOOK.** Firing against an
 * empty page resolves every seq to a miss, so a search hit would land on the
 * notice rather than on the message — which is indistinguishable, to the reader,
 * from the bug this closes.
 *
 * ⚠ **ONCE PER (CHANNEL, THREAD, SEQ), KEYED RATHER THAN A BARE BOOLEAN.** The
 * page grows as older history loads and the rows identity changes on every
 * refetch; a `fired` flag would re-jump on each one and yank a reader who has
 * scrolled away. The thread is IN the key because a hit that names one arrives
 * as two host moves — select the channel, open the thread — and the seq belongs
 * to the second view.
 */
export function useMessageJump({
  rows,
  openThreadId,
  initialSeq = null,
  channelId,
  jumpToMessage,
}: {
  /** The loaded page of the view we are in — channel or thread. ⚠ Structural,
   *  exactly as `citationScrollTargetId` takes it: this hook resolves, it does
   *  not render, so it needs two fields and not a DTO. */
  rows: ReadonlyArray<{ id: string; seq: number }>;
  openThreadId: string | null;
  /** A seq to land on at mount, from a host that has one. `null` is every other
   *  mount, byte for byte. */
  initialSeq?: number | null;
  channelId: string;
  /** The selection hook's nonced signal — `use-channels-selection.ts`. */
  jumpToMessage: (threadId: string | null, messageId: string) => void;
}): (seq: number) => void {
  const jumpToSeq = (seq: number) => {
    jumpToMessage(openThreadId, citationScrollTargetId(rows, seq));
  };

  const firedFor = useRef<string | null>(null);
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (initialSeq == null || !hasRows) return;
    const key = `${channelId}:${openThreadId ?? ""}:${initialSeq}`;
    if (firedFor.current === key) return;
    firedFor.current = key;
    jumpToMessage(openThreadId, citationScrollTargetId(rows, initialSeq));
    // ⚠ `rows` IS NOT A DEPENDENCY AND `hasRows` IS. The array identity changes
    // on every refetch; what this effect is waiting for is the transition from
    // "no page yet" to "a page", and the key above is what stops a second run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSeq, hasRows, channelId, openThreadId, jumpToMessage]);

  return jumpToSeq;
}
