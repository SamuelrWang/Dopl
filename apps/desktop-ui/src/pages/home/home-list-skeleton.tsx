/**
 * /home's channel column while the list is in flight: the gray wells and the rows inside them.
 * No text and nothing pressable; the label lives on `SkeletonSurface`'s `sr-only` line.
 */

import { Skeleton, SkeletonBar, SkeletonLine } from "@/shared/ui/skeleton";
import { PANEL_ROWS, PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
import { NAKED_ICON } from "@/shared/ui/naked-icon-button";
import { cn } from "@/shared/lib/utils";
import { HOME_CHANNEL_WELLS, type HomeChannelWellId } from "./channel-wells";
import { GHOST_FLAT_FACE } from "./home-ghost-face";

/** Rows each OPEN well stands in for — per well, because a list is mostly Recent. */
const WELL_ROWS: Record<HomeChannelWellId, number> = {
  pinned: 2,
  recent: 4,
  earlier: 3,
};

/**
 * The column's wells, read from `HOME_CHANNEL_WELLS` (set, order and `defaultOpen`), never
 * re-typed. The well's gray is geometry, not elevation; the column and scroller classes are
 * `relationship-list.tsx`'s and `collapse-wells.tsx › WellsColumn`'s own.
 */
export function HomeListGhost() {
  return (
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-1">
        <div className="flex flex-col gap-2">
          {HOME_CHANNEL_WELLS.map((well) => (
            <WellGhost
              key={well.id}
              label={well.label}
              // A closed well ghosts its header only, as the loaded column opens it.
              rows={well.defaultOpen ? WELL_ROWS[well.id] : 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One well: a heading bar with its chevron, then the rows. A `<section>` with no button in it.
 * The header box restates `collapse-wells.tsx › WELL_HEADER` minus the pointer (that constant is
 * file-private); its 30px is what the chevron's `p-2` box makes. The heading bar is sized from
 * the label, so each well resolves into its own heading width.
 */
function WellGhost({ label, rows }: { label: string; rows: number }) {
  return (
    <section aria-hidden className={PANEL_WELL_ON_PANEL}>
      <div className="flex min-h-[30px] w-full min-w-0 items-center justify-between gap-2 pl-1">
        <SkeletonLine w={`calc(${label.length}ch)`} h={12} />
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
 * One channel row, on the pane's flat white — never the loaded row's raised `HOME_CARD_FACE`
 * (skeletons are flat). Two `h-5` lines (title + time, then the peer stack) inside the row's own
 * `py-2.5`. No ghost for unread marks: only some rows carry one.
 */
function HomeRowGhost() {
  return (
    <div
      aria-hidden
      className={cn(
        GHOST_FLAT_FACE,
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
