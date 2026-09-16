"use client";

/**
 * THE COLLAPSIBLE GRAY WELL — **the machinery alone.** A header that toggles, a
 * gray body that grows and shrinks on `.collapse-grid`, ONE chevron that spins,
 * and one `localStorage` key per surface. **It knows nothing about time, and
 * nothing about what a caller's wells MEAN.**
 *
 * ⚠ **THERE IS ONE SHAPE. The `variant="tab"` that stood beside it for a morning
 * is DELETED** (Samuel, 2026-09-15, retracting his own ruling of the same day:
 * *"Okay, I actually don't like the tab look. … Just make the gray dropdowns match
 * exactly those instead."*). **A dead branch kept "in case" is a second shape the
 * next reader has to rule out.** What a caller may vary is {@link Well} `face` —
 * the FILL, never the layout.
 *
 * ⚠ **THE WELL SET AND ITS PERSISTED OPEN STATE ARE `well-state.ts` (2026-09-15)**
 * — DATA there, BOX here. This file was split out of `recency-wells.tsx` the same
 * day so a third surface (/home's channel list) could bring its own well set
 * without taking the four time spans; `recency-wells.tsx` is now its first
 * consumer.
 *
 * ⚠ **THE SHAPE IS THE AGENTS/THREADS WELL, BYTE-IDENTICAL** — ONE gray box, the
 * header INSIDE it, full width, the same chevron and collapse. Both their suites
 * assert `section.className === PANEL_WELL` exactly, which is the fence.
 *
 * ⚠ **THE WELL IS THE /home OVERVIEW'S, REACHED BY IMPORT** —
 * `shared/ui/panel-well.ts › PANEL_WELL` (`SECTION_PANEL_SHELL` + a fill, NO
 * hairline), and it is the `face` DEFAULT.
 * 🔒 ⚠ **ONE SURFACE PASSES A DIFFERENT FILL, AND THAT IS WHAT MAKES THE SAME LOOK
 * VISIBLE (Samuel, same day: *"there's no gray background on this at all"*).**
 * /home's channel column stands on a `<main>` that is ITSELF `bg-home-panel`, so
 * the default fill there is `#f1f3f5` on `#f1f3f5`; it passes
 * `› PANEL_WELL_ON_PANEL`, the same `WELL_BOX` geometry one step darker.
 * **`face` may change the FILL. It may not change the geometry, the header or the
 * collapse.**
 *
 * 🔒 ⚠ **AN EMPTY WELL IS HIDDEN BY DEFAULT AND SHOWN ON `showEmpty` (Samuel,
 * 2026-09-15):** *"Also, I want there to be something there, like the gray box.
 * Basically, it will just be empty until the user actually puts something in it,
 * but I still want it to be there."* ⚠ **THE DEFAULT STAYS `false` FOR THE TWO
 * TABS**, where he never ruled. ⚠ **NO PLACEHOLDER SENTENCE IN AN EMPTY WELL** —
 * minimal copy (INVARIANTS §5): the heading already names what is missing.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
// ⚠ CROSS-FEATURE, AND DELIBERATELY THE SMALLER OF TWO EVILS (F-275 records that
// this tree has never obeyed §1's ban). `TEMPLATE_NAME_TEXT` was exported
// 2026-09-13 so a second surface could read the type Samuel names by pointing at
// it. ⚠ **AND IT IS WHY THIS FILE IS NOT IN `src/shared/ui/`** — a `shared/`
// module importing a feature is the direction §1 forbids OUTRIGHT; /home reaches
// it as an APP importing a feature component, as eleven other pages already do.
import { TEMPLATE_NAME_TEXT } from "@/features/agent-templates/components/template-section";
import { cn } from "@/shared/lib/utils";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { PANEL_ROWS, PANEL_WELL } from "@/shared/ui/panel-well";
// ⚠ THE WELL SET AND ITS PERSISTED OPEN STATE ARE `well-state.ts` SINCE 2026-09-15
// — that file carries the seam and why. This one owns the BOX.
import { useWells, type WellSpec } from "./well-state";

/** One item, already filed. ⚠ **THE BUCKETING IS THE CALLER'S** — this module
 *  groups and renders, and owns neither a clock nor a row shape. */
export interface WellItem<Id extends string = string> {
  key: string;
  well: Id;
  node: ReactNode;
}

