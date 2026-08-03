"use client";

import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createIdbPersister } from "./idb-persister";

/**
 * App-wide TanStack Query client (ENGINEERING §7 server-state layer).
 *
 * Defaults tuned for this app's access pattern — server data changes
 * mostly through the user's own actions or realtime signals, so:
 *   - staleTime 30s: navigating back to a page within 30s renders from
 *     cache with no refetch (kills the refetch-everything-on-focus cost).
 *   - refetchOnWindowFocus only when stale.
 *   - one retry; 4xx are not retried (ApiError carries the status).
 *
 * Phase 1 (docs/DESKTOP-MIGRATION-PLAN.md): the cache is PERSISTED to
 * IndexedDB. A cold start (app relaunch, hard reload) hydrates the last
 * dehydrated snapshot and renders it immediately — stale-while-revalidate
 * instead of a skeleton — while every restored query refetches in the
 * background per its own staleness. `gcTime` must exceed `maxAge` for
 * restored entries to survive garbage collection between visits.
 */

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h — beyond that, skeleton honestly

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: CACHE_MAX_AGE_MS,
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status;
              if (status !== undefined && status < 500) return false;
              return failureCount < 1;
            },
          },
        },
      })
  );

  // ALWAYS the persist provider, on server and client alike — branching
  // the provider type on `typeof window` would give the server and the
  // hydrating client different element types at the app root, forcing a
  // full client-side re-render. The persister object is inert at render
  // time: its IndexedDB operations only run from client-side effects, so
  // the SSR pass never touches `indexedDB`.
  const [persister] = useState(() => createIdbPersister());

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE_MS,
        // Persist only settled successes — an error entry restored from
        // disk would render as a phantom failure.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === "success",
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
