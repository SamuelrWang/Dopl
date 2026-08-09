/**
 * Skeleton for the members TABLE — placeholder rows mirroring the settings
 * modal's Members tab (`members-tab.tsx`: chevron · avatar · name/email ·
 * role pill · joined date · remove), rendered there while the client-side
 * `useMembers` fetch is in flight.
 *
 * Scope note: this is the table's skeleton, not the console's. The
 * full-page members console (`members-view.tsx`) is a 372px two-pane
 * master/detail surface, so it loads into `TwoPaneListSkeleton` +
 * `SkeletonRow` from the shared kit instead — this grid's fixed 140px
 * columns do not fit that pane.
 *
 * The route-level `app/[workspaceSlug]/members/loading.tsx` this used to
 * name is GONE (no route-level `loading.tsx` survives anywhere in the
 * repo); `withToolbar` is kept because it is the shape a future full-width
 * table boundary would want, and costs one branch.
 *
 * Same grid template + sizing as the real rows so the swap to live
 * data doesn't reflow the layout.
 */
import { cn } from "@/shared/lib/utils";
import { SkeletonBar } from "@/shared/ui/skeleton";

const ROWS = 6;
const ROW_GRID = "grid grid-cols-[16px_1fr_140px_140px_60px] items-center gap-3 px-4 py-3";

interface Props {
  /** Whether to render the toolbar row (search + filter + count). The
   *  in-table skeleton doesn't, because the toolbar above it is already
   *  drawn; a full-surface caller would. */
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
