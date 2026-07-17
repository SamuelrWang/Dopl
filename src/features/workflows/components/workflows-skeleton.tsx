import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";

/** Scattered step-card ghosts, positioned to read as a left-to-right DAG. */
const STEPS: ReadonlyArray<{ left: number; top: number }> = [
  { left: 32, top: 40 },
  { left: 300, top: 40 },
  { left: 568, top: 40 },
];

const STEP_WIDTH = 232;

/**
 * Board-only loading skeleton — the recessed dotted substrate with a row
 * of step-card ghosts. Used for the detail-loading state (the tab strip is
 * already live) and composed into the full-page `WorkflowsSkeleton`.
 */
export function WorkflowBoardSkeleton() {
  return (
    <div
      className="relative min-w-0 flex-1 overflow-hidden bg-bg-inset shadow-[inset_0_2px_6px_rgba(0,0,0,0.06)]"
      style={{
        backgroundImage:
          "radial-gradient(rgba(35,42,49,0.07) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading workflow</span>
      {STEPS.map((step, i) => (
        <StepCardSkeleton key={i} left={step.left} top={step.top} />
      ))}
    </div>
  );
}

/**
 * Full-page loading skeleton for the workflows view — header strip ghost
 * (concave tab track + name/purpose inputs + actions) over the board
 * skeleton. Slots inside the view's `.page-float` Frame, replacing the
 * bare "Loading workflows…" text.
 */
export function WorkflowsSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
        <div className="concave-track flex items-center gap-1">
          <Skeleton className="h-6 w-24 rounded-[6px]" />
          <Skeleton className="h-6 w-16 rounded-[6px]" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SkeletonLine w={132} h={13} />
          <SkeletonLine w="40%" h={11} />
        </div>
        <Skeleton className="h-7 w-8 rounded-md" />
        <Skeleton className="h-7 w-16 rounded-md" />
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <WorkflowBoardSkeleton />
      </div>
    </div>
  );
}

function StepCardSkeleton({ left, top }: { left: number; top: number }) {
  return (
    <div
      className="absolute overflow-hidden rounded-xl border border-border-default bg-bg-elevated"
      style={{ left, top, width: STEP_WIDTH }}
    >
      <div className="space-y-2 px-3 pb-2 pt-2.5">
        <SkeletonLine w="70%" h={12} />
        <SkeletonLine w="95%" h={9} />
        <SkeletonLine w="55%" h={9} />
      </div>
      <div className="border-t border-border-subtle px-3 py-1.5">
        <SkeletonLine w="60%" h={8} />
      </div>
    </div>
  );
}
