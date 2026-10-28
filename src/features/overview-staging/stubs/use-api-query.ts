"use client";

import { useEffect, useState } from "react";
import {
  HOME_OVERVIEW,
  HOME_OVERVIEW_EMPTY,
  overviewSeries,
  tokenSpendReport,
  homeNeeds,
} from "../overview-mock-data";
import { USAGE_SCOPE_ALL } from "@/features/home/overview-types";
import { HOME_PREVIEW_PATH, OverviewPreviewSchema } from "@/features/home/preview-types";
import PREVIEW_SEED from "../overview-preview-seed.json";
import { monthKey } from "@/features/home/overview-period";
import type { OverviewRead } from "@/features/home/components/overview/use-home-overview-reads";
import { useStagingState, type StagingLoad } from "./staging-state";

/**
 * STUB of `@/shared/hooks/use-api-query › useApiQuery`. Same call shape and the result fields the
 * Overview reads (`data`, `error`, `isPending`, `refetch`), answered from `overview-mock-data.ts`.
 * A path change waits a short fake latency so the kept-previous-data (placeholder) state is visible.
 */
const FAKE_LATENCY_MS = 350;

function resolvePath(path: string, load: StagingLoad): unknown {
  const url = new URL(path, "http://staging.local");
  const empty = load === "empty";
  switch (url.pathname) {
    case "/api/home/overview":
      return empty ? HOME_OVERVIEW_EMPTY : HOME_OVERVIEW;
    case "/api/home/overview-series":
      return overviewSeries(
        url.searchParams.get("channel") ?? USAGE_SCOPE_ALL,
        url.searchParams.get("month") ?? monthKey(),
        empty
      );
    case "/api/home/token-spend":
      return tokenSpendReport(empty);
    case "/api/home/needs":
      return homeNeeds(empty);
    case HOME_PREVIEW_PATH:
      return { overview: empty ? null : OverviewPreviewSchema.parse(PREVIEW_SEED), identities: null };
    default:
      throw new Error(`No staging fixture for ${url.pathname}`);
  }
}

export function useApiQuery<T>(
  path: string | null,
  opts: { keepPreviousData?: boolean } = {}
): OverviewRead<T> {
  const { load, epoch } = useStagingState();
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; data: T | undefined; error: Error | null }>(
    { key: "", data: undefined, error: null }
  );
  const key = `${path}|${load}|${epoch}|${nonce}`;

  useEffect(() => {
    if (load === "loading" || path === null) return;
    const timer = setTimeout(() => {
      if (load === "error") {
        setResult({ key, data: undefined, error: new Error("Could not load Overview.") });
      } else {
        setResult({ key, data: resolvePath(path, load) as T, error: null });
      }
    }, FAKE_LATENCY_MS);
    return () => clearTimeout(timer);
  }, [key, load, path]);

  const settled = result.key === key;
  // Kept previous data only across a path change in the same staging state (a scope or month
  // flip), never across a toolbar switch to loading/empty/error.
  const keep = Boolean(opts.keepPreviousData) && load === "ready" && result.error === null;
  const placeholder = !settled && keep && result.data !== undefined;
  return {
    data: settled || keep ? result.data : undefined,
    error: settled ? result.error : null,
    // TanStack v5: kept previous data is a success with `isPlaceholderData`, not pending.
    isPending: !settled && !placeholder,
    isPlaceholderData: placeholder,
    refetch: async () => setNonce((n) => n + 1),
  };
}
