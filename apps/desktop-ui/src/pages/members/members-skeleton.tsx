import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonLine, SkeletonText } from "@/shared/ui/skeleton";
import { SECTION_CARD } from "@/features/members/components/members-v2/bits";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * `/:workspaceSegment/members`'s loading shape — the console's OWN two panes.
 *
 * ⚠ IT REPLACES `PageLoading variant="two-pane"`, which was `TwoPaneListSkeleton`:
 * a FIXED 372px list of avatar rows over `DetailDocSkeleton`'s centred
 * `max-w-[760px]` document column. This page is neither. Its list is the LEFT
 * CELL OF A GRID (`minmax(380px,42fr)`), it stacks role SECTIONS of bordered
 * cards rather than a flat row list, and its right pane opens on a DARK header
 * band over one `.bento` — no document measure anywhere on the surface. The v1
 * members skeleton that used to carry this shape was deleted with the v1 tab
 * (`src/features/members/components/members-skeleton.tsx`, 2026-08-30) and
 * nothing replaced it, which is how the generic ghost came back.
 *
 * 🔑 GEOMETRY BY REFERENCE. The grid template is the page's own string, pinned
 * byte-for-byte against `members-v2-view.tsx` in
 * `#/components/skeletons/page-skeletons.test.tsx`; the roster cards mount
 * `members-v2/bits.tsx › SECTION_CARD` itself, so their fill, hairline and
 * radius cannot drift from the loaded roster's.
 *
 * ⚠ THE SAME SHAPE STANDS AT **BOTH** GATES. A cold /members crosses the
 * workspace resolve in `./index.tsx` and then `MembersV2View`'s own roster read;
 * the second one painted `TwoPaneListSkeleton`, so the page swapped skeletons
 * mid-load — the flicker `#/components/page-states.tsx` argues against, arriving
 * inside a single page. The view takes a `loadingSkeleton` SLOT now and the seam
 * hands it this shape. ⚠ Do not "simplify" that to an import on the other side:
 * `members-v2-view.tsx` lives in the shared tree and cannot reach into this
 * package (same idiom as `agent-templates-core.tsx`).
 */
export function MembersPageSkeleton({
  label = "Loading members",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      // The page's own grid, verbatim — NOT a fixed list width.
      className="page-float grid grid-cols-[minmax(380px,42fr)_minmax(0,58fr)] antialiased"
    >
      <RosterPaneGhost />
      <MemberDetailGhost />
    </SkeletonSurface>
  );
}

/**
 * THE LEFT CELL — `list-pane.tsx › ListPane`: title block + "Add" pill, the
 * compact search well, the two-option filter row, then the scroller of role
 * sections.
 */
function RosterPaneGhost() {
  return (
    <div className="flex min-w-0 flex-col border-r border-border-default">
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0 space-y-2">
          <SkeletonLine w={112} h={20} />
          <SkeletonLine w={244} h={10} />
        </div>
        {/* The `auth-btn-3d` "Add" pill: h-8, hug width, fully round. */}
        <Skeleton className="h-8 w-[76px] shrink-0 rounded-full" />
      </div>

      {/* `SearchField size="sm"` is an h-8 concave well. */}
      <Skeleton className="mx-4 mb-3 h-8 rounded-[9px]" />

      {/* `SegmentedControl` in its trackless `sm` form — two h-[27px] pills. */}
      <div className="mx-4 mb-3 flex items-center gap-1.5">
        <Skeleton className="h-[27px] w-[104px] rounded-full" />
        <Skeleton className="h-[27px] w-[88px] rounded-full" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden border-t border-border-default pt-3">
        <div className="flex flex-col gap-5 px-3 pb-6">
          {/* Two sections, because a workspace always has at least one role
              group and the Pending group is the common second. */}
          <RosterSectionGhost rows={3} />
          <RosterSectionGhost rows={2} />
        </div>
      </div>
    </div>
  );
}

