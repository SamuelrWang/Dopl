import { cn } from "@/shared/lib/utils";
import {
  Skeleton,
  SkeletonLine,
  TranscriptSkeleton,
} from "@/shared/ui/skeleton";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * `/:workspaceSegment/channels`'s loading shape — the surface's OWN two
 * columns, not the generic two-pane list ghost.
 *
 * ⚠ THE REAL SHAPE IS A 260px SIDEBAR + THE MESSAGE PANE, and the generic ghost
 * got both halves wrong: a 372px list of avatar rows over a 760px document
 * column, where this page is a narrow nav tree over a transcript with a card
 * composer at the bottom. Widths and heights here are the surface's own —
 * `sidebar.tsx`'s `w-[260px] … border-r border-border-default` and `h-[52px]`
 * head, `message-pane.tsx`'s `h-[56px]` header and `px-8 py-5` scroller.
 *
 * ⚠ THE INFO COLUMN IS NOT DRAWN. It is closed at mount
 * (`.channel-info-slide` at zero width until `data-open`), so a ghost third
 * column would resolve into a pane that then slid shut.
 */
export function ChannelsSkeleton({
  label = "Loading channels",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface
      label={label}
      className="page-float relative flex antialiased"
    >
      {/* THE SIDEBAR — search head, the hardcoded nav block, then the
          collapsible sections over their gap-px row lists. */}
      <div className="flex w-[260px] shrink-0 flex-col border-r border-border-default">
        <div className="flex h-[52px] shrink-0 items-center gap-2 px-3">
          <span className="flex-1" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pb-6">
          <div className="flex flex-col gap-px px-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <NavRowGhost key={i} />
            ))}
          </div>
          <SidebarSectionGhost rows={3} />
          <SidebarSectionGhost rows={5} />
        </div>
      </div>

      {/* THE MESSAGE PANE — header, transcript scroller, composer card. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[56px] shrink-0 items-center gap-1.5 border-b border-border-default px-4">
          <SkeletonLine w={148} h={13} />
          <span className="flex-1" />
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-8 py-5">
          <TranscriptSkeleton bubbles={5} />
        </div>
        {/* The composer is a RAISED CARD, not a bare input row. */}
        <div className="shrink-0 px-8 pb-5">
          <div className="raised-tab flex flex-col gap-2 rounded-[14px] px-[13px] py-[11px]">
            <SkeletonLine w="52%" h={11} />
            <div className="flex items-center gap-0.5">
              <Skeleton className="h-6 w-6 rounded-md" />
              <Skeleton className="h-6 w-6 rounded-md" />
              <span className="flex-1" />
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </SkeletonSurface>
  );
}

/** One nav / channel row — a glyph and a label, at the tree's row rhythm. */
function NavRowGhost({ indented = false }: { indented?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 px-2 py-1.5", indented && "pl-6")}>
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
      <SkeletonLine w={indented ? "56%" : "68%"} h={10} />
    </div>
  );
}

/** A collapsible section — its header strip over its rows. */
function SidebarSectionGhost({ rows }: { rows: number }) {
  return (
    <>
      <div className="flex items-center gap-2 px-3 pb-1 pt-4">
        <SkeletonLine w={92} h={9} />
        <span className="flex-1" />
        <Skeleton className="h-5 w-5 rounded" />
      </div>
      <div className="flex flex-col gap-px px-2">
        {Array.from({ length: rows }).map((_, i) => (
          <NavRowGhost key={i} indented={i % 3 === 2} />
        ))}
      </div>
    </>
  );
}
