import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

/**
 * Loading skeleton for the ontology kanban board. Mirrors the loaded
 * shape — the header strip (concave tab track + name/purpose inputs +
 * add-column button) over a row of bento column ghosts, each with card
 * ghosts inside its concave inset body. Slots inside the view's
 * `.page-float` Frame, replacing the bare "Loading ontology…" text.
 */
export function OntologyBoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading ontology</span>

      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
        <div className="concave-track flex items-center gap-1">
          <Skeleton className="h-6 w-20 rounded-[6px]" />
          <Skeleton className="h-6 w-16 rounded-[6px]" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SkeletonLine w={120} h={13} />
          <SkeletonLine w="40%" h={11} />
        </div>
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {[3, 2, 3].map((cards, i) => (
          <ColumnSkeleton key={i} cards={cards} />
        ))}
      </div>
    </div>
  );
}

function ColumnSkeleton({ cards }: { cards: number }) {
  return (
    <div className="bento flex w-72 shrink-0 flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <SkeletonLine w="55%" h={12} />
          <Skeleton className="ml-auto h-4 w-6 rounded-full" />
        </div>
        <div className="px-3 pb-2 pt-1.5">
          <SkeletonLine w="75%" h={9} />
        </div>
      </div>
      <div className={`${SECTION_BOX_INSET} flex min-h-0 flex-1 flex-col gap-2 px-2 py-2`}>
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border border-border-default bg-bg-elevated px-3 py-2.5">
      <SkeletonLine w="70%" h={12} />
      <SkeletonLine w="45%" h={9} />
    </div>
  );
}
