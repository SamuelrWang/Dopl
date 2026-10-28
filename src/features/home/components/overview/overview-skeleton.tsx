import { cn } from "@/shared/lib/utils";
import { GHOST_FLAT_FACE, SkeletonLine, SkeletonRow } from "@/shared/ui/skeleton";
import { SkeletonSurface } from "@/shared/ui/skeleton-surface";
import styles from "./overview.module.css";

/** Ghost rows on the card's row geometry. */
export function GhostRows({
  count,
  leading = "circle",
}: {
  count: number;
  leading?: "circle" | "square" | "none";
}) {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} leading={leading} className="px-0 py-2" />
      ))}
    </div>
  );
}

/** A card's ghost: the card's own box and slot, flat (skeletons carry no elevation). */
function GhostCard({ rows, slot }: { rows: number; slot?: string }) {
  return (
    <div className={cn(GHOST_FLAT_FACE, styles.card, slot)}>
      <div className={styles.head}>
        <SkeletonLine w="30%" h={12} />
      </div>
      <GhostRows count={rows} />
    </div>
  );
}

/** The face's geometry with no announcement, for a surface that already announces the load. */
export function OverviewGhost() {
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.inner}>
        <div className={cn(GHOST_FLAT_FACE, styles.card, styles.strip)}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.cell}>
              <SkeletonLine w="50%" h={8} />
              <SkeletonLine w="40%" h={18} />
            </div>
          ))}
        </div>
        <div className={styles.grid}>
          <div className={styles.col}>
            <GhostCard rows={1} slot={styles.slotNeeds} />
            <GhostCard rows={3} />
          </div>
          <div className={styles.col}>
            <GhostCard rows={3} slot={styles.slotCredits} />
            <GhostCard rows={1} />
          </div>
        </div>
        <GhostCard rows={4} />
        <div className={styles.pair}>
          <GhostCard rows={4} />
          <GhostCard rows={4} />
        </div>
      </div>
    </div>
  );
}

/** The face's own loading state while `/api/home/overview` is in flight. */
export function OverviewSkeleton() {
  return (
    <SkeletonSurface label="Loading overview" className="flex min-w-0 flex-1">
      <OverviewGhost />
    </SkeletonSurface>
  );
}
