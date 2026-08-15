import type { DefaultOptions } from "@tanstack/react-query";

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
 *   - one retry; 4xx are not retried (ApiError carries the status).
 *
 * ⚠ A DEFAULT IS ONLY A DEFAULT IF THE CALLER OMITS THE KEY. TanStack merges by
 * spread, so a key present with value `undefined` DELETES the entry below it
 * (F-163). `use-api-query-core.ts › definedOnly` is the enforcement point;
 * anything building query options from optional caller input owes the same.
 */

/** 24h — beyond that, skeleton honestly. Also the persisted-cache `maxAge`;
 *  `gcTime` must be >= it or restored entries are collected before use. */
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const QUERY_DEFAULT_OPTIONS: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    gcTime: QUERY_CACHE_MAX_AGE_MS,
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      if (status !== undefined && status < 500) return false;
      return failureCount < 1;
    },
  },
};
