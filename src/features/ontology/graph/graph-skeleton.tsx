import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

/** Scattered node-card ghosts, positioned to read as a small graph. */
const NODES: ReadonlyArray<{ left: number; top: number; width: number; lines: number }> = [
  { left: 40, top: 48, width: 200, lines: 2 },
  { left: 320, top: 32, width: 200, lines: 3 },
  { left: 320, top: 168, width: 200, lines: 2 },
  { left: 600, top: 96, width: 200, lines: 3 },
];

/**
 * Loading skeleton for the ontology graph (Canvas) view. Header strip
 * ghost over the recessed dotted substrate with a few scattered node-card
 * ghosts — the loaded graph's shape. Slots inside the view's `.page-float`
 * Frame, replacing the bare "Loading ontology…" text.
 */
export function GraphSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading ontology graph</span>

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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className="relative min-w-0 flex-1 overflow-hidden bg-bg-inset shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
          style={{
            backgroundImage:
              "radial-gradient(rgba(35,42,49,0.07) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {NODES.map((node, i) => (
            <NodeCardSkeleton key={i} {...node} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeCardSkeleton({
  left,
  top,
  width,
  lines,
}: {
  left: number;
  top: number;
  width: number;
  lines: number;
}) {
  return (
    <div
      className="absolute space-y-2 rounded-xl border border-border-default bg-bg-elevated px-3 py-2.5"
      style={{ left, top, width }}
    >
      <SkeletonLine w="65%" h={12} />
      {lines >= 2 && <SkeletonLine w="90%" h={9} />}
      {lines >= 3 && <SkeletonLine w="50%" h={9} />}
    </div>
  );
}
