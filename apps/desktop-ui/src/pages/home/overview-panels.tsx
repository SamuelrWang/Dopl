import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { useState } from "react";
import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import {
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_SERIES,
  EMPTY_TOOL_USAGE,
  HOME_OVERVIEW_DEFAULT_METRIC,
  HOME_OVERVIEW_DEFAULT_RANGE,
  type HomeChannelUsage,
  type HomeOverview,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError } from "#/components/page-states";
import { openHomeSettings } from "./home-settings-control";
import { CreditCapacityBar, UsageChart } from "./overview-sections";
import {
  ChannelCreditRail,
  ChannelMessageRail,
  ClippedNote,
  PeopleRail,
  RailsGhost,
  ToolRail,
  type RankRow,
} from "#/components/overview/rank-rail";
import {
  MonthStepper,
  USAGE_SCOPE_ALL,
  UsageScopeMenu,
  monthKey,
  usageSeriesPath,
} from "./overview-usage-filter";
import { TokenSpendPanel } from "./overview-token-spend";

/**
 * /home → Overview: one account-wide payload, one set of sections — every section is
 * cross-channel (no channel-scoped panel here). Usage (capacity bar over the histogram), Token
 * spend, then the rails. No range switcher: the window is the current month, the same credit
 * period the bar describes. A cold read; no realtime or poll (INVARIANTS §7).
 */
export function HomeOverviewPanels({
  homeWorkspaceId,
}: {
  /** The caller's own workspace from `POST /api/boot`, for the credit bar; null until onboarded. */
  homeWorkspaceId: string | null;
}) {
  const overview = useApiQuery<HomeOverview>(
    `/api/home/overview?range=${HOME_OVERVIEW_DEFAULT_RANGE}`,
    { keepPreviousData: true }
  );

  if (overview.error) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageError
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      </div>
    );
  }

  const data = overview.data;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {/* Every section layers the same way: gray `SectionPanel` → white `.bento` cards. Usage is one
            well behind two cards (the bar, then the histogram). */}
        <SectionPanel id="home-overview-usage" label="Usage">
          <UsageCard homeWorkspaceId={homeWorkspaceId} />
        </SectionPanel>

        {/* A different ledger (a floor, 31-day window) from the credits story; folds away when no
            agent has ever spent anything. */}
        <TokenSpendPanel />

        {/* `?? EMPTY_X` at every read (INVARIANTS §8): `.map` on a key an older persisted entry lacks
            would throw and blank the pane. */}
        <SectionPanel id="home-overview-breakdown" label="All channels">
          {data ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <ChannelCreditRail
                  rows={channelRows(
                    data.channels ?? EMPTY_CHANNEL_USAGE,
                    (row) => row.credits
                  )}
                />
                <ChannelMessageRail
                  rows={channelRows(
                    data.channels ?? EMPTY_CHANNEL_USAGE,
                    (row) => row.messages
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PeopleRail rows={data.people ?? EMPTY_PERSON_USAGE} />
                <ToolRail rows={data.tools ?? EMPTY_TOOL_USAGE} />
              </div>
              {data.truncated && <ClippedNote scanned={data.scanned} />}
            </div>
          ) : (
            <RailsGhost />
          )}
        </SectionPanel>
      </div>
    </div>
  );
}

/**
 * The Usage block: the capacity-bar card over the histogram card. The scope/month state lives here
 * because it changes this read's path (`usageSeriesPath`); it never moves the bar, which reads the
 * wallet's current period. The series is pinned to `credits` (no metric switcher) and fetched here
 * so the bar can wait on it and the card arrives whole.
 */
function UsageCard({ homeWorkspaceId }: { homeWorkspaceId: string | null }) {
  const [scope, setScope] = useState<string>(USAGE_SCOPE_ALL);
  const [month, setMonth] = useState<string>(() => monthKey());
  const series = useApiQuery<HomeOverviewSeries>(
    usageSeriesPath({
      range: HOME_OVERVIEW_DEFAULT_RANGE,
      metric: HOME_OVERVIEW_DEFAULT_METRIC,
      scope,
      month,
    }),
    { keepPreviousData: true }
  );
  // `?? EMPTY_SERIES` (INVARIANTS §8): an older persisted entry can lack `points`.
  const points = series.data?.points ?? EMPTY_SERIES;
  return (
    <div className="flex flex-col gap-3">
      {/* The rail cards' `.bento` and grid gap, so the panels layer and space identically. */}
      <section className="bento p-3.5" aria-label="Credit allowance">
        {/* The card's own heading (it must outlive the bar's skeleton), on the 14px face — not the
            larger Usage heading; an `h3` under the panel's `h2`. */}
        <h3 className={cn("mb-2 truncate", IDENTITY_NAME_TEXT)}>Credit spend</h3>
        <CreditsBar
          homeWorkspaceId={homeWorkspaceId}
          ledgerPending={series.isPending && !series.data}
        />
      </section>
      <section className="bento flex flex-col p-3.5" aria-label="Usage histogram">
        <UsageChart
          points={points}
          bucket={series.data?.bucket ?? "day"}
          loading={series.isPending}
          truncated={series.data?.truncated ?? false}
          scopeControl={<UsageScopeMenu value={scope} onChange={setScope} />}
          monthControl={<MonthStepper month={month} onChange={setMonth} />}
        />
      </section>
    </div>
  );
}

/**
 * The allowance bar. Both numbers come off `GET /api/billing/status` (the settings billing pane's
 * cache entry): `spent` is the WALLET counter, the figure enforcement charged, and the server
 * narrows the plot to that wallet's ledger rows so the two agree. A payer that never resolved
 * answers `degraded`, and the LIMIT (not the spend) falls back (`CreditCapacityBar`).
 */
function CreditsBar({
  homeWorkspaceId,
  ledgerPending,
}: {
  homeWorkspaceId: string | null;
  /** The ledger read has not landed and there is no previous series. Still a gate: the bar and the
   *  plot are one card. */
  ledgerPending: boolean;
}) {
  const credits = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);
  // A ghost of the bar's height while a read is in flight or there is no workspace — never a zeroed
  // bar claiming a spend nobody measured. A kept previous series does not re-ghost.
  if (credits.loading || !homeWorkspaceId || ledgerPending) {
    return <Skeleton className="h-[54px] w-full rounded-lg" />;
  }
  // `!isPaid`, not `plan === "free"`: it reads plan and status together, so a stale `pro` row that is
  // no longer active is offered the upgrade; a `past_due` payer needs the portal, not a checkout.
  return (
    <CreditCapacityBar
      credits={credits.credits}
      spent={credits.credits.used}
      onUpgrade={
        credits.isPaid ? undefined : () => openHomeSettings("billing")
      }
    />
  );
}

/** /home keys a channel rail row by its container `workspaceId`; the shared rail takes `RankRow`s. */
function channelRows(
  rows: readonly HomeChannelUsage[],
  value: (row: HomeChannelUsage) => number
): RankRow[] {
  return rows.map((row) => ({
    id: row.workspaceId,
    name: row.name,
    value: value(row),
  }));
}
