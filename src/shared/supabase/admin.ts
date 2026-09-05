import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL environment variable is not set");
}

/** Server-side admin client (service role key, ⚠ bypasses RLS). Lazy-initialized
 *  so evaluating this module on the client does not throw. */
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

/** Auth-aware Supabase client for Server Components and API routes; reads and
 *  writes session cookies. */
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
          // setAll can fire from Server Components, where cookies are
          // read-only. Fine — the middleware handles the refresh.
        }
      },
    },
  });
}

/**
 * READ-ONLY session client for the DESKTOP HANDOFF LEG (2026-09-04 sign-out root cause).
 *
 * ⚠ ONE FAMILY, ONE HOLDER. Supabase rotates the refresh token on every use and revokes the
 * WHOLE family when a rotated one is presented again ("Possible abuse attempt", error_code
 * `refresh_token_already_used`). `/auth/callback?desktop=1` used to exchange the PKCE code with
 * the cookie-WRITING client above, which left the system browser holding the very session the
 * desktop then adopted — a second, never-rotating holder of the same family. Hours later that
 * frozen cookie was refreshed (by the browser's own supabase-js, or by `src/proxy.ts`'s
 * `getClaims()` on the next page load), GoTrue revoked the family, and the desktop's live token
 * died mid-life. Field evidence: auth.refresh_tokens rows 3781/3784 (the sign-in tokens) reused
 * at 2026-09-04T01:33:57Z and 22:45:16Z, each revoking the desktop's then-current token
 * (3783 / 3788) minutes before the app's own scheduled refresh 400'd three times and signed out.
 *
 * So the desktop leg exchanges the code with a client that READS the browser's cookies (the PKCE
 * code-verifier lives there) and WRITES none. The session it returns goes to the app and nowhere
 * else. Do not "fix" a missing session here by falling back to the writing client.
 */
export function createDesktopHandoffSupabaseClient(cookieStore: {
  getAll(): { name: string; value: string }[];
}) {
  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Deliberately nothing. See the note above — a write here is the bug.
      },
    },
  });
}
