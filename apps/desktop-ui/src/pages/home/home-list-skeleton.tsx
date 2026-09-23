/**
 * /home's CHANNEL COLUMN, WHILE THE LIST IS IN FLIGHT — the three gray wells and
 * the rows inside them.
 *
 * ⚠ **A §1 SPLIT OUT OF `home-skeleton.tsx` ON 2026-09-22, AT A REAL SEAM.** That
 * file owns the page FRAME and the record pane's faces; this owns the left column,
 * which is the half that moves when `relationship-list.tsx` moves — the wells, the
 * row, the scroller. The container crossed the 500-line cap when the wells landed
 * on it, which is the cap naming a seam that was already there.
 *
 * ⚠ **NO TEXT ANYWHERE** and nothing pressable, exactly as the container states:
 * the label lives on `SkeletonSurface`'s `sr-only` line and the wells' headings are
 * bars, not words.
 */

import { Skeleton, SkeletonBar, SkeletonLine } from "@/shared/ui/skeleton";
// ⚠ THE LOADED WELL'S OWN RECIPE AND ITS ROW COLUMN, BY IMPORT (R3) — the fill,
// the radius and the padding move for the ghost the day they move for the page.
import { PANEL_ROWS, PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
// ⚠ THE CHEVRON'S SIZE, ONE NUMBER — the same glyph the real well's header draws.
import { NAKED_ICON } from "@/shared/ui/naked-icon-button";
import { cn } from "@/shared/lib/utils";
// ⚠ THE SET, ITS ORDER AND EACH DEFAULT — the data the loaded column maps; see
// {@link HomeListGhost}.
import { HOME_CHANNEL_WELLS, type HomeChannelWellId } from "./channel-wells";
import { GHOST_FLAT_FACE } from "./home-ghost-face";

/**
 * Rows each OPEN well stands in for. Enough to fill the column, no more.
 *
 * ⚠ **PER WELL, NOT ONE NUMBER, AND THE SHAPE IS THE POINT** (2026-09-22): a list
 * is mostly Recent with a pin or two, so two equal stacks would ghost a column no
 * operator has. ⚠ **`earlier` IS ONLY READ IF THAT WELL'S OWN `defaultOpen`
 * SAYS SO** — the count is not a decision about whether it is open.
 */
const WELL_ROWS: Record<HomeChannelWellId, number> = {
  pinned: 2,
  recent: 4,
  earlier: 3,
};

/**
 * The channel list — **THREE GRAY WELLS IN THE 290px COLUMN, like the loaded one**
 * (Samuel, 2026-09-22).
 *
 * 🔒 **IT WAS SEVEN LOOSE ROWS ON THE PAGE'S OWN GROUND AND THAT IS THE DEFECT**,
 * verbatim: *"it doesn't include the gray boxes for Pin[ned], Recent and Earlier.
 * It also doesn't include any component or skeleton for an actual channel. It just
 * looks like little things are directly on the background color, which is bad."*
 * The column has been three collapsible wells since 2026-09-15
 * (`relationship-list.tsx`) and this ghost never followed, so a cold launch
 * resolved from bars-on-a-slab into boxed groups — the "way off" defect §1A
 * refuses, in the one column an operator looks at first.
 *
 * ⚠ **THE WELLS ARE READ FROM `HOME_CHANNEL_WELLS`, NEVER RE-TYPED** — the set,
 * its ORDER and each well's `defaultOpen` are the data the real column maps
 * (`channel-wells.ts`, re-exported from the root tree). A fourth well, a rename or
 * a changed default moves this ghost with it, which is the argument
 * `HomeHeaderGhost` already makes for reading `HOME_TABS`.
 *
 * ⚠ **A GRAY FILL IS NOT ELEVATION AND STAYS** (Samuel, same message: *"there
 * should not be any elevated UI or anything"*). `PANEL_WELL_ON_PANEL` is the
 * loaded well's own recipe — radius, padding and ONE flat `--seg-fill` gray, with
 * no hairline and no shadow, which is exactly the reading
 * `GHOST_FLAT_FACE`'s docblock records for `SECTION_PANEL_GROUND`. What a ghost
 * may not wear is a raised FACE; a ground it stands on is geometry.
 *
 * ⚠ **THE COLUMN AND ITS SCROLLER ARE THE PAGE'S OWN**, down to the
 * `gap-2 px-3 pb-3 pt-1` and the `flex flex-col gap-2` the wells sit in
 * (`relationship-list.tsx`, `collapse-wells.tsx › WellsColumn`).
 */
export function HomeListGhost() {
  return (
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-1">
        {/* `WellsColumn`'s own wrapper: the wells are a `gap-2` column, and the
            page's scroller adds nothing between them. */}
        <div className="flex flex-col gap-2">
          {HOME_CHANNEL_WELLS.map((well) => (
            <WellGhost
              key={well.id}
              label={well.label}
              // ⚠ A CLOSED WELL DRAWS ITS HEADER AND NOTHING ELSE, which is the
              // loaded column's own default state — `Earlier` opens empty
              // (`home-channel-wells.ts`), so ghosting rows inside it would
              // promise a group the page then collapses.
              rows={well.defaultOpen ? WELL_ROWS[well.id] : 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * ONE WELL: the gray box, a ghosted heading with its chevron, and the rows.
 *
 * ⚠ IT IS A `<section>` WITH NO BUTTON IN IT — the loaded header is a real
 * `<button>` that toggles, and a skeleton offers nothing to press (this file's
 * no-fake-interactive rule, the same one the face selector follows).
 *
 * ⚠ **THE HEADER'S GEOMETRY IS RESTATED, MINUS THE POINTER, AND ONLY BECAUSE IT
 * CANNOT BE IMPORTED**: `collapse-wells.tsx › WELL_HEADER` is file-private and
 * deliberately verbatim there (two suites assert that string), so this states the
 * same `min-h-[30px] … pl-1` box and drops `cursor-pointer`, which a ghost must
 * not claim. ⚠ The 30px is what the chevron's own `p-2` box makes, so the two
 * numbers below travel together.
 *
 * ⚠ **THE HEADING BAR IS SIZED FROM THE LABEL** — `HomeHeaderGhost`'s `ch` trick,
 * for its reason: the words differ in length ("Pinned", "Recent", "Earlier"), and
 * one fixed width would resolve into three different headings.
 */
function WellGhost({ label, rows }: { label: string; rows: number }) {
  return (
    <section aria-hidden className={PANEL_WELL_ON_PANEL}>
      <div className="flex min-h-[30px] w-full min-w-0 items-center justify-between gap-2 pl-1">
        <SkeletonLine w={`calc(${label.length}ch)`} h={12} />
        {/* The chevron in its `NAKED_ICON_BUTTON` box — the padding only, never
            that constant's hover ink: nothing here responds to a cursor. */}
        <span className="flex shrink-0 items-center justify-center p-2">
          <SkeletonBar h={NAKED_ICON} w={NAKED_ICON} className="rounded-[4px]" />
        </span>
      </div>
      {rows > 0 && (
        <div className={PANEL_ROWS}>
          {Array.from({ length: rows }).map((_, i) => (
            <HomeRowGhost key={i} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One channel row. ⚠ It is a `<div>`, not a `<button>`: a skeleton offers
 * nothing to press.
 *
 * 🔒 ⚠ **THE FACE IS FLAT SINCE 2026-09-21 (Samuel's ruling).** *"On the left
 * side, where the [rails] are for the channel, that is also elevated … we
 * basically just shouldn't have elevated components."* This row wore
 * `channel-row-marks.tsx › HOME_CARD_FACE` (`auth-btn-3d-light` — the gradient,
 * its line and its shadows) so the swap to real rows was a content change and
 * not a change of surface; the ghost now trades that parity for flatness and
 * wears `GHOST_FLAT_FACE`, which restates only the radius and the border BOX.
 * ⚠ **THE LOADED ROW KEEPS ITS RAISED FACE** — do not "restore parity" by
 * putting the constant back here, and do not flatten the constant itself.
 *
 * 🔒 **REDRAWN 2026-09-13 AND IT WAS TWO RULINGS BEHIND.** It drew a 32px LEADING
 * AVATAR — deleted from the real row on 2026-09-01 with the roster-derived
 * identity — and THREE stacked text lines, the second and third being the
 * last-message preview Samuel removed on 2026-09-13. So the ghost resolved into a
 * row of a different height with a face in a slot that no longer exists, which is
 * the "way off" defect §1A exists to refuse. It is now the real row's own two
 * lines: title + time, then the 20px peer stack.
 *
 * ⚠ **THE HEIGHTS ARE THE ROW'S, STATED AS THE ROW STATES THEM** — two `h-5`
 * lines (a `text-body` title's box, and `AvatarStack`'s `2xs` face) with the row's
 * own `mt-0.5` between, inside its `py-2.5`. A ghost one text line off shifts the
 * content the operator is already reading toward.
 *
 * ⚠ **NO GHOST FOR THE UNREAD MARKS, deliberately.** A dot or an `@ N` pill is
 * present on SOME rows, so ghosting one would promise a notification that the
 * loaded row usually does not have — the same argument `OverviewFaceGhost` below
 * makes for ghosting neither of the Overview face's folding panels.
 */
function HomeRowGhost() {
  return (
    <div
      aria-hidden
      className={cn(
        GHOST_FLAT_FACE,
        // 🔒 **THE ROW HAS A GROUND AGAIN, AND IT IS FLAT** (Samuel, 2026-09-22:
        // *"any component or skeleton for an actual channel … it just looks like
        // little things are directly on the background color, which is bad"*, with
        // *"there should not be any elevated UI"* in the same breath).
        // ⚠ **`bg-home-card` IS THE PANE'S OWN WHITE, NOT A FACE.** The loaded row
        // wears `home-channel-row.tsx › HOME_CARD_FACE` — `auth-btn-3d-light`, i.e.
        // a gradient, a hairline and two shadows — and NONE of that comes back
        // here; the 2026-09-21 flatness ruling stands and the constant stays out
        // of this file. What changes is that the row now stands on something, so
        // it reads as a row inside its gray well instead of as two loose bars.
        "bg-home-card",
        "flex w-full items-start gap-2.5 px-2.5 py-2.5"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center justify-between gap-2">
          <SkeletonLine w="58%" h={11} />
          <SkeletonLine w={30} h={8} />
        </div>
        <div className="mt-0.5 flex h-5 items-center gap-1.5">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      </div>
    </div>
  );
}
