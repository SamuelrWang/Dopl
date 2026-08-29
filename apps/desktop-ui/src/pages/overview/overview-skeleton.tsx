import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

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

          {/* PERIOD STATS — two cards inside their own inset well. */}
          <div className="rounded-[14px] border border-border-default bg-bg-inset p-3.5">
            <SkeletonLine w={112} h={9} />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Skeleton className="h-[104px] rounded-[14px]" />
              <Skeleton className="h-[104px] rounded-[14px]" />
            </div>
          </div>

          {/* ACTIVITY CHART — heading row, then the plot at its real height. */}
          <div className="bento p-3.5">
            <div className="flex items-center justify-between gap-4">
              <SkeletonLine w={104} h={9} />
              <div className="flex items-center gap-3">
                <SkeletonLine w={64} h={9} />
                <Skeleton className="h-7 w-[168px] rounded-full" />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <div className="w-8 shrink-0" />
              {/* `h-40` is `activity-chart.tsx › PLOT_HEIGHT_CLASS`. */}
              <Skeleton className="h-40 min-w-0 flex-1 rounded-[10px]" />
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
