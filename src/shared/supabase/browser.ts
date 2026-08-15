"use client";

import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Supabase browser client (singleton), for auth operations in Client
 *  Components. */
export function getSupabaseBrowser() {
  if (!client) {
    // ⚠ Under the bundled SPA (Vite) `process.env.NEXT_PUBLIC_*` is not
    // injected, and the renderer must not open its own Supabase connections
    // anyway (CSP connect-src 'none'). This throw is the honest backstop for a
    // new call site rather than a cryptic createClient failure.
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
