"use client";

import { useEffect, useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { QUERY_CACHE_BUSTER, createIdbPersister } from "./idb-persister";
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

  // Fleet audit 2026-08-03 (high): the persisted cache outlived the session,
  // restoring the PREVIOUS account's data for the next sign-in. Any signed-
  // out transition wipes both the live cache and the disk snapshot.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    void (async () => {
      try {
        const { getSupabaseBrowser } = await import("@/shared/supabase/browser");
        const { data } = getSupabaseBrowser().auth.onAuthStateChange((event: string) => {
          if (event === "SIGNED_OUT") {
            client.clear();
            void persister.removeClient();
          }
        });
        unsub = () => data.subscription.unsubscribe();
      } catch {
        // No browser Supabase config (SPA renderer) — the SPA clears via
        // its own bridge auth push instead.
      }
    })();
    return () => {
      if (unsub) unsub();
    };
  }, [client, persister]);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: QUERY_CACHE_MAX_AGE_MS,
        // Build-keyed: a deploy that reshapes any response must not be able to
        // hydrate yesterday's shape. TanStack drops the whole snapshot when
        // this differs from the one it was persisted with (`./idb-persister`).
        buster: QUERY_CACHE_BUSTER,
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
