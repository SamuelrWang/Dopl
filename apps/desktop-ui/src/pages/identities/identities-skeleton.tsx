import { Skeleton, SkeletonBar, SkeletonLine } from "@/shared/ui/skeleton";
import {
  IdentityCardsGhost,
  SectionPanelGhost,
} from "#/components/skeletons/section-panel-ghost";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * `/:workspaceSegment/agents`'s loading shape — the identities page's OWN
 * column: a 52px header over the `max-w-[960px]` stack of THREE scope panels
 * (Private / Team / Public), each a card grid.
 *
 * ⚠ THREE PANELS, because `SECTIONS` has three rows and the page renders one
 * per row (`agent-identities/lib/visibility.ts`). A two-panel ghost would jump a
 * panel's height when the read lands.
 *
 * ⚠ THE GRID CLASS IS `IdentityGrid`'S, **BY IMPORT** — `identity-section.tsx ›
 * IDENTITY_GRID` (exported 2026-09-13, when the grid became a FIXED four
 * columns; it was `auto-fill` at a 196px minimum and a copied string until
 * then). The source scan in `components/skeletons/page-skeletons.test.tsx` now
 * pins the IMPORT rather than the bytes, so the column count and the gap cannot
 * move on one surface.
 *
 * ⚠ IT STANDS AT **BOTH** OF THIS PAGE'S GATES (2026-08-28). A cold /agents
 * crosses two pending states back to back — the workspace resolve in
 * `./index.tsx`, then `agent-identities-core.tsx`'s own identity read — and the
 * second one painted the shared `PageShellSkeleton`, so one page swapped
 * skeletons mid-load. The core takes a `loadingSkeleton` SLOT now and the seam
 * hands it this shape; the web tree passes nothing and keeps the shared ghost.
 * ⚠ Do not "simplify" that to an import inside the core — it is Next-free and
 * router-free by construction and cannot reach into this package.
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
