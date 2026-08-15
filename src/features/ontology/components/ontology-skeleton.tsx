import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

/**
 * Loading skeleton for the ontology kanban board. Mirrors the loaded
 * shape — the header strip (trackless pill row + name/purpose inputs +
 * add-column button) over a dotted substrate carrying flat inset lanes,
 * each hugging a short white header card, its fixed-height object cards,
 * and the add button. Slots inside the view's `.page-float` Frame,
 * replacing the bare "Loading ontology…" text.
 *
 * It composes `.kanban-substrate` for the pitch even though nothing scrolls
 * here (`overflow-hidden`) — `background-attachment: local` is inert without
 * a scroller, and one class keeps the two surfaces literally identical.
 */
export function OntologyBoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading ontology</span>

      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
        {/* Trackless pill row — mirrors the live switcher's .seg-pill shape. */}
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-[27px] w-20 rounded-full" />
          <Skeleton className="h-[27px] w-16 rounded-full" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SkeletonLine w={120} h={13} />
          <SkeletonLine w="40%" h={11} />
        </div>
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>

      {/* Same geometry as the live board: 12px dot pitch, 24px board padding,
          12px gutter, lanes that hug their contents. */}
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
    <div className="flex w-72 shrink-0 flex-col gap-2 self-start rounded-[14px] bg-bg-inset p-3">
      {/* Header card — collapsed, so shorter than an object card. */}
      <div className="flex shrink-0 items-center gap-2 rounded-[10px] border border-border-default bg-bg-elevated px-2.5 py-2">
        <SkeletonLine w="50%" h={12} />
        <Skeleton className="ml-auto h-4 w-6 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
        <Skeleton className="h-7 w-24 shrink-0 self-start rounded-md" />
      </div>
    </div>
  );
}

/** The loaded card's fixed 216px and its bottom-pinned meta row. */
function CardSkeleton() {
  return (
    <div className="flex h-[216px] shrink-0 flex-col rounded-[10px] border border-border-default bg-bg-elevated">
      <div className="flex-1 space-y-2 px-3 pt-3 pb-2">
        <SkeletonLine w="70%" h={12} />
        <SkeletonLine w="90%" h={9} />
        <SkeletonLine w="80%" h={9} />
        <SkeletonLine w="45%" h={9} />
      </div>
      <div className="shrink-0 border-t border-border-subtle px-3 py-2">
        <SkeletonLine w="60%" h={8} />
      </div>
    </div>
  );
}
