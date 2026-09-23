import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine, SkeletonText } from "@/shared/ui/skeleton";
import { SECTION_CARD } from "@/features/members/components/members-v2/bits";
import { SectionPanelGhost } from "#/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * `/:workspaceSegment/members`'s loading shape: the console's own two panes. The grid template is
 * the page's own string (pinned against `members-v2-view.tsx`) and the roster cards mount
 * `SECTION_CARD` itself. Used at both gates, handed to the shared view as its `loadingSkeleton`.
 */
export function MembersPageSkeleton({
  label = "Loading members",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      className="page-float grid grid-cols-[minmax(380px,42fr)_minmax(0,58fr)] antialiased"
    >
      <RosterPaneGhost />
      <MemberDetailGhost />
    </SkeletonSurface>
  );
}

/** The left cell (`list-pane.tsx › ListPane`): title + Add pill, search, filter row, role sections. */
function RosterPaneGhost() {
  return (
    <div className="flex min-w-0 flex-col border-r border-border-default">
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 space-y-2">
          <SkeletonLine w={112} h={20} />
          <SkeletonLine w={244} h={10} />
        </div>
        <Skeleton className="h-8 w-[76px] shrink-0 rounded-full" />
      </div>

      <Skeleton className="mx-4 mb-3 h-8 rounded-[9px]" />

      <div className="mx-4 mb-3 flex items-center gap-1.5">
        <Skeleton className="h-[27px] w-[104px] rounded-full" />
        <Skeleton className="h-[27px] w-[88px] rounded-full" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default pt-3">
        <div className="flex flex-col gap-5 px-3 pb-6">
          {/* A workspace always has one role group; Pending is the common second. */}
          <RosterSectionGhost rows={3} />
          <RosterSectionGhost rows={2} />
        </div>
      </div>
    </div>
  );
}

/** One role group: its heading pair, then `MemberSectionCard`'s card (`SECTION_CARD` itself). */
function RosterSectionGhost({ rows }: { rows: number }) {
  return (
    <section>
      <div className="space-y-1.5 px-0.5 pb-2">
        <SkeletonLine w={104} h={12} />
        <SkeletonLine w="82%" h={9} />
      </div>
      <div className={SECTION_CARD}>
        <div className="flex h-8 items-center gap-2.5 border-b border-border-default bg-card-surface-subtle px-3">
          <SkeletonLine w={44} h={8} />
          <span className="flex-1" />
          <SkeletonLine w={38} h={8} />
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 border-b border-border-subtle px-3 py-2 last:border-b-0"
          >
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <SkeletonLine w="52%" h={10} />
              <SkeletonLine w="72%" h={8} />
            </div>
            <SkeletonLine w={54} h={8} className="shrink-0" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The right cell (`detail-pane.tsx › MemberDetailPane`), opening on the signed-in user. Its dark
 *  header band is the surface's loudest fact, so the ghost draws it. */
function MemberDetailGhost() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card-surface-subtle">
      <div className="shrink-0 bg-surface-invert px-5 pt-4">
        <div className="flex items-start gap-3.5">
          <OnInvert className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <OnInvert className="h-5 w-[196px] rounded-full" />
            <OnInvert className="h-2.5 w-[148px] rounded-full" />
          </div>
          <div className="flex shrink-0 items-start gap-6 pt-0.5">
            <StatBlockGhost />
            <StatBlockGhost />
          </div>
        </div>
        {/* The tab row: inert blocks, no `<button>`. */}
        <div className="mt-3 flex items-center gap-3 pb-2.5 pt-1">
          <OnInvert className="h-3 w-[44px] rounded-full" />
          <OnInvert className="h-3 w-[48px] rounded-full" />
          <OnInvert className="h-3 w-[52px] rounded-full" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="bento flex flex-col gap-3.5 px-4 py-4">
          <div className="min-w-0 space-y-1.5">
            <SkeletonLine w={92} h={16} />
            <SkeletonLine w="64%" h={9} />
          </div>
          {/* `member-facts.tsx` — the Role and Teams sections. */}
          <div className="flex flex-col gap-3">
            <SectionPanelLinesGhost lines={2} />
            <SectionPanelLinesGhost lines={1} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** One `bits.tsx › StatBlock` — micro label over its value. */
function StatBlockGhost() {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <OnInvert className="h-2 w-[58px] rounded-full" />
      <OnInvert className="h-3 w-[46px] rounded-full" />
    </div>
  );
}

/** One `SectionPanel`: heading bar over a few text lines. */
function SectionPanelLinesGhost({ lines }: { lines: number }) {
  return (
    <SectionPanelGhost headingWidth={58}>
      <div className="px-1">
        <SkeletonText lines={lines} />
      </div>
    </SectionPanelGhost>
  );
}

/**
 * The shimmer atom re-grounded for the inverted band: its 3.5% black fill is invisible on
 * `--surface-invert`. A ground, not a second pulse recipe (INVARIANTS §1A); the `!` wins over the
 * atom's own `bg-*` utility in the same layer.
 */
function OnInvert({ className }: { className?: string }) {
  return <Skeleton className={cn("!bg-text-on-invert/15", className)} />;
}
