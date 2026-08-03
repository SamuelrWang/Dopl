"use client";

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Get the Supabase browser client (singleton).
 * Use in Client Components for auth operations.
 */
export function getSupabaseBrowser() {
  if (!client) {
    // Under the bundled desktop SPA (Vite) `process.env.NEXT_PUBLIC_*` is
    // not injected — and the renderer must not open its own Supabase
    // connections anyway (CSP connect-src 'none'; live updates arrive via
    // the main process in Phase 3). Realtime callers are already no-op'd
    // in SPA mode (see shared-channel-registry); this throw is the honest
    // backstop for any new call site rather than a cryptic createClient
    // failure.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        "getSupabaseBrowser: no browser Supabase config in this runtime (desktop SPA renderer has none by design)"
      );
    }
    client = createBrowserClient(url, key);
  }
  return client;
}
