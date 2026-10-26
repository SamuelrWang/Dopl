// STAGING ONLY — Overview Version D: /home → Overview RESTRUCTURED (not reskinned) on the landing
// mockups. Toggled from the staging toolbar ("Version"); Current is untouched.
"use client";

import { useMemo, useState } from "react";
import {
  EMPTY_SERIES,
  HOME_OVERVIEW_DEFAULT_RANGE,
  type HomeOverview,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { useApiQuery } from "@/features/overview-staging/stubs/use-api-query";
import { useWorkspaceEntitlements } from "@/features/overview-staging/stubs/use-workspace-entitlements";
import { PageError } from "@/features/overview-staging/stubs/page-states";
import { openHomeSettings } from "@/features/overview-staging/stubs/home-settings-control";
import { DEVICES_MOCK, DEVICES_MOCK_USER_ID } from "@/features/overview-staging/overview-mock-data";
import {
  bucketByLocalDay,
  windowDays,
  type TokenSpendReport,
} from "@/features/overview-staging/components/overview/token-spend-strip";
import { AddDeviceChooser } from "../devices-mock/devices-overview";
import { ActivityLog } from "./overview-d-activity";
import { ChannelsCard, DevicesCard, SpendCard } from "./overview-d-cards";
import { NEEDS, deviceLines, liveAgents } from "./overview-d-data";
import { NowHero } from "./overview-d-hero";
import "./overview-d.css";

/**
 * THE HIERARCHY, TOP TO BOTTOM.
 *
 *   1. HERO, "Right now" (full width, the biggest thing on the page): three figures (working,
 *      need you, devices online), then every running agent as a Monitoring-log row beside the
 *      asks that are waiting on you, each with its Approve / Deny / Answer.
 *   2. SUPPORT ROW, three small cards: Spend (credits + the month's bars + tokens), Devices
 *      (every device, one line each), Top channels (five rows).
 *   3. ACTIVITY (full width): the Monitoring log on the devices feed, filter chips per device.
 *
 * Cut from Current, and why, is in PORTING.md › "Version D (whole page)". Same reads and gates
 * as Current (`overview-panels.tsx`), so the toolbar's Reads, Plan and Devices controls drive it.
 */
export function HomeOverviewD({
  homeWorkspaceId,
  currentUserId,
}: {
  homeWorkspaceId: string | null;
  currentUserId?: string | null;
}) {
  const overview = useApiQuery<HomeOverview>(
    `/api/home/overview?range=${HOME_OVERVIEW_DEFAULT_RANGE}`,
    { keepPreviousData: true }
  );
  // The default series path: All channels, this month (`usageSeriesPath` with no params).
  const series = useApiQuery<HomeOverviewSeries>(
    `/api/home/overview-series?range=${HOME_OVERVIEW_DEFAULT_RANGE}`
  );
  const spend = useApiQuery<TokenSpendReport>("/api/home/token-spend");
  const wallet = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);

  const preview = currentUserId === DEVICES_MOCK_USER_ID;
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const hosts = DEVICES_MOCK.hosts;
  const agents = useMemo(() => (preview ? liveAgents(hosts) : []), [preview, hosts]);
  const lines = useMemo(() => deviceLines(hosts), [hosts]);
  const deviceMap = useMemo(
    () => new Map(lines.map((l) => [l.id, { name: l.name, kind: l.kind }])),
    [lines]
  );

  if (overview.error) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageError error={overview.error} onRetry={() => void overview.refetch()} />
      </div>
    );
  }

  const walletReady = !wallet.loading && Boolean(homeWorkspaceId);
  const creditsOut =
    walletReady && wallet.credits.remaining === 0 && wallet.credits.limit > 0;
  const needs = preview ? NEEDS.filter((n) => !resolved.has(n.id)) : [];
  const tokens =
    spend.data && spend.data.marks.length > 0
      ? bucketByLocalDay(spend.data.marks, windowDays(31)).total
      : null;
  const openBilling = () => openHomeSettings("billing");

  return (
    <div className="ovd">
      <div className="ovd-inner">
        <NowHero
          agents={agents}
          needs={needs}
          creditsOut={creditsOut}
          devices={
            preview
              ? {
                  online: lines.filter((l) => l.status === "active").length,
                  total: lines.length,
                }
              : null
          }
          onResolve={(id) => setResolved((s) => new Set(s).add(id))}
          onGetCredits={openBilling}
        />

        {adding && <AddDeviceChooser onClose={() => setAdding(false)} />}

        <div className="ovd-support" data-cols={preview ? 3 : 2}>
          <SpendCard
            credits={walletReady ? wallet.credits : null}
            isPaid={wallet.isPaid}
            points={series.data ? (series.data.points ?? EMPTY_SERIES) : null}
            tokens={tokens}
            onGetCredits={openBilling}
          />
          {preview && <DevicesCard lines={lines} onAdd={() => setAdding((v) => !v)} />}
          <ChannelsCard data={overview.data} />
        </div>

        {preview && <ActivityLog devices={deviceMap} />}
      </div>
    </div>
  );
}
