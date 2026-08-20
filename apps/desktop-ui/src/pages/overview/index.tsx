import { ActivityChart } from "./activity-chart";
import { MemberLoad } from "./member-load";
import { OverviewHeader } from "./overview-header";
import { PeriodStats } from "./period-stats";
import { StatCards } from "./stat-cards";
import { UpcomingList } from "./upcoming-list";

/**
 * /:workspaceSegment/overview — workspace home.
 *
 * ⚠ STATIC. Every figure on this page is a constant in `./overview-data.ts`;
 * the page reads nothing and resolves no workspace. It is a look-and-structure
 * pass, and the data module is the single seam the real reads land on later.
 *
 * Page shell per DESIGN-SYSTEM.md: bare into the app shell — no `AppPanel`, no
 * `PageTopBar` — wrapped in one `.page-float` that owns the scroll.
 */
export default function OverviewPage() {
  return (
    <div className="page-float flex flex-col antialiased">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <OverviewHeader />
          <StatCards />
          <PeriodStats />
          <ActivityChart />
          {/* 48/52 split, matching the reference's uneven bottom row. */}
          <div className="grid grid-cols-[48fr_52fr] gap-3">
            <UpcomingList />
            <MemberLoad />
          </div>
        </div>
      </div>
    </div>
  );
}
