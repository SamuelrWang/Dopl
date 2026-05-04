/**
 * Skeleton for the members table — placeholder rows that mirror the
 * shape of `MembersTable` (chevron · avatar · name/email · role pill ·
 * joined date · remove). Used in two places:
 *
 *   1. `app/[workspaceSlug]/members/loading.tsx` — Next.js loading
 *      boundary while the page server component awaits auth and
 *      membership lookup.
 *   2. `MembersTable` itself, when the client-side `useMembers` fetch
 *      hasn't returned yet (`loading && members.length === 0`).
 *
 * Same grid template + sizing as the real rows so the swap to live
 * data doesn't reflow the layout.
 */
import { cn } from "@/shared/lib/utils";

const ROWS = 6;
const ROW_GRID = "grid grid-cols-[16px_1fr_140px_140px_60px] items-center gap-3 px-4 py-3";

interface Props {
  /** Whether to render the toolbar row (search + filter + count).
   *  The route-level loading.tsx renders it; the in-table skeleton
   *  doesn't, because the toolbar above it is already drawn. */
  withToolbar?: boolean;
  className?: string;
}

export function MembersTableSkeleton({ withToolbar = false, className }: Props) {
  return (
    <div className={cn("h-full flex flex-col", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading members</span>

      {withToolbar && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <Bar className="h-7 w-full max-w-sm flex-1" />
          <Bar className="h-7 w-28" />
          <Bar className="ml-auto h-3 w-20" />
        </div>
      )}

      <ul className="flex-1 min-h-0 divide-y divide-white/[0.04]">
        {Array.from({ length: ROWS }).map((_, i) => (
          <li key={i} className={ROW_GRID}>
            {/* chevron column kept empty for alignment */}
            <span aria-hidden="true" />
            <div className="flex items-center gap-3 min-w-0">
              <Bar className="h-7 w-7 rounded-full" />
              <div className="min-w-0 space-y-1.5">
                <Bar className="h-3 w-40" />
                <Bar className="h-2.5 w-56" />
              </div>
            </div>
            <Bar className="h-5 w-20 rounded-full" />
            <Bar className="h-3 w-24" />
            <span aria-hidden="true" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-white/[0.05]", className)}
    />
  );
}
