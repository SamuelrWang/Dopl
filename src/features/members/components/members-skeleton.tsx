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
import { SkeletonBar } from "@/shared/ui/skeleton";

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
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <SkeletonBar h={28} w="100%" className="max-w-sm flex-1" />
          <SkeletonBar h={28} w={112} />
          <SkeletonBar h={12} w={80} className="ml-auto" />
        </div>
      )}

      <ul className="flex-1 min-h-0 divide-y divide-border-subtle">
        {Array.from({ length: ROWS }).map((_, i) => (
          <li key={i} className={ROW_GRID}>
            {/* chevron column kept empty for alignment */}
            <span aria-hidden="true" />
            <div className="flex items-center gap-3 min-w-0">
              <SkeletonBar h={28} w={28} className="rounded-full" />
              <div className="min-w-0 space-y-1.5">
                <SkeletonBar h={12} w={160} />
                <SkeletonBar h={10} w={224} />
              </div>
            </div>
            <SkeletonBar h={20} w={80} className="rounded-full" />
            <SkeletonBar h={12} w={96} />
            <span aria-hidden="true" />
          </li>
        ))}
      </ul>
    </div>
  );
}
