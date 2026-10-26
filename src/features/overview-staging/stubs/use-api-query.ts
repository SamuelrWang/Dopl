"use client";

import { useEffect, useState } from "react";
import {
  HOME_OVERVIEW,
  HOME_OVERVIEW_EMPTY,
  overviewSeries,
  tokenSpendReport,
} from "../overview-mock-data";
import { USAGE_SCOPE_ALL } from "@/features/home/overview-types";
import { monthKey } from "../pages/home/overview-usage-filter";
import { useStagingState, type StagingLoad } from "./staging-state";

/**
 * STUB of `apps/desktop-ui/src/hooks/use-api-query.ts › useApiQuery`. Same call shape
 * (`useApiQuery<T>(path, { keepPreviousData })`) and the same result fields the Overview reads
 * (`data`, `error`, `isPending`, `refetch`), answered from `overview-mock-data.ts`. A path change
 * waits a short fake latency so the dim-while-loading and kept-previous-data states are visible.
 */
const FAKE_LATENCY_MS = 350;

export interface StubQueryResult<T> {
  data: T | undefined;
  error: Error | null;
  isPending: boolean;
  refetch: () => Promise<void>;
}

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
    default:
      throw new Error(`No staging fixture for ${url.pathname}`);
  }
}

export function useApiQuery<T>(
  path: string | null,
  opts: { keepPreviousData?: boolean } = {}
): StubQueryResult<T> {
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
  const keep = opts.keepPreviousData && load === "ready" && result.error === null;
  return {
    data: settled || keep ? result.data : undefined,
    error: settled ? result.error : null,
    isPending: !settled,
    refetch: async () => setNonce((n) => n + 1),
  };
}
