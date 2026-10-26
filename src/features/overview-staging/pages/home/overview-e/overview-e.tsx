// STAGING ONLY — Overview Version E (Samuel, 2026-10-26: "completely redesign the overview page,
// literally from scratch"). Toggled from the staging toolbar ("Version E"); Current and D are
// untouched. Same reads, gates and fixtures as both (`../overview-panels.tsx`,
// `../overview-d/overview-d.tsx`); no component of theirs is imported or copied.
"use client";

import { useMemo, useState } from "react";
import { RotateCw } from "lucide-react";
import {
  EMPTY_SERIES,
  HOME_OVERVIEW_DEFAULT_RANGE,
  USAGE_SCOPE_ALL,
  type HomeOverview,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { useApiQuery } from "@/features/overview-staging/stubs/use-api-query";
import { useWorkspaceEntitlements } from "@/features/overview-staging/stubs/use-workspace-entitlements";
import { openHomeSettings } from "@/features/overview-staging/stubs/home-settings-control";
import { DEVICES_MOCK, DEVICES_MOCK_USER_ID } from "@/features/overview-staging/overview-mock-data";
import type { TokenSpendReport } from "@/features/overview-staging/components/overview/token-spend-strip";
import { AgentsCard, NeedsCard, SummaryStrip } from "./overview-e-now";
import { CreditsCard, TokensCard } from "./overview-e-usage";
import { ActivityCard, DevicesCard } from "./overview-e-devices";
import { ChannelsTable, ClippedLine, PeopleCard, ToolsCard } from "./overview-e-ledger";
import { OverviewESkeleton } from "./overview-e-skeleton";
import { NEEDS, deviceDirectory, monthKeyOf, seriesPath } from "./overview-e-data";
import "./overview-e.css";
import "./overview-e-parts.css";

/**
 * TOP TO BOTTOM.
 *   1. Summary strip: one card, four cells (Working, Need you, Devices online, Credits left).
 *   2. Two columns. Main: Needs you, Agents (by computer), Activity (Routing | Logs).
 *      Side: Credits (allowance + the month's daily credits, scope, month), Tokens (31 days),
 *      Devices (reach order, every device, Add device).
 *   3. Channels: one table, credits and messages on the same row.
 *   4. People and MCP tools side by side, then the clipped-scan line.
 * Agents, Needs (D's two asks), Devices and Activity follow the Devices preview gate, as in
 * Current and D.
 */
export function HomeOverviewE({
  homeWorkspaceId,
  currentUserId,
}: {
  homeWorkspaceId: string | null;
  currentUserId?: string | null;
}) {
  const [scope, setScope] = useState<string>(USAGE_SCOPE_ALL);
  const [month, setMonth] = useState<string>(() => monthKeyOf());
  const overview = useApiQuery<HomeOverview>(`/api/home/overview?range=${HOME_OVERVIEW_DEFAULT_RANGE}`, {
    keepPreviousData: true,
  });
  const series = useApiQuery<HomeOverviewSeries>(seriesPath(scope, month), { keepPreviousData: true });
  const spend = useApiQuery<TokenSpendReport>("/api/home/token-spend");
  const wallet = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);

  const preview = currentUserId === DEVICES_MOCK_USER_ID;
  const devices = useMemo(() => deviceDirectory(DEVICES_MOCK.hosts), []);
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());

  if (overview.error) {
    return (
      <div className="ove">
        <div className="ove-error" role="alert">
          <p className="ove-error-text">{overview.error.message}</p>
          <button type="button" className="ove-btn" onClick={() => void overview.refetch()}>
            <RotateCw size={12} aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!overview.data) return <OverviewESkeleton preview={preview} />;

  const data = overview.data;
  const walletReady = !wallet.loading && Boolean(homeWorkspaceId);
  const credits = walletReady ? wallet.credits : null;
  const over = Boolean(credits && credits.remaining === 0 && credits.limit > 0);
  const needs = preview ? NEEDS.filter((n) => !resolved.has(n.id)) : [];
  const rows = [...devices.values()];
  const openBilling = () => openHomeSettings("billing");

  return (
    <div className="ove">
      <div className="ove-inner">
        <SummaryStrip
          hosts={preview ? DEVICES_MOCK.hosts : null}
          needCount={needs.length + (over ? 1 : 0)}
          devices={preview ? { online: rows.filter((d) => d.status === "active").length, total: rows.length } : null}
          wallet={credits ? { used: credits.used, limit: credits.limit, remaining: credits.remaining, over } : null}
        />
        <div className="ove-grid">
          <div className="ove-col">
            <NeedsCard
              needs={needs}
              creditsOut={over}
              onResolve={(id) => setResolved((s) => new Set(s).add(id))}
              onGetCredits={openBilling}
            />
            {preview && <AgentsCard hosts={DEVICES_MOCK.hosts} />}
            {preview && <ActivityCard mock={DEVICES_MOCK} devices={devices} />}
          </div>
          <div className="ove-col">
            <CreditsCard
              credits={credits}
              isPaid={wallet.isPaid}
              points={series.data ? (series.data.points ?? EMPTY_SERIES) : null}
              truncated={series.data?.truncated ?? false}
              loadingPoints={series.isPending}
              scope={scope}
              month={month}
              onScope={setScope}
              onMonth={setMonth}
              onGetCredits={openBilling}
            />
            <TokensCard marks={spend.data ? spend.data.marks : null} />
            {preview && <DevicesCard mock={DEVICES_MOCK} devices={devices} />}
          </div>
        </div>
        <ChannelsTable data={data} />
        <div className="ove-pair">
          <PeopleCard data={data} />
          <ToolsCard data={data} />
        </div>
        <ClippedLine data={data} />
      </div>
    </div>
  );
}
