import { PageTopBar } from "@/shared/layout/page-top-bar";
import { MembersTableSkeleton } from "@/features/members/components/members-skeleton";

/**
 * Route-level loading boundary. Renders while `page.tsx` awaits
 * `getUser` → `resolvePageWorkspace` → `resolveMembershipOrThrow`.
 * Mirrors the eventual MembersView chrome (top bar + framed panel)
 * so the swap to the live page doesn't reflow.
 */
export default function Loading() {
  return (
    <>
      <PageTopBar title="Members" />
      <div className="h-full">
        <div className="h-full overflow-hidden flex flex-col">
          <MembersTableSkeleton withToolbar />
        </div>
      </div>
    </>
  );
}
