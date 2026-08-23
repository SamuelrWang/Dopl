import { useState } from "react";
import { useNavigate } from "react-router";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import type {
  OverviewSeriesMetric,
  WorkspaceOverview,
  WorkspaceOverviewSeries,
} from "@/features/workspaces/types";
import { useWorkspaceRoute } from "#/components/app-shell";
import { PageError, PageLoading } from "#/components/page-states";
import { useApiQuery } from "#/hooks/use-api-query";
import { ActivityChart } from "./activity-chart";
import { MemberLoad } from "./member-load";
import { OverviewHeader } from "./overview-header";
import { PeriodStats } from "./period-stats";
import { RecentActivity } from "./recent-activity";
import { StatCards } from "./stat-cards";

/**
 * /:workspaceSegment/overview — workspace home. THE SEAM: the six modules below
 * it are pure props (there is no `overview-data.ts` any more).
 *
 * THREE reads, ONE gate:
 *   - `…/overview`         counts + recent activity + member load
 *   - `…/overview-series`  the histogram, one metric at a time
 *   - `/api/billing/status` credits, via the SAME hook the settings modal's
 *     billing pane uses — one cache entry serves both, no second credits read.
 *
 * ⚠ Nothing paints until all three have landed. Rendering the stat row against
 * zeroes and letting it jump when the payload arrives was the filed defect;
 * `PageLoading` is the whole first frame instead.
 *
 * Cold read, deliberately: no `supabase.channel()`, no poll. The provider's 30s
 * `staleTime` is the freshness story for this page.
 *
 * Page shell per DESIGN-SYSTEM.md: bare into the app shell — no `AppPanel`, no
 * `PageTopBar` — wrapped in one `.page-float` that owns the scroll.
 */
export default function OverviewPage() {
  const { workspace, segment, isPending, error, refetch } = useWorkspaceRoute();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !workspace || !segment) {
    return <PageLoading label="Loading overview" variant="page" />;
  }

  return (
    <OverviewSurface
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      segment={segment}
    />
  );
}

const overviewPath = (segment: string) =>
  `/api/workspaces/${encodeURIComponent(segment)}/overview`;
const seriesPath = (segment: string) =>
  `/api/workspaces/${encodeURIComponent(segment)}/overview-series`;

/**
 * Mounted only once the workspace is resolved, so every read below is scoped
 * from its first render — including `useWorkspaceEntitlements`, which has no
 * `enabled` and would otherwise fire once against the caller's DEFAULT
 * workspace and land in a second cache entry.
 */
function OverviewSurface({
  workspaceId,
  workspaceName,
  segment,
}: {
  workspaceId: string;
  workspaceName: string;
  segment: string;
}) {
  const navigate = useNavigate();
  const [metric, setMetric] = useState<OverviewSeriesMetric>("messages");

  const overview = useApiQuery<WorkspaceOverview>(overviewPath(segment), {
    workspaceId,
  });
  // `metric` is part of the query key, so each series is cached separately and
  // switching back is free. `keepPreviousData` keeps the previous metric's bars
  // up while the next one loads — a switch must not drop the page to the gate.
  const series = useApiQuery<WorkspaceOverviewSeries>(seriesPath(segment), {
    workspaceId,
    query: { metric },
    keepPreviousData: true,
  });
  const credits = useWorkspaceEntitlements(workspaceId);

  const error = overview.error ?? series.error;
  if (error) {
    return (
      <PageError
        error={error}
        onRetry={() => {
          void overview.refetch();
          void series.refetch();
          void credits.refresh();
        }}
      />
    );
  }
  if (!overview.data || !series.data || credits.loading) {
    return <PageLoading label="Loading overview" variant="page" />;
  }

  return (
    <div className="page-float flex flex-col antialiased">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <OverviewHeader
            workspaceName={workspaceName}
            onInviteMembers={() => navigate(`/${segment}/members`)}
          />
          <StatCards counts={overview.data.counts} />
          <PeriodStats credits={credits.credits} />
          <ActivityChart
            metric={metric}
            onMetricChange={setMetric}
            days={series.data.days}
          />
          {/* 48/52 split, matching the reference's uneven bottom row. */}
          <div className="grid grid-cols-[48fr_52fr] gap-3">
            <RecentActivity rows={overview.data.activity} />
            <MemberLoad
              totalMessages={overview.data.memberLoad.totalMessages}
              rows={overview.data.memberLoad.rows}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
