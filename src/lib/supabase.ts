import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
}

/**
 * Server-side admin client (service role key, bypasses RLS).
 * Lazy-initialized to avoid errors when this module is evaluated on the client.
 */
let _admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server-side operations");
    }
    _admin = createClient(supabaseUrl, serviceRoleKey);
  }
  return _admin;
}

/**
 * Create an auth-aware Supabase client for Server Components and API routes.
 * Reads/writes session cookies for authentication.
 */
export function createServerSupabaseClient(cookieStore: {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
}) {
  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll can be called from Server Components where cookies are read-only.
          // This is fine — the middleware handles the cookie refresh.
        }
      },
    },
  });
}
