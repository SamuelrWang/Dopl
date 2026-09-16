"use client";

/**
 * THE FOUR GRAY RECENCY WELLS — **Recent / Last 7 days / Last 30 days /
 * Earlier**, each one collapsible, each holding whatever white cards or rows the
 * caller hands it, filed by ONE timestamp per item.
 *
 * ⚠ **THE BOX ITSELF IS `collapse-wells.tsx` SINCE 2026-09-15, AND THIS FILE IS
 * NOW THE TIME MODEL ALONE** — the four spans, {@link wellFor}, and the
 * `at`-shaped item the two tabs hand in. A THIRD surface (/home's channel list)
 * wanted the box with a well set that is not these spans at all, and the machinery
 * could not be generalised in the file that also owns the calendar.
 *
 * 🔒 **SAMUEL, 2026-09-13, over the Agents tab:** *"On the overview page we see
 * that gray background thing. I like that gray background right behind the white
 * pane. … Each one will have a header that says Recent. Inside that little area
 * we're going to have all the agents that were active in the last 24 hours …
 * Below that would be another one … last seven days … and then under that would
 * be like last thirty days … And then one more that says like earlier … I want
 * these gray boxes to be collapsible. … the title of the text on the left. The
 * right side, add like an arrow, like a down arrow and like a right arrow … down
 * arrow if it's been opened up, and … a right arrow if it is collapsed. … the
 * header … font size and font styling, it should be the same as … the credit
 * spend."*
 *
 * 🔒 **AND OVER THE THREADS TAB THE SAME DAY:** *"for the threads page/tab, I
 * want you to add the same gray backgrounds that we added to the Agents tab.
 * Basically, Recent, last 7 days, etc. This should be measured on activity
 * (basically, last message sent into the thread)."* **THE SECOND SURFACE IS WHY
 * THIS MODULE EXISTS.** It was `agents-wells.tsx` in full until that ruling; the
 * machinery moved here and that file became a thin consumer, so the two surfaces
 * cannot drift in geometry, in motion, or in what a missing stamp means. Each
 * consumer keeps only (a) the expression that dates ITS rows and (b) its own
 * `localStorage` key.
 *
 * ⚠ **A BUCKET IS ABOUT TIME, NEVER ABOUT STATE.** Nothing here reads a status,
 * a liveness or a mode, and nothing here may start to — an ended agent and a
 * quiet thread sit in whichever well their last activity falls in, which is the
 * whole of Samuel's *"if it's an ended agent but they were active last thirty
 * days … that should be in … the respective gray boxes"*. State is already said
 * on the card, and saying it twice, once as a heading, is how the two come to
 * disagree.
 */

import { useMemo, type ReactNode } from "react";
import { WellsColumn, type WellItem } from "./collapse-wells";

const DAY_MS = 86_400_000;

/** The four wells, in the order Samuel dictated them. ⚠ ORDER IS THE DATA — the
 *  render maps this array, so there is no second list to keep in step.
 *  ⚠ **RECENT OPEN, THE OTHER THREE COLLAPSED** — Samuel's default, and since
 *  2026-09-15 it is stated HERE, on the set, rather than in a hard-coded map the
 *  machinery held: a second well set has its own answer (/home opens two). */
export const RECENCY_WELLS = [
  { id: "recent", label: "Recent", maxAgeMs: DAY_MS, defaultOpen: true },
  { id: "week", label: "Last 7 days", maxAgeMs: 7 * DAY_MS, defaultOpen: false },
  {
    id: "month",
    label: "Last 30 days",
    maxAgeMs: 30 * DAY_MS,
    defaultOpen: false,
  },
  // ⚠ THE LAST WELL HAS NO CEILING, which is what makes the buckets exhaustive:
  // every item lands in exactly one, so none can be dropped by arithmetic.
  {
    id: "earlier",
    label: "Earlier",
    maxAgeMs: Number.POSITIVE_INFINITY,
    defaultOpen: false,
  },
] as const;

export type RecencyWellId = (typeof RECENCY_WELLS)[number]["id"];

