"use client";

import { useEffect, useState } from "react";
import {
  HOME_OVERVIEW_DEFAULT_RANGE,
  type HomeOverview,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { usageSeriesPath } from "@/features/home/overview-period";
import type { TokenSpendReport } from "@/features/home/token-spend-days";
import type {
  HomeOverviewReadArgs,
  HomeOverviewReads,
} from "@/features/home/components/overview/use-home-overview-reads";
import { connectedDevices } from "../overview-mock-data";
import { useApiQuery } from "./use-api-query";
import { useStagingState } from "./staging-state";
import { useWorkspaceEntitlements } from "./use-workspace-entitlements";

const DEVICES_LATENCY_MS = 300;

/**
 * STUB of `home/components/overview/use-home-overview-reads.ts › useHomeOverviewReads`: the same
 * reads, on the same paths, answered by the staging stubs.
 */
export function useStagingOverviewReads({
  scope,
  month,
  homeWorkspaceId,
}: HomeOverviewReadArgs): HomeOverviewReads {
  const { load, epoch } = useStagingState();
  const overview = useApiQuery<HomeOverview>(
    `/api/home/overview?range=${HOME_OVERVIEW_DEFAULT_RANGE}`,
    { keepPreviousData: true }
  );
  const series = useApiQuery<HomeOverviewSeries>(usageSeriesPath(scope, month), {
    keepPreviousData: true,
  });
  const spend = useApiQuery<TokenSpendReport>("/api/home/token-spend");
  const wallet = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);

  const key = `${load}|${epoch}`;
  const [devicesKey, setDevicesKey] = useState<string | null>(null);
  useEffect(() => {
    if (load === "loading") return;
    const timer = setTimeout(() => setDevicesKey(key), DEVICES_LATENCY_MS);
    return () => clearTimeout(timer);
  }, [key, load]);

  return {
    overview,
    series,
    spend,
    wallet,
    devices: {
      devices: devicesKey === key ? connectedDevices(load === "empty") : null,
      failed: false,
    },
  };
}
