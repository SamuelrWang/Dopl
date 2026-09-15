"use client";

/**
 * THE COLLAPSIBLE GRAY WELL — **the machinery alone.** A header that toggles, a
 * gray body that grows and shrinks on `.collapse-grid`, ONE chevron that spins,
 * and one `localStorage` key per surface. **It knows nothing about time, and
 * nothing about what a caller's wells MEAN.**
 *
 * ⚠ **THERE IS ONE SHAPE, AND THE `variant="tab"` THAT BRIEFLY STOOD BESIDE IT IS
 * DELETED (Samuel, 2026-09-15, retracting his own ruling of the same day: *"Okay,
 * I actually don't like the tab look. Instead, let's just make it match the agents
 * one directly, or the one on the agents tab. Just make the gray dropdowns match
 * exactly those instead."*).** What went with it: the `WellVariant` union, the
 * `TAB_HEADER` / `TAB_HEADER_OPEN` class strings, the fill-less `"tab"` shell, the
 * folder-tab overlap, and their rows in `docs/DESIGN-SYSTEM.md` and
 * `docs/INVARIANTS.md`. **A dead branch kept "in case" is a second shape the next
 * reader has to rule out.** What a caller may still vary is the box's {@link Well}
 * `face` — the FILL, not the layout — which is the one thing /home needs and the
 * next paragraph but one says why.
 *
 * ⚠ **THE WELL SET AND ITS PERSISTED OPEN STATE LEFT FOR `well-state.ts` ON
 * 2026-09-15** (`WellSpec`, `useWells`, `storedWells`), when this file crossed the
 * 500-line cap: DATA there, BOX here.
 *
 * ⚠ **SPLIT OUT OF `recency-wells.tsx` ON 2026-09-15, ON THE SEAM THAT FILE
 * ALREADY NAMED** — "the machinery" plus "the four spans", with each consumer
 * keeping only the expression that dates ITS rows and its own key. A THIRD surface
 * (/home's channel list) wanted the box with a set that is **not** those spans
 * (Pinned / Recent / Earlier, where Pinned is a per-device CHOICE and not a stamp
 * at all), so the BOX is here and the TIME SPANS stay there. `recency-wells.tsx`
 * is now the first consumer of this file.
 *
 * 🔒 **SAMUEL, 2026-09-15, over /home's channel list (verbatim):** *"look on the
 * agents tab, there is the gray box, for recents, 7 days, etc. I want to bring
 * that over. Basically, one for Pinned, one for Recents (this will be in effect
 * channels with activity in the last 24 hours), and Earlier."* That is what this
 * file gained: **a caller-supplied well set**, so a third surface could take the
 * box without taking the four time spans.
 *
 * ⚠ **THE SHAPE IS THE AGENTS/THREADS WELL AND IS BYTE-IDENTICAL TO WHAT IT WAS**
 * — ONE gray box, the header INSIDE it, full width, the same chevron and the same
 * collapse. Both their suites assert `section.className === PANEL_WELL` exactly,
 * which is the fence.
 *
 * ⚠ **THE WELL IS THE /home OVERVIEW'S, REACHED BY IMPORT** —
 * `shared/ui/panel-well.ts › PANEL_WELL` (`SECTION_PANEL_SHELL` + a fill, NO
 * hairline), and it is the `face` DEFAULT.
 * 🔒 ⚠ **ONE SURFACE PASSES A DIFFERENT FILL, AND IT IS NOT A SECOND LOOK — IT IS
 * WHAT MAKES THE SAME LOOK VISIBLE (Samuel, same day: *"there's no gray background
 * on this at all"*).** The Agents and Threads wells render on WHITE, so
 * `bg-home-panel` reads as *"that gray background right behind the white pane"*;
 * /home's channel column stands on a `<main>` that is ITSELF `bg-home-panel`
 * (`pages/home/index.tsx`), so the same class there is `#f1f3f5` on `#f1f3f5` and
 * the box disappears. That column passes `› PANEL_WELL_ON_PANEL` — **the same
 * `WELL_BOX` geometry, one step darker** — and `shared/ui/panel-well.ts` carries
 * the measurement and why no other token would do. **`face` may change the FILL.
 * It may not change the geometry, the header or the collapse.**
 *
 * 🔒 ⚠ **AN EMPTY WELL IS HIDDEN BY DEFAULT AND SHOWN ON `showEmpty` (Samuel,
 * 2026-09-15):** *"Also, I want there to be something there, like the gray box.
 * Basically, it will just be empty until the user actually puts something in it,
 * but I still want it to be there."* On /home the three wells are the column's
 * STRUCTURE — a **Pinned** box you can see is how you learn there is a pin — so
 * they always render, empty body and all. ⚠ **AND THE DEFAULT STAYS `false` FOR
 * THE TWO TABS**, where it was never ruled on and four headings over three empty
 * boxes would make "nothing in this span" and "rows you have not scrolled to" one
 * picture. ⚠ **AN EMPTY WELL GETS NO PLACEHOLDER SENTENCE** — minimal copy
 * (INVARIANTS §5): the heading already names what is missing.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
// ⚠ CROSS-FEATURE, AND DELIBERATELY THE SMALLER OF TWO EVILS. `docs/INVARIANTS.md`
// §1 forbids it and F-275 records that this tree has never obeyed the rule;
// `agents-tab.tsx` has imported `agent-templates/components/template-picker` since
// 2026-08-22. `TEMPLATE_NAME_TEXT` was EXPORTED on 2026-09-13 precisely so a second
// surface could read the type Samuel names by pointing at it, and this heading is
// the third reader (for both tabs at once, since the extraction).
// ⚠ **AND IT IS WHY THIS FILE IS NOT IN `src/shared/ui/` (2026-09-15).** The well's
// heading face lives in a FEATURE, so a `shared/` module would have to import a
// feature — the one direction §1 forbids outright, rather than the one it merely
// records this tree breaking. /home reaches it as an APP importing a feature
// component, which `pages/home/person-members.tsx` and eleven others already do.
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
 * rule (INVARIANTS §5) — nothing on an agent card is worth mounting behind a
 * closed well, and `agent-delete.tsx`'s hover affordances have no business
 * existing where no one can see them. But a closing box with nothing inside it
 * has no content to clip, so it would snap shut instead of shrinking. The content
 * therefore outlives `open` by exactly one transition.
 *
 * ⚠ **THE SAME SHAPE `use-info-slide.ts › useInfoSlide` HOLDS, deliberately not a
 * shared hook.** That one is named for the info column and owns `INFO_SLIDE_MS`;
 * lifting a two-state latch to `shared/` to save nine lines would put a
 * presentation timer where neither consumer can see its own duration. ⚠ The
 * `||` below means this can never hold a well OPEN — only briefly populated.
 * ⚠ **REDUCED MOTION UNMOUNTS AT ONCE**, because the kit turns the transition off
 * under that query and nothing may wait for a transition that will not run. The
 * OPEN direction schedules a 0ms timer it does not need, for the reason
 * `useInfoSlide` records: `react-hooks/set-state-in-effect` rejects a synchronous
 * `setState` in an effect body outright.
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
 * ⚠ **EVERY SURFACE SHARES EVERY LINE OF THAT, AND A SECOND SHAPE IS NOT AN
 * OPTION HERE** — a forked collapse is two places for one geometry, one duration
 * and one unmount rule to move. {@link Well} `face` varies the FILL and nothing
 * else, which is why it is a class string and not a variant enum.
 *
 * ⚠ **`prefers-reduced-motion` KEEPS THE STATE AND DROPS THE MOTION**, both
 * halves: the kit's query turns `.collapse-grid`'s transition off, and the
 * chevron carries `motion-reduce:transition-none`. `aria-expanded`, the rotation
 * and the mount are unchanged either way — the box still opens, instantly.
 *
 * ⚠ **THE WHOLE HEADER ROW IS THE BUTTON, and the chevron is a `<span>` inside
 * it.** Samuel asked for the arrow on the right of the title; a nested `<button>`
 * is invalid HTML and would give a screen reader two controls for one act. The
 * 30px hit area is `NAKED_ICON_BUTTON`'s padding, unchanged.
 * ⚠ **THE HEADING IS STILL AN `h3` INSIDE THE BUTTON**, so the well stays a
 * landmark a reader can reach by role AND supplies the button's accessible name —
 * one text node, two jobs, no `aria-label` to drift from the visible word.
 * ⚠ **`TEMPLATE_NAME_TEXT`, BY IMPORT** — the type the /home Overview's **Credit
 * spend** heading wears (`pages/home/overview-panels.tsx`), which is what Samuel
 * named. ⚠ **NOT `TEMPLATE_NAME_TEXT_LG`**: that 18px face has exactly one reader,
 * the **Usage** panel heading, and he rejected its spread to Credit spend by name
 * the same day (*"I only asked you to change the usage size to be bigger"*).
 * ⚠ **COLLAPSED MEANS THE CONTENT IS NOT RENDERED**, not hidden — ⚠ **ONE
 * TRANSITION LATE SINCE 2026-09-13** — {@link useWellContent} owns the delay and
 * says why the ruling is unchanged by it.
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

          🔒 ⚠ **THE `-mx-3` / `px-3` PAIR IS THE SHADOW'S BLEED ROOM, AND IT IS
          THE WHOLE OF SAMUEL'S 2026-09-15 *"there are these like weird vertical
          shadows/the shadows are being cut off"*.** `.collapse-grid` is
          `overflow: hidden` (it has to be — that is what a `0fr → 1fr` track
          clips against), and until now its box was EXACTLY the well's content
          box, i.e. exactly the cards' width: every card's drop shadow was sliced
          flush with its own left and right edges, which is the hard vertical rule
          he saw. Widening the CLIP BOX by the well's own `p-3` and re-insetting
          the column by the same 12px leaves the cards where they were and puts
          the clip edge 12px out, past every shadow this component can hold —
          **measured, not assumed: `HOME_CARD_FACE`'s hovered `0 10px 20px`
          reaches 10px sideways, its `.selected-ring` halo 3px, and the Agents and
          Threads `.bento` `0 6px 18px` reaches 9px** (`kit.css`,
          `tokens.css › --raised-light-shadow`). ⚠ **12px IS ALSO THE MOST IT MAY
          EVER BE**: the clip now lands on the well's BORDER box, so a wider bleed
          would paint shadow outside the gray. ⚠ **IT IS TIED TO THE WELL'S `p-3`
          (`panel-well.ts › SECTION_PANEL_SHELL`) — move one and move both.**
          ⚠ **THE BOTTOM EDGE STILL CLIPS TIGHT AND THAT IS STRUCTURAL, NOT AN
          OVERSIGHT:** a `0fr` collapse grows DOWNWARD, so the bottom is the one
          edge whose clip IS the animation. What it cuts is the last card's
          resting `0 6px 14px rgba(0,0,0,0.06)` at the line where the well's own
          padding begins — a soft 6% fade, not a rule. Every fix for it (bottom
          padding inside the box, a negative bottom margin, `overflow-clip-margin`)
          either makes the collapsed well taller than its header or jumps the
          well's height on toggle; both are worse than the fade. */}
      <div
        className="collapse-grid -mx-3 -mt-2"
        data-open={open}
        aria-hidden={!open}
      >
        {/* 🔒 ⚠ **`pt-2` ONLY WHEN THERE IS A BODY, AND THAT IS SAMUEL'S SECOND
            2026-09-15 REPORT: *"when the gray box is retracted, the text isn't
            vertically centered"*.** With `box-sizing: border-box` a padded box
            cannot be shorter than its own padding, so an EMPTY column — a well
            with no rows, which `showEmpty` made a real state, or one whose rows
            are unmounted behind a closed header — still stood 8px tall inside the
            track and hung a dead band under the header: 12px of the well's
            padding above the label, 20px below it. **The padding belongs to the
            CONTENT it separates**, so with no content there is none, the grid
            child is a true zero, and the collapsed (and the empty) box is
            `p-3` + the 30px header + `p-3` — symmetric, and the header does not
            move when the well opens. */}
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
 * ⚠ **THE CALLER'S ORDER SURVIVES INSIDE EVERY WELL.** The grouping is a single
 * forward pass into one array per well, so own-agents-first (§5), the agent feed's
 * own thread grouping (`agents-model.ts › agentsForChannel`), **the Threads tab's
 * server order** (§5: never re-sorted here, because the read is CLIPPED against
 * it) and /home's newest-first row order (`pages/home/home-rows.ts › homeRows`)
 * each reach their box intact. **Nothing here sorts.**
 * ⚠ **AND NOTHING HERE BUCKETS EITHER (2026-09-15).** `item.well` arrives decided:
 * a time span for the two tabs (`recency-wells.tsx › wellFor`), a pin-or-span for
 * /home's list. A bucketing rule in this file is a second clock the day a caller
 * needs a different one — which is the day that arrived.
 */
export function WellsColumn<Id extends string>({
  wells,
  items,
  storageKey,
  face,
  showEmpty = false,
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
   * still want it to be there."* ⚠ **DEFAULT `false`, WHICH IS THE AGENTS AND
   * THREADS TABS' RULE UNCHANGED** — he ruled on a column whose three wells ARE
   * its structure, not on a feed whose four spans are a description of what is in
   * it. ⚠ **AN EMPTY WELL IS THE BOX AND ITS HEADER, WITH NO PLACEHOLDER
   * SENTENCE** (minimal copy, INVARIANTS §5): the heading already names what is
   * missing.
   */
  showEmpty?: boolean;
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
            open={isOpen(well.id)}
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