/**
 * WHICH WELL A STAMP FALLS IN.
 *
 * ⚠ **UNKNOWN LANDS IN `recent`, AND THE DIRECTION IS THE POINT.** `recent` is the
 * one well open by default, so an item this build cannot date stays VISIBLE; the
 * alternative buries a live agent — or a thread whose activity this read did not
 * derive — inside a collapsed **Earlier** on the strength of a field that is
 * simply absent. An absence must never make a row harder to find (INVARIANTS §11
 * — UNKNOWN is not EMPTY).
 * ⚠ **A FUTURE STAMP IS ALSO `recent`** — clock skew between a machine and this
 * renderer is ordinary, and a negative age is not evidence of anything.
 *
 * ⚠ **THE CLOCK'S DEFAULT LIVES HERE, ON THE PURE FUNCTION** — the shape
 * `agents-model.ts › peerRowStale` already holds, and it is not cosmetic: a
 * `now = Date.now()` default on the COMPONENT is an impure call during render
 * (`react-hooks/purity`), while a test that wants to state an age passes one.
 *
 * ⚠ **IT IS THE APP'S ONE "IS THIS RECENT" CUT AND HAS A THIRD READER SINCE
 * 2026-09-15** — /home's channel list asks it for Samuel's *"channels with
 * activity in the last 24 hours"* rather than declaring a second 24h constant
 * (`pages/home/channel-wells.ts › channelWellOf`). The day the span moves it
 * moves for all three.
 */
export function wellFor(at: number | null, now: number = Date.now()): RecencyWellId {
  if (at === null) return "recent";
  const age = now - at;
  for (const well of RECENCY_WELLS) {
    if (age < well.maxAgeMs) return well.id;
  }
  return "earlier";
}

/** One item, with the stamp that files it. ⚠ The NODE is built by the caller: this
 *  module groups rows and owns no row shape. */
export interface RecencyWellItem {
  key: string;
  at: number | null;
  node: ReactNode;
}

// ⚠ **NO `useRecencyWells` HERE, DELIBERATELY (2026-09-15)** — it would be a
// one-line bind of `well-state.ts › useWells` to `RECENCY_WELLS` with zero
// callers. **Import `useWells` and pass `RECENCY_WELLS`** the day a surface wants
// the open state without the column.

/**
 * THE FOUR WELLS OVER ONE ORDERED LIST OF ITEMS.
 *
 * ⚠ **THE CALLER'S ORDER SURVIVES INSIDE EVERY WELL.** The grouping is a single
 * forward pass (`collapse-wells.tsx › WellsColumn`), so own-agents-first (§5), the
 * agent feed's own thread grouping (`agents-model.ts › agentsForChannel`) and
 * **the Threads tab's server order** (§5: never re-sorted here, because the read
 * is CLIPPED against it) each reach their box intact. Nothing here sorts.
 * ⚠ **`now` IS A PARAMETER WITH A DEFAULT**, so a test can state an age instead of
 * arranging for one; the render passes nothing.
 * ⚠ **NO `face` IS PASSED AND NONE MAY BE** — the two tabs wear the default
 * `PANEL_WELL` Samuel ruled on in September and did not ask to restyle.
 */
export function RecencyWells({
  items,
  storageKey,
  now,
}: {
  items: readonly RecencyWellItem[];
  /** This surface's `localStorage` key — see `well-state.ts › useWells`. */
  storageKey: string;
  /** ⚠ NO `= Date.now()` DEFAULT HERE — that is an impure call during render
   *  (`react-hooks/purity`). The clock's default lives on {@link wellFor}, the
   *  pure function, exactly as `agents-model.ts › peerRowStale` holds its own. */
  now?: number;
}) {
  const filed = useMemo<WellItem<RecencyWellId>[]>(
    () =>
      items.map((item) => ({
        key: item.key,
        well: wellFor(item.at, now),
        node: item.node,
      })),
    [items, now]
  );
  return (
    <WellsColumn wells={RECENCY_WELLS} items={filed} storageKey={storageKey} />
  );
}
