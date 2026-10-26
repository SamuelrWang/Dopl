import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

/**
 * Loading skeleton for the ontology board, mirroring the loaded canvas (`ontology-view.tsx`'s
 * header, `kanban-board.tsx`'s lanes) as flat shimmer blocks at the same boxes.
 */
export function OntologyBoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading ontology</span>

      {/* Name picker, description, display pill, gear, "+ Object". */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-3">
        <SkeletonLine w={140} h={14} />
        <div className="mx-2 flex min-w-0 flex-1 items-center">
          <SkeletonLine w="40%" h={11} />
        </div>
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>

      <div className="graph-substrate kanban-substrate flex min-h-0 flex-1 items-start gap-3 overflow-hidden p-6">
        {[3, 2, 3].map((cards, i) => (
          <ColumnSkeleton key={i} cards={cards} />
        ))}
      </div>
    </div>
  );
}

function ColumnSkeleton({ cards }: { cards: number }) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 self-start">
      <Skeleton className="h-10 w-full shrink-0 rounded-[12px]" />
      {Array.from({ length: cards }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full shrink-0 rounded-[12px]" />
      ))}
      <Skeleton className="h-7 w-24 shrink-0 self-start rounded-[8px]" />
    </div>
  );
}
