import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";
import { PLOT_HEIGHT_CLASS } from "#/components/charts/bar-series";
import { cn } from "@/shared/lib/utils";

/**
 * THE ONE CONTAINER A GHOST ON THIS PAGE MAY DRAW — radius and padding, and
 * nothing that can be seen. See `OverviewSkeleton`'s docblock for the ruling.
 *
 * ⚠ `border border-transparent`, NEVER a dropped border: both boxes this
 * replaces had a 1px line, the background paints under the border box, and
 * removing it would pull every block inside in by a pixel. Same reasoning, and
 * the same spelling, as `shared/ui/section-panel.tsx › SECTION_PANEL_GROUND`.
 */
const FLAT_PANEL = "rounded-[14px] border border-transparent p-3.5";

/**
 * `/:workspaceSegment/overview`'s loading shape — the page's OWN column, not
 * the shared page ghost.
 *
 * ⚠ IT MIRRORS THE SIX MODULES `index.tsx` STACKS, in their order and at their
 * widths: the `max-w-5xl` column inside `px-6 pt-6 pb-10`, `gap-4`, then
 * header → four `grid-cols-4` stat cards → the two-up period stats in their
 * `bg-bg-inset` well → the chart card over its `h-40` plot → the uneven
 * `48fr_52fr` bottom row. The generic ghost resolved into a 52px top bar and a
 * three-up card row this page does not have, which is what "way off" meant
 * here.
 *
 * ⚠ THIS PAGE IS ALL-OR-NOTHING, and the skeleton is the whole first frame.
 * Rendering the stat row against zeroes and letting it jump when the payload
 * lands is the filed defect the gate in `index.tsx` exists to close — so this
 * shape stands for THREE reads (overview, series, billing status), not one.
 *
 * 🔒 ⚠ **IT PAINTS NO CONTAINER FACE (Samuel's ruling, 2026-09-21).** *"I like
 * the skeletons for the knowledge and the agents … they're very simple and
 * they're flattened. I notice that when I go to the overview page, it is not as
 * simple. I see some stuff that is elevated UI, and some is not … We basically
 * just shouldn't have elevated components."* Asked what flat means here he
 * defined it as SHIMMER BLOCKS ONLY: a skeleton container keeps its geometry
 * and loses its fill, its hairline and its shadow, so the only thing on screen
 * is `Skeleton` on the page's own ground.
 *
 * ⚠ WHAT LEFT, AND WHERE IT STILL LIVES. The period group's well was
 * `rounded-[14px] border border-border-default bg-bg-inset p-3.5`
 * (`period-stats.tsx`'s own string, byte-shared) and the chart card was the kit's
 * `.bento` (fill + 1px line + `--shadow-bento`). **Both remain on the REAL page
 * — only the ghost dropped them**, which is the one thing that makes this a
 * restyle of the loading state and not of the page. The cost is stated plainly:
 * those two boxes no longer byte-share their padding with the modules they stand
 * for, so a re-tune of `period-stats.tsx` / `activity-chart.tsx` padding has to
 * move `FLAT_PANEL` by hand. `components/skeletons/page-skeletons.test.tsx`
 * pins the flatness in both directions instead.
 */
export function OverviewSkeleton({
  label = "Loading overview",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface label={label} className="page-float flex flex-col antialiased">
      <div className="min-h-0 flex-1 overflow-hidden px-6 pt-6 pb-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          {/* HEADER — eyebrow, display title, one line under it; the invite
              pill sits right, top-aligned to the title. */}
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 space-y-2">
              <SkeletonLine w={96} h={9} />
              <SkeletonLine w={268} h={24} />
              <SkeletonLine w={196} h={10} />
            </div>
            <Skeleton className="mt-5 h-8 w-[124px] shrink-0 rounded-full" />
          </div>

          {/* FOUR STAT CARDS. */}
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-[14px]" />
            ))}
          </div>

          {/* PERIOD STATS — the two cards, on the group's geometry and no face. */}
          <div className={FLAT_PANEL}>
            <SkeletonLine w={112} h={9} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Skeleton className="h-[104px] rounded-[14px]" />
              <Skeleton className="h-[104px] rounded-[14px]" />
            </div>
          </div>

          {/* ACTIVITY CHART — heading row, then the plot at its real height.
              The card's geometry, none of `.bento`'s elevation. */}
          <div className={FLAT_PANEL}>
            <div className="flex items-center justify-between gap-4">
              <SkeletonLine w={104} h={9} />
              <div className="flex items-center gap-3">
                <SkeletonLine w={64} h={9} />
                <Skeleton className="h-7 w-[168px] rounded-full" />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <div className="w-8 shrink-0" />
              {/* ⚠ IMPORTED, NOT RE-TYPED (2026-09-01). The plot height was a
                  literal here under a comment pointing at a module-LOCAL
                  constant — a claim by reference that nothing enforced
                  (DRIFT-LEDGER P9). The plot now lives in
                  `#/components/charts/bar-series`, which EXPORTS the value, so
                  the ghost takes it the way the channels ghost takes
                  `COMPOSER_BOTTOM`. ⚠ Do NOT restate the literal in this
                  comment: `page-skeletons.test.tsx` scans this file's raw text
                  for it, which is what makes "never re-typed" enforceable. */}
              <Skeleton
                className={cn(PLOT_HEIGHT_CLASS, "min-w-0 flex-1 rounded-[10px]")}
              />
            </div>
          </div>

          {/* THE UNEVEN BOTTOM ROW — 48/52, matching the reference. */}
          <div className="grid grid-cols-[48fr_52fr] gap-3">
            <Skeleton className="h-[228px] rounded-[14px]" />
            <Skeleton className="h-[228px] rounded-[14px]" />
          </div>
        </div>
      </div>
    </SkeletonSurface>
  );
}
