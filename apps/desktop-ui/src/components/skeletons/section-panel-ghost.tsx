import { Skeleton } from "@/shared/ui/skeleton";
import { IDENTITY_GRID } from "@/features/agent-identities/components/identity-section";

/** `SectionPanelGhost` lives in `src/shared/ui/section-panel-ghost.tsx`, which the /home Knowledge
 *  face (declared in `src/`) also wears. */
export { SectionPanelGhost } from "@/shared/ui/section-panel-ghost";

/** `IdentityGrid`'s cards; the grid class is imported so the column count cannot drift. */
export function IdentityCardsGhost({
  count,
  grid = IDENTITY_GRID,
}: {
  count: number;
  /** The grid the loaded page passes `IdentityGrid` (/home: `IDENTITY_GRID_RAIL`). */
  grid?: string;
}) {
  return (
    <div className={grid}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-xl" />
      ))}
    </div>
  );
}