/**
 * One role group — the heading pair `ListPane` draws above every section, then
 * `member-rows.tsx › MemberSectionCard`'s bordered card: a 32px column strip
 * over the member rows.
 *
 * ⚠ THE CARD MOUNTS `SECTION_CARD` ITSELF rather than restating its four
 * utilities. That constant is `bits.tsx`'s and the three real roster cards read
 * it, so this ghost re-grounds with them.
 */
function RosterSectionGhost({ rows }: { rows: number }) {
  return (
    <section>
      <div className="space-y-1.5 px-0.5 pb-2">
        <SkeletonLine w={104} h={12} />
        <SkeletonLine w="82%" h={9} />
      </div>
      <div className={SECTION_CARD}>
        {/* `HeaderStrip` — h-8, its own subtle fill, one hairline under it. */}
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
            {/* `Avatar size="sm"` — 32px round. */}
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

/**
 * THE RIGHT CELL — `detail-pane.tsx › MemberDetailPane`, which opens on the
 * signed-in user and therefore never shows the empty state at this gate.
 *
 * ⚠ THE HEADER BAND IS DARK AND THAT IS THE SURFACE'S LOUDEST FACT
 * (`member-header.tsx`: `bg-surface-invert px-5 pt-4`). A ghost that skipped it
 * resolved into a black strip dropping onto the reader — the exact "moves the
 * content the operator was already reading toward" failure INVARIANTS §1A opens
 * with.
 */
function MemberDetailGhost() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card-surface-subtle">
      <div className="shrink-0 bg-surface-invert px-5 pt-4">
        <div className="flex items-start gap-3.5">
          {/* `Avatar size="md"` — 40px round. */}
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
        {/* The tab row — inert blocks at the tab rhythm, no `<button>`. */}
        <div className="mt-3 flex items-center gap-3 pb-2.5 pt-1">
          <OnInvert className="h-3 w-[44px] rounded-full" />
          <OnInvert className="h-3 w-[48px] rounded-full" />
          <OnInvert className="h-3 w-[52px] rounded-full" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="bento flex flex-col gap-3.5 px-4 py-4">
          {/* `PaneHeading` — title over one quiet line. */}
          <div className="min-w-0 space-y-1.5">
            <SkeletonLine w={92} h={16} />
            <SkeletonLine w="64%" h={9} />
          </div>
          {/* `member-facts.tsx` — the Role and Teams `SectionBox`es, each a
              14px-radius box with a subtle header strip over its body. */}
          <div className="flex flex-col gap-3">
            <SectionBoxGhost lines={2} />
            <SectionBoxGhost lines={1} />
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

/** One `shared/ui/section-box.tsx › SectionBox` — header strip over the body. */
function SectionBoxGhost({ lines }: { lines: number }) {
  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center gap-2 bg-card-surface-subtle px-4 py-1.5">
        <SkeletonLine w={58} h={8} />
      </div>
      <div className="px-3 py-2.5">
        <SkeletonText lines={lines} />
      </div>
    </div>
  );
}

/**
 * The shimmer atom RE-GROUNDED FOR THE INVERTED BAND, and nothing else about it
 * changes — same `Skeleton`, same `animate-pulse`, same `aria-hidden`, so the
 * one-recipe pin in `page-skeletons.test.tsx` still counts it.
 *
 * ⚠ IT EXISTS BECAUSE THE ATOM'S FILL IS BLACK AT 3.5% (`bg-surface-raised-2`),
 * which is invisible on `--surface-invert`. `!bg-text-on-invert/15` is the same
 * on-invert tint `member-header.tsx` gives the avatar it sits beside; the `!` is
 * there because both are `bg-*` utilities in one layer and source order would
 * otherwise decide which wins. This is a GROUND, not a second pulse recipe —
 * never fork `Skeleton` itself (INVARIANTS §1A).
 */
function OnInvert({ className }: { className?: string }) {
  return <Skeleton className={cn("!bg-text-on-invert/15", className)} />;
}
