"use client";

import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createIdbPersister } from "./idb-persister";
import {
  QUERY_CACHE_MAX_AGE_MS,
  QUERY_DEFAULT_OPTIONS,
} from "./query-defaults";

/**
 * App-wide TanStack Query client (ENGINEERING §7 server-state layer).
 *
 * The defaults themselves live in `./query-defaults.ts` because the desktop
 * SPA mounts the identical client (apps/desktop-ui) — this file owns only the
 * web-side PERSISTENCE wiring.
 *
 * Phase 1 (docs/DESKTOP-MIGRATION-PLAN.md): the cache is PERSISTED to
 * IndexedDB. A cold start (app relaunch, hard reload) hydrates the last
 * dehydrated snapshot and renders it immediately — stale-while-revalidate
 * instead of a skeleton — while every restored query refetches in the
 * background per its own staleness. `gcTime` must exceed `maxAge` for
 * restored entries to survive garbage collection between visits.
 */

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS })
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
        maxAge: QUERY_CACHE_MAX_AGE_MS,
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
