import { cn } from "@/shared/lib/utils";
import { Skeleton, SkeletonBar, SkeletonLine } from "@/shared/ui/skeleton";
import { SECTION_PANEL_GROUND } from "@/shared/ui/section-panel";
import { SkeletonSurface } from "#/components/skeletons/skeleton-surface";

/**
 * `/:workspaceSegment/agents`'s loading shape — the templates page's OWN
 * column: a 52px header over the `max-w-[960px]` stack of THREE scope panels
 * (Private / Team / Public), each a card grid.
 *
 * ⚠ THREE PANELS, because `SECTIONS` has three rows and the page renders one
 * per row (`agent-templates/lib/visibility.ts`). A two-panel ghost would jump a
 * panel's height when the read lands.
 *
 * ⚠ THE GRID CLASS IS `TemplateGrid`'S, VERBATIM. It is a Tailwind arbitrary
 * value and cannot be imported, so it is one copied string pinned by the source
 * scan in `components/skeletons/page-skeletons.test.tsx` — the card minimum,
 * the auto-fill and the gap move together or the pin fails.
 *
 * ⚠ IT STANDS AT **BOTH** OF THIS PAGE'S GATES (2026-08-28). A cold /agents
 * crosses two pending states back to back — the workspace resolve in
 * `./index.tsx`, then `agent-templates-core.tsx`'s own template read — and the
 * second one painted the shared `PageShellSkeleton`, so one page swapped
 * skeletons mid-load. The core takes a `loadingSkeleton` SLOT now and the seam
 * hands it this shape; the web tree passes nothing and keeps the shared ghost.
 * ⚠ Do not "simplify" that to an import inside the core — it is Next-free and
 * router-free by construction and cannot reach into this package.
 */
export function AgentsPageSkeleton({
  label = "Loading agents",
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
          <TemplatePanelGhost cards={3} />
          <TemplatePanelGhost cards={2} />
          <TemplatePanelGhost cards={4} />
        </div>
      </div>
    </SkeletonSurface>
  );
}

/**
 * One `TemplatePanel` — `SectionPanel`'s box on the workspace default ground,
 * over `TemplateGrid`'s auto-fill card grid.
 *
 * ⚠ NOT `SectionPanel` ITSELF: it takes a `label` STRING and paints it as an
 * `<h2>`, and a skeleton must carry no text. What it keeps is the box
 * (`rounded-[14px] p-3`), the `data-section-panel` hook and
 * `SECTION_PANEL_GROUND` — the constant the two real consumers share, so the
 * ghost's fill and hairline cannot drift from theirs.
 */
function TemplatePanelGhost({ cards }: { cards: number }) {
  return (
    <div
      data-section-panel
      className={cn("rounded-[14px] p-3", SECTION_PANEL_GROUND)}
    >
      <div className="flex min-h-[22px] items-center justify-between gap-2 px-1 pb-2.5">
        <SkeletonLine w={128} h={10} />
        <SkeletonBar h={22} w={64} className="rounded-full" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-2.5">
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-[14px]" />
        ))}
      </div>
    </div>
  );
}
