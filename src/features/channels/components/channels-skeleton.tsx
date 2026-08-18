import {
  DetailPaneSkeleton,
  TranscriptSkeleton,
  TwoPaneListSkeleton,
} from "@/shared/ui/skeleton";

/**
 * Channels skeleton — mirrors the loaded `.page-float` chrome (a list column
 * plus a detail column) so the swap to live data doesn't reflow. Rendered by
 * the initial-load branch of `channels-v2/channels-v2-core.tsx`. ⚠ It was
 * built for the two-pane page (`channels-view-core.tsx`, deleted at the v2
 * cutover 2026-08-18) and is a rough fit for the three-column surface —
 * a redesign is F-220, not a reason to hand-roll a second recipe.
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
