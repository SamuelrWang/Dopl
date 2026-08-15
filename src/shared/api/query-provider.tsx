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
 * App-wide TanStack Query client (ENGINEERING §7). ⚠ Defaults live in
 * `./query-defaults.ts` — the desktop SPA mounts the identical client; this file
 * owns only the web-side PERSISTENCE wiring.
 *
 * Cache is PERSISTED to IndexedDB: a cold start hydrates the last snapshot and
 * renders it immediately (stale-while-revalidate) while restored queries refetch
 * per their own staleness. ⚠ `gcTime` must exceed `maxAge` or restored entries
 * are collected between visits.
 */

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: QUERY_DEFAULT_OPTIONS })
  );

  // ⚠ ALWAYS the persist provider, server and client alike: branching the
  // provider type on `typeof window` gives the server and hydrating client
  // different element types at the app root, forcing a full re-render. The
  // persister is inert at render time — its IndexedDB ops run only in effects.
  const [persister] = useState(() => createIdbPersister());

  // ⚠ Any signed-out transition must wipe BOTH the live cache and the disk
  // snapshot, else the persisted cache outlives the session and restores the
  // previous account's data on the next sign-in.
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
        // No browser Supabase config (SPA renderer) — the SPA clears via its
        // own bridge auth push.
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
        // ⚠ Build-keyed: TanStack drops the whole snapshot when this differs
        // from the one it was persisted with, so a deploy that reshapes a
        // response cannot hydrate yesterday's shape.
        buster: QUERY_CACHE_BUSTER,
        // ⚠ Persist only settled successes — a restored error entry renders as
        // a phantom failure.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === "success",
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