/**
 * HOW LONG A WELL TAKES TO OPEN OR SHUT. ⚠ **KEEP IN STEP WITH `.collapse-grid`'s
 * transition** (globals.css + the desktop `kit.css` copy) — it is the app's one
 * panel duration, the same 200ms `.channel-info-slide` and `.menu-card` use.
 */
export const WELL_COLLAPSE_MS = 200;

/**
 * WHETHER THIS WELL'S CONTENT MUST BE RENDERED — open, or one transition past close.
 *
 * ⚠ **THE UNMOUNT RULING SURVIVES THE ANIMATION, AND THAT IS WHY THIS HOOK
 * EXISTS.** *"Collapsed means the cards are UNMOUNTED, not hidden"* is still the
 * rule (INVARIANTS §5) — but a closing box with nothing inside it has no content
 * to clip and would snap shut instead of shrinking, so the content outlives `open`
 * by exactly one transition. ⚠ The `||` below can never hold a well OPEN, only
 * briefly populated.
 * ⚠ **REDUCED MOTION UNMOUNTS AT ONCE** — the kit turns the transition off under
 * that query and nothing may wait for a transition that will not run. The OPEN
 * direction schedules a 0ms timer it does not need, because
 * `react-hooks/set-state-in-effect` rejects a synchronous `setState` in an effect
 * body outright (the shape `use-info-slide.ts › useInfoSlide` also holds).
 */
function useWellContent(open: boolean): boolean {
  const [trailing, setTrailing] = useState(open);
  useEffect(() => {
    if (trailing === open) return;
    const instant =
      open ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const timer = setTimeout(
      () => setTrailing(open),
      instant ? 0 : WELL_COLLAPSE_MS
    );
    return () => clearTimeout(timer);
  }, [open, trailing]);
  return open || trailing;
}

/** The header row — ⚠ **VERBATIM, not composed**: two suites assert the
 *  Agents/Threads well is unchanged, and a `cn()` of fragments is a different
 *  string one tailwind-merge collapse away. */
const WELL_HEADER =
  "flex min-h-[30px] w-full min-w-0 cursor-pointer items-center justify-between gap-2 pl-1 text-left";

/**
 * ONE WELL: a header row that toggles, and its content when it is open.
 *
 * 🔒 **IT ANIMATES (Samuel, 2026-09-13):** *"I want the drop-downs collapsing and
 * expanding to be a smooth animation. Even when the right arrow turns to the down
 * arrow, it should be a spinning right. Right now it's just a direct kind of
 * toggle, almost, but it should be a smooth animation, like the gray box
 * increases in size, stuff like that."* Two halves, and both are motion on an
 * existing element rather than a new shape:
 *
 *  - **THE BOX GROWS** — `.collapse-grid` (globals.css + `kit.css`), a
 *    `grid-template-rows: 0fr → 1fr` transition over `overflow: hidden`, so the
 *    well's own height follows its content with no measured pixel anywhere. The
 *    content stays mounted for the length of it ({@link useWellContent}).
 *  - **THE CHEVRON SPINS** — **ONE glyph**, `ChevronRight`, rotated `0°` → `90°`
 *    on a `transition-transform`. ⚠ **NOT TWO ICONS SWAPPED**: a
 *    `ChevronDown`/`ChevronRight` swap is a different element every time, so
 *    there is nothing for the browser to interpolate and *"a direct kind of
 *    toggle"* is exactly what it renders. `rotate-90` is clockwise, which is the
 *    *"spinning right"*. ⚠ **The two icons ARE GONE from this file** — importing
 *    `ChevronDown` again is how the swap comes back.
 *
 * ⚠ **EVERY SURFACE SHARES EVERY LINE OF THAT** — a forked collapse is two places
 * for one geometry, one duration and one unmount rule to move. {@link Well} `face`
 * varies the FILL and nothing else, which is why it is a class string and not a
 * variant enum.
 *
 * ⚠ **`prefers-reduced-motion` KEEPS THE STATE AND DROPS THE MOTION**, both
 * halves: the kit's query turns `.collapse-grid`'s transition off, and the chevron
 * carries `motion-reduce:transition-none`.
 *
 * ⚠ **THE WHOLE HEADER ROW IS THE BUTTON, and the chevron is a `<span>` inside
 * it** — a nested `<button>` is invalid HTML and gives a screen reader two
 * controls for one act. ⚠ **THE HEADING IS STILL AN `h3` INSIDE THE BUTTON**, so
 * the well is reachable by role AND supplies the button's accessible name: one
 * text node, two jobs, no `aria-label` to drift from the visible word.
 * ⚠ **`TEMPLATE_NAME_TEXT`, BY IMPORT** — the type the /home Overview's **Credit
 * spend** heading wears, which is what Samuel named. ⚠ **NOT
 * `TEMPLATE_NAME_TEXT_LG`** (18px): he rejected its spread by name the same day
 * (*"I only asked you to change the usage size to be bigger"*).
 * ⚠ **COLLAPSED MEANS THE CONTENT IS NOT RENDERED**, one transition late —
 * {@link useWellContent} owns the delay.
 */
