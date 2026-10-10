import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

/**
 * Loading skeleton for the ontology kanban board. Must mirror the loaded shape
 * (`kanban-board.tsx`); slots inside the view's `.page-float` Frame. Shared by the
 * workspace /ontology page and the /home Ontology face.
 *
 * 🔒 FLAT (Samuel, 2026-09-21: *"we basically just shouldn't have elevated
 * components"*; 2026-10-09 sweep). The loaded header and object cards are bordered
 * `bg-bg-elevated` faces; their ghosts are plain shimmer blocks at the same box —
 * the /home Overview ghost's language (its rails are `h-40 rounded-[14px]` blocks).
 * Composes
 * `.kanban-substrate` even though nothing scrolls here — one class keeps the two
 * surfaces identical, and the dotted grid is on the loaded board since 2026-09-11.
 */
export function OntologyBoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading ontology</span>

      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
        {/* The name-dropdown trigger, then the Description line, then the gear and
            the black "+ Object" — the live header's four, in its order. */}
        <SkeletonLine w={120} h={16} />
        <div className="flex min-w-0 flex-1 items-center">
          <SkeletonLine w="40%" h={11} />
        </div>
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>

      {/* Same geometry as the live board: 12px dot pitch, 24px padding, 12px
          gutter, lanes hug contents. */}
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
    // The live lane's gray, by the same token (`kanban-board.tsx › Column`).
    <div className="flex w-72 shrink-0 flex-col gap-2 self-start rounded-[14px] bg-home-panel p-3">
      {/* Header card, collapsed (`kanban-column-header.tsx`: `px-1.5 py-1` round the
          chevron's `p-1` box, plus the 1px border) — one flat block. */}
      <Skeleton className="h-[33px] w-full shrink-0 rounded-[10px]" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: cards }).map((_, i) => (
          // `kanban-card.tsx`'s fixed 216px (18 dot tiles), flat.
          <Skeleton key={i} className="h-[216px] w-full shrink-0 rounded-[10px]" />
        ))}
        {/* The lane's "+ Add" (`kanban-board.tsx`: `px-2.5 py-1.5` small text). */}
        <Skeleton className="h-7 w-24 shrink-0 self-start rounded-md" />
      </div>
    </div>
  );
}
