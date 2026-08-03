import type { DefaultOptions } from "@tanstack/react-query";

/**
 * The app's TanStack Query defaults, in ONE place because two clients now
 * mount them: the web `QueryProvider` (`./query-provider.tsx`) and the desktop
 * SPA (`apps/desktop-ui/src/lib/query-client.ts`, which imports this file
 * through its `@web/query-defaults` alias — the single sanctioned import from
 * this tree into the renderer, see apps/desktop-ui/CONVENTIONS.md).
 *
 * Deliberately framework-free: no `"use client"`, no React, no Next, no DOM.
 * That is what makes it safe for a Vite renderer to consume directly, and it
 * is the bar any future shared module must clear.
 *
 * Defaults tuned for this app's access pattern (ENGINEERING §7) — server data
 * changes mostly through the user's own actions or realtime signals, so:
 *   - staleTime 30s: navigating back to a page within 30s renders from cache
 *     with no refetch.
 *   - refetchOnWindowFocus only when stale.
 *   - one retry; 4xx are not retried (ApiError carries the status).
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