export function Well({
  label,
  open,
  onToggle,
  face = PANEL_WELL,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  /** ⚠ THE BOX RECIPE — `PANEL_WELL` (the default, and what the two tabs render)
   *  or `PANEL_WELL_ON_PANEL` for a surface already standing on `--home-panel`.
   *  **A FILL, NEVER A LAYOUT**: both are `WELL_BOX` geometry, so the header, the
   *  radius, the padding and the collapse are the same on every surface. */
  face?: string;
  children: ReactNode;
}) {
  const mounted = useWellContent(open);
  /** ⚠ **ONE NAME FOR "IS THERE A BODY", READ TWICE** — the column's own top
   *  padding keys off it (see below), so a `mounted ? children : null` spelled
   *  inline would put the two answers one edit apart. ⚠ `children` is `undefined`
   *  for a well `showEmpty` drew with no rows: `WellsColumn` maps an ABSENT
   *  bucket, never an empty array, precisely so this test is honest. */
  const body = mounted ? (children ?? null) : null;
  return (
    <section className={face}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={WELL_HEADER}
      >
        <h3 className={cn("min-w-0 truncate", TEMPLATE_NAME_TEXT)}>{label}</h3>
        <span aria-hidden className={NAKED_ICON_BUTTON}>
          <ChevronRight
            size={NAKED_ICON}
            data-well-chevron=""
            className={cn(
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              open ? "rotate-90" : "rotate-0"
            )}
          />
        </span>
      </button>
      {/* ⚠ THE WRAPPER IS THE ANIMATION AND IT IS ALWAYS RENDERED — a box that
          only exists while open has no closed state to grow FROM. `data-open`
          drives `.collapse-grid`; the column inside is the same `PANEL_ROWS` it
          always was, now as the grid's single item.

          ⚠ THE `-mt-2` / `pt-2` PAIR MOVES `PANEL_WELL`'s OWN `gap-2` INSIDE THE
          ANIMATED BOX, and it is not decoration. This wrapper is now a permanent
          flex child, so the well's gap would apply to a zero-height box and leave
          a collapsed well 8px taller than it was, with a dead band under its
          header. Cancelling the gap on the wrapper and re-stating it as the
          COLUMN's top padding makes those 8px part of what grows.

          🔒 ⚠ **THE `-mx-3` / `px-3` PAIR IS THE SHADOW'S BLEED ROOM (Samuel,
          2026-09-15: *"there are these like weird vertical shadows/the shadows are
          being cut off"*).** `.collapse-grid` is `overflow: hidden` — that is what
          a `0fr → 1fr` track clips against — and its box was exactly the cards'
          width, so every drop shadow was sliced flush with its own left and right
          edges. Widening the CLIP BOX by the well's own `p-3` and re-insetting the
          column by the same 12px moves nothing and puts the clip edge past every
          shadow this component can hold — **measured: `HOME_CARD_FACE`'s hovered
          `0 10px 20px` reaches 10px sideways, a `.bento`'s `0 6px 18px` 9px.**
          ⚠ **12px IS ALSO THE MOST IT MAY EVER BE** — the clip now lands on the
          well's BORDER box. ⚠ **TIED TO THE WELL'S `p-3`
          (`panel-well.ts › SECTION_PANEL_SHELL`): move one and move both.**
          ⚠ **THE BOTTOM EDGE STILL CLIPS TIGHT AND THAT IS STRUCTURAL** — a `0fr`
          collapse grows DOWNWARD, so the bottom clip IS the animation. It cuts a
          soft 6% fade, and every fix either leaves the collapsed well taller than
          its header or jumps its height on toggle. */}
      <div
        className="collapse-grid -mx-3 -mt-2"
        data-open={open}
        aria-hidden={!open}
      >
        {/* 🔒 ⚠ **`pt-2` ONLY WHEN THERE IS A BODY (Samuel, 2026-09-15: *"when the
            gray box is retracted, the text isn't vertically centered"*).** With
            `box-sizing: border-box` a padded box cannot be shorter than its own
            padding, so an EMPTY column still stood 8px tall inside a zero track
            and hung a dead band under the header. **The padding belongs to the
            CONTENT it separates** — with no content there is none, the grid child
            is a true zero, and the collapsed box is `p-3` + header + `p-3`. */}
        <div className={cn(PANEL_ROWS, "px-3", body !== null && "pt-2")}>
          {body}
        </div>
      </div>
    </section>
  );
}

