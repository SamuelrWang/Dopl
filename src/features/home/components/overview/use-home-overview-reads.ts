"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import {
  useWorkspaceEntitlements,
  type WorkspaceCreditsStatus,
} from "@/features/billing/components/use-workspace-entitlements";
import { useConnectedDevices } from "@/features/devices/components/use-devices";
import type { ConnectedDevice } from "@/features/devices/types";
import {
  HOME_OVERVIEW_DEFAULT_RANGE,
  type HomeOverview,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { usageSeriesPath } from "@/features/home/overview-period";
import type { TokenSpendReport } from "@/shared/lib/token-spend-days";

export interface OverviewRead<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  /** The previous key's data, shown while this key's read lands (`keepPreviousData`). */
  isPlaceholderData: boolean;
  refetch: () => unknown;
}

/** Everything the Overview face reads. A host that cannot reach the API (the UI playground) passes
 *  its own hook of this shape. */
export interface HomeOverviewReads {
  overview: OverviewRead<HomeOverview>;
  series: OverviewRead<HomeOverviewSeries>;
  spend: OverviewRead<TokenSpendReport>;
  wallet: { loading: boolean; credits: WorkspaceCreditsStatus; isPaid: boolean };
  devices: { devices: ConnectedDevice[] | null; failed: boolean };
}

export interface HomeOverviewReadArgs {
  scope: string;
  month: string;
  /** The reader's `kind='home'` container: the wallet the credit figures are charged to. */
  homeWorkspaceId: string | null;
}

/** The face's reads: cold, no realtime and no poll. Overview and series keep the previous payload
 *  across a key change (`isPlaceholderData`), so a scope or month flip dims the bars instead of
 *  blanking the card. */
export function useHomeOverviewReads({
  scope,
  month,
  homeWorkspaceId,
}: HomeOverviewReadArgs): HomeOverviewReads {
  const overview = useApiQuery<HomeOverview>(
    `/api/home/overview?range=${HOME_OVERVIEW_DEFAULT_RANGE}`,
    { keepPreviousData: true }
  );
  const series = useApiQuery<HomeOverviewSeries>(usageSeriesPath(scope, month), {
    keepPreviousData: true,
  });
  const spend = useApiQuery<TokenSpendReport>("/api/home/token-spend");
  const entitlements = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);
  const devices = useConnectedDevices({ live: false });
  return {
    overview,
    series,
    spend,
    wallet: {
      loading: entitlements.loading || !homeWorkspaceId,
      credits: entitlements.credits,
      isPaid: entitlements.isPaid,
    },
    devices,
  };
}
