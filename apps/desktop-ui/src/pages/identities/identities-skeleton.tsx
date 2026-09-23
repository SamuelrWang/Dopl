import { Skeleton, SkeletonBar, SkeletonLine } from "@/shared/ui/skeleton";
import {
  IdentityCardsGhost,
  SectionPanelGhost,
} from "#/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * `/:workspaceSegment/identities`'s loading shape: a 52px header over one panel per `SECTIONS` row
 * (`agent-identities/lib/visibility.ts`), each a card grid. Used at both gates, handed to the
 * Next-free core as its `loadingSkeleton` slot.
 */
export function IdentitiesPageSkeleton({
  label = "Loading identities",
}: {
  label?: string;
}) {
  return (
    <SkeletonSurface label={label} className="page-float flex flex-col antialiased">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-default px-4">
        <SkeletonLine w={92} h={18} />
        <span className="flex-1" />
        <Skeleton className="h-8 w-[126px] rounded-lg" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="mx-auto flex max-w-[960px] flex-col gap-3">
          <IdentityPanelGhost cards={3} />
          <IdentityPanelGhost cards={2} />
          <IdentityPanelGhost cards={4} />
        </div>
      </div>
    </SkeletonSurface>
  );
}

/** One `IdentityPanel` over `IdentityGrid`'s cards. */
function IdentityPanelGhost({ cards }: { cards: number }) {
  return (
    <SectionPanelGhost
      headingWidth={128}
      action={<SkeletonBar h={22} w={64} className="rounded-full" />}
    >
      <IdentityCardsGhost count={cards} />
    </SectionPanelGhost>
  );
}