/**
 * THE CALLER'S WELLS OVER ONE ORDERED LIST OF ALREADY-FILED ITEMS.
 *
 * ⚠ **THE CALLER'S ORDER SURVIVES INSIDE EVERY WELL** — the grouping is a single
 * forward pass into one array per well, so own-agents-first (§5), the agent feed's
 * thread grouping, **the Threads tab's server order** (§5: never re-sorted, the
 * read is CLIPPED against it) and /home's newest-first order each reach their box
 * intact. **Nothing here sorts.**
 * ⚠ **AND NOTHING HERE BUCKETS EITHER (2026-09-15)** — `item.well` arrives
 * decided. A bucketing rule in this file is a second clock the day a caller needs
 * a different one, which is the day that arrived.
 */
export function WellsColumn<Id extends string>({
  wells,
  items,
  storageKey,
  face,
  showEmpty = false,
  forceOpen = false,
}: {
  /** ⚠ ORDER IS THE DATA — this array IS the render order. */
  wells: readonly WellSpec<Id>[];
  items: readonly WellItem<Id>[];
  /** This surface's `localStorage` key — see {@link useWells}. */
  storageKey: string;
  /** The box recipe, handed to every well — see {@link Well}. */
  face?: string;
  /**
   * 🔒 **DRAW A WELL WITH NOTHING IN IT (Samuel, 2026-09-15, over /home's channel
   * column):** *"I want there to be something there, like the gray box. Basically,
   * it will just be empty until the user actually puts something in it, but I
   * still want it to be there."* ⚠ **DEFAULT `false` — the Agents and Threads
   * tabs' rule unchanged.** ⚠ **AN EMPTY WELL IS THE BOX AND ITS HEADER, WITH NO
   * PLACEHOLDER SENTENCE** (minimal copy, §5).
   */
  showEmpty?: boolean;
  /**
   * 🔒 **EVERY WELL THAT HOLDS SOMETHING IS OPEN, WHATEVER THE OPERATOR LAST CHOSE** — for the
   * one situation where a remembered collapse hides the answer to a question the operator just
   * asked (2026-09-16). A FILTERED column is the case: a search that matches only rows filed
   * into a closed well renders nothing at all, and the empty sentence does not draw either
   * because rows DO exist. The toggle is untouched — this does not write the stored state, so
   * clearing the filter restores exactly the shape the operator had.
   * ⚠ IT OPENS ONLY THE NON-EMPTY WELLS: force-opening an empty one would replace three closed
   * boxes with three open ones and say even less.
   */
  forceOpen?: boolean;
}) {
  const { isOpen, toggle } = useWells(storageKey, wells);
  const grouped = useMemo(() => {
    const out = new Map<Id, WellItem<Id>[]>();
    for (const item of items) {
      const bucket = out.get(item.well);
      if (bucket) bucket.push(item);
      else out.set(item.well, [item]);
    }
    return out;
  }, [items]);

  return (
    <div className="flex flex-col gap-2">
      {wells.map((well) => {
        const bucket = grouped.get(well.id);
        // ⚠ HIDDEN WHEN EMPTY UNLESS THE CALLER ASKS OTHERWISE — see `showEmpty`.
        if (!showEmpty && (!bucket || bucket.length === 0)) return null;
        return (
          <Well
            key={well.id}
            label={well.label}
            open={
              isOpen(well.id) || (forceOpen && (bucket?.length ?? 0) > 0)
            }
            onToggle={() => toggle(well.id)}
            face={face}
          >
            {/* ⚠ A `Fragment` KEY, NOT A WRAPPER `div` — the rows are the direct
                children of the well's column exactly as they were the direct
                children of the flat column, so this ruling adds no box inside the
                well. */}
            {bucket?.map((item) => (
              <Fragment key={item.key}>{item.node}</Fragment>
            ))}
          </Well>
        );
      })}
    </div>
  );
}
