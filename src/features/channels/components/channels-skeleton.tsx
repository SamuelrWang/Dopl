import {
  DetailPaneSkeleton,
  TranscriptSkeleton,
  TwoPaneListSkeleton,
} from "@/shared/ui/skeleton";

/**
 * Two-pane channels skeleton — mirrors the loaded `.page-float` chrome
 * (master list + detail thread) so the swap to live data doesn't reflow.
 * Rendered by the view's initial-load branch (`channels-view-core.tsx`).
 *
 * Composed from the shared kit rather than hand-rolled: this file used to
 * carry its own `animate-pulse` / `bg-surface-raised-2` recipe, which is
 * exactly the local clone `shared/ui/skeleton.tsx` and DESIGN-SYSTEM forbid.
 * The list shape is `TwoPaneListSkeleton` (built for this pane) with square
 * leading tiles for the channel icons; only the detail body is channels'
 * own — a transcript, not a document.
 */
export function ChannelsSkeleton() {
  return (
    <TwoPaneListSkeleton
      rows={6}
      leading="square"
      label="Loading channels"
      detail={
        <DetailPaneSkeleton>
          <div className="flex-1 overflow-hidden px-14 pt-8">
            <TranscriptSkeleton bubbles={3} className="mx-auto max-w-[760px]" />
          </div>
        </DetailPaneSkeleton>
      }
    />
  );
}
