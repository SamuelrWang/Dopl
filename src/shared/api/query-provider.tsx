"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-wide TanStack Query client (ENGINEERING §7 server-state layer).
 *
 * Defaults tuned for this app's access pattern — server data changes
 * mostly through the user's own actions or realtime signals, so:
 *   - staleTime 30s: navigating back to a page within 30s renders from
 *     cache with no refetch (kills the refetch-everything-on-focus cost).
 *   - refetchOnWindowFocus only when stale.
 *   - one retry; 4xx are not retried (ApiError carries the status).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: (failureCount, error) => {
              const status = (error as { status?: number }).status;
              if (status !== undefined && status < 500) return false;
              return failureCount < 1;
            },
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
