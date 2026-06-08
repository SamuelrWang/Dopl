/**
 * Skeleton mirroring `KnowledgeBaseView`'s chrome (tree column + doc
 * column inside a 100vh-52px frame). Rendered by the route-level
 * `loading.tsx` so click → page-paint feels instant: the user sees
 * the right-shaped panel and pulsing placeholders while the server
 * resolves auth, workspace membership, the tree, and the first
 * entry's body.
 */
import { cn } from "@/shared/lib/utils";

export function KnowledgeBaseSkeleton() {
  return (
    <div
      className="pt-[52px] pointer-events-auto"
      style={{ backgroundColor: "var(--panel-surface)" }}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading knowledge base</span>
      <div className="flex h-[calc(100vh-52px)]">
        {/* Tree column */}
        <aside
          className="hidden md:flex w-72 shrink-0 flex-col border-r border-border-subtle"
          style={{ backgroundColor: "var(--tabs-surface)" }}
        >
          <div className="px-3 py-3 border-b border-border-subtle space-y-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-7 w-full rounded-md" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden px-2 py-2 space-y-1">
            {TREE_WIDTHS.map((cls, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <Bar className="h-3 w-3 rounded-sm" />
                <Bar className={cn("h-3", cls)} />
              </div>
            ))}
          </div>
        </aside>

        {/* Doc column */}
        <div
          className="flex-1 min-w-0 overflow-hidden"
          style={{ backgroundColor: "var(--input-surface)" }}
        >
          <div className="max-w-3xl mx-auto px-8 py-10 space-y-5">
            <Bar className="h-6 w-2/3" />
            <div className="space-y-2.5">
              <Bar className="h-3 w-full" />
              <Bar className="h-3 w-[92%]" />
              <Bar className="h-3 w-[85%]" />
              <Bar className="h-3 w-3/4" />
            </div>
            <div className="space-y-2.5 pt-3">
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-full" />
              <Bar className="h-3 w-[88%]" />
              <Bar className="h-3 w-[80%]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const TREE_WIDTHS = [
  "w-32",
  "w-24 ml-3",
  "w-28 ml-3",
  "w-20 ml-3",
  "w-36",
  "w-24 ml-3",
  "w-28",
  "w-32 ml-3",
  "w-20 ml-3",
];

function Bar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-surface-raised-2", className)}
    />
  );
}
