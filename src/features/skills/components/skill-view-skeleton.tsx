/**
 * Skeleton mirroring `SkillView`'s chrome (file-tabs strip + main
 * editor column inside a framed panel). Rendered by the route-level
 * `loading.tsx` so click → page-paint feels instant while the server
 * resolves auth, workspace, skill, and KB list.
 */
import { cn } from "@/shared/lib/utils";

export function SkillViewSkeleton() {
  return (
    <div
      className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] p-3 pointer-events-auto"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading skill</span>
      <div
        className="h-full rounded-2xl border border-border-default bg-[var(--panel-surface)] overflow-hidden flex"
        style={{ backgroundColor: "var(--panel-surface)" }}
      >
        {/* Main column — file tabs + editor */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 border-b border-border-subtle px-3 py-2">
            <Bar className="h-6 w-28 rounded-md" />
            <Bar className="h-6 w-24 rounded-md" />
            <Bar className="h-6 w-20 rounded-md" />
            <Bar className="ml-auto h-6 w-6 rounded-md" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="max-w-3xl mx-auto px-8 py-10 space-y-5">
              <Bar className="h-6 w-1/2" />
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
              </div>
            </div>
          </div>
        </div>

        {/* Right rail — KB picker placeholder */}
        <aside className="hidden lg:flex w-72 shrink-0 flex-col border-l border-border-subtle p-3 gap-3">
          <Bar className="h-3 w-24" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Bar key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-surface-raised-2", className)}
    />
  );
}
