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
      <div className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] p-3 pointer-events-auto">
        <div
          className="h-full rounded-2xl border border-border-default overflow-hidden flex flex-col"
          style={{ backgroundColor: "var(--panel-surface)" }}
        >
          <MembersTableSkeleton withToolbar />
        </div>
      </div>
    </>
  );
}
