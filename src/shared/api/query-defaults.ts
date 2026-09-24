import type { DefaultOptions } from "@tanstack/react-query";
import { isNetworkError } from "./api-envelope";

/**
 * The app's TanStack Query defaults, in ONE place — ⚠ mounted by BOTH the web
 * `QueryProvider` and the desktop SPA (`apps/desktop-ui/src/lib/query-client.ts`
 * via its `@web/query-defaults` alias, the single sanctioned import from this
 * tree into the renderer).
 *
 * ⚠ Framework-free: no `"use client"`, no React, no Next, no DOM. That is what
 * makes it safe for a Vite renderer, and the bar any future shared module clears.
 *
 * Tuned for this app's access pattern (ENGINEERING §7):
 *   - staleTime 30s: navigating back within 30s renders from cache, no refetch;
 *   - refetchOnWindowFocus only when stale;
 *   - one retry; 4xx are not retried (ApiError carries the status);
 *   - a network failure (offline, sleep/wake) retries NETWORK_RETRY_LIMIT times,
 *     1s → 2s → 4s.
 *
 * ⚠ A DEFAULT IS ONLY A DEFAULT IF THE CALLER OMITS THE KEY. TanStack merges by
 * spread, so a key present with value `undefined` DELETES the entry below it
 * (F-163). `use-api-query-core.ts › definedOnly` is the enforcement point;
 * anything building query options from optional caller input owes the same.
 */

/** 24h — beyond that, skeleton honestly. Also the persisted-cache `maxAge`;
 *  `gcTime` must be >= it or restored entries are collected before use. */
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const NETWORK_RETRY_LIMIT = 3;
const NETWORK_RETRY_CAP_MS = 8_000;
// TanStack's own default cap, kept for everything that is not a network failure.
const DEFAULT_RETRY_CAP_MS = 30_000;

export const QUERY_DEFAULT_OPTIONS: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    retry: (failureCount, error) => {
      if (isNetworkError(error)) return failureCount < NETWORK_RETRY_LIMIT;
      const status = (error as { status?: number }).status;
      // `status: 0` without a network code (a bridge failure) retries like a status-less error.
      if (status !== undefined && status > 0 && status < 500) return false;
      return failureCount < 1;
    },
    retryDelay: (failureCount, error) =>
      Math.min(
        1000 * 2 ** failureCount,
        isNetworkError(error) ? NETWORK_RETRY_CAP_MS : DEFAULT_RETRY_CAP_MS
      ),
  },
};
