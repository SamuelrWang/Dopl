"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type {
  OverviewSeriesMetric,
  OverviewSeriesPoint,
  WorkspaceOverviewSeries,
} from "../types";

/**
 * `GET /api/workspaces/[workspaceSlug]/overview-series` — the daily-binned
 * histogram, optionally narrowed to ONE channel.
 *
 * ⚠ THIS IS THE ROUTE'S FIRST CLIENT (2026-08-25). It shipped in the desktop
 * overview wave with its own suite and no consumer — measured with
 * `grep -rn overview-series src apps`, which returned the route and its test
 * and nothing else. So there was no existing hook to extend and no existing
 * caller whose behaviour this could change.
 *
 * ⚠ THE CHANNEL SCOPE IS PART OF THE KEY, because it is part of the PATH.
 * `useApiQuery` keys on the path it is given (INVARIANTS §8), so two channels'
 * series are two entries and a cached strip can never be painted under the
 * wrong channel's heading. Nothing here has to remember to invalidate on a
 * selection change.
 *
 * ⚠ NO `workspaceId` HEADER. This route is `[workspaceSlug]`-scoped and
 * resolves membership from the SEGMENT — it is not a `withWorkspaceAuth` route,
 * so sending the header would be cargo, not a fence.
 */

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_DAYS: OverviewSeriesPoint[] = [];

const selectDays = (body: WorkspaceOverviewSeries) => body.days ?? NO_DAYS;

export function useOverviewSeries({
  workspaceSegment,
  metric,
  channelId = null,
  enabled = true,
}: {
  /** `{slug}-{publicId}` — what this route addresses by. */
  workspaceSegment: string;
  metric: OverviewSeriesMetric;
  /** ⚠ `mcp` + a channel is a 400 by construction (`mcp_tool_calls` has no
   *  channel column) — see `server/service-overview.ts`. */
  channelId?: string | null;
  /** Off until the caller has a segment and a channel worth asking about. */
  enabled?: boolean;
}) {
  const query = new URLSearchParams({ metric });
  if (channelId) query.set("channelId", channelId);
  const path = enabled
    ? `/api/workspaces/${encodeURIComponent(workspaceSegment)}/overview-series?${query}`
    : null;

  const result = useApiQuery<WorkspaceOverviewSeries, OverviewSeriesPoint[]>(
    path,
    { select: selectDays }
  );
  return {
    /**
     * ⚠ `?? NO_DAYS`, and it is not defensive noise. The query cache is
     * IndexedDB-persisted across launches, so an entry written by an older
     * bundle can be missing a field this one reads — the standing stale-cache
     * rule. An empty array renders NOTHING (`ThreadActivityStrip` returns null),
     * which is the correct answer for "this cache entry cannot say".
     */
    days: result.data ?? NO_DAYS,
    loading: result.isPending,
    error: result.error,
  };
}
