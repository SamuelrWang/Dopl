import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js middleware — runs on every matched request BEFORE the
 * route handler / server component. This is the only place we can
 * mutate response cookies in response to a server-side auth refresh,
 * so it owns the "keep the user logged in" contract.
 *
 * Why this exists:
 *   - `supabase.auth.getUser()` returns a session if the access token
 *     is valid, and silently refreshes it (using the long-lived
 *     refresh token) when it's close to expiry.
 *   - When refresh happens, the Supabase client calls `setAll()` on
 *     our cookie adapter to write the new access + refresh token
 *     cookies. Server Components can't write cookies, so the setAll
 *     in `createServerSupabaseClient` (src/lib/supabase.ts) silently
 *     swallows the error there.
 *   - WITHOUT middleware, that means refreshed tokens are never
 *     persisted. The access token expires (1h default), the client
 *     sees an expired session, and the user gets bounced to login
 *     even though their refresh token was still valid.
 *   - WITH middleware, we run the same `getUser()` early on every
 *     request against a `NextResponse` whose cookies CAN be written.
 *     Any refresh that happens here lands in the browser on the next
 *     response.
 *
 * Pattern mirrors the official Supabase Next.js quickstart:
 * https://supabase.com/docs/guides/auth/server-side/nextjs
 */
export async function middleware(request: NextRequest) {
  // Seed a response that carries forward the incoming request headers.
  // We mutate its cookies jar when Supabase needs to refresh tokens;
  // returning this response delivers those cookies to the browser.
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write to both the request cookies (so downstream handlers
          // within this same request see the fresh tokens) AND the
          // response cookies (so the browser stores them).
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({
            request: { headers: request.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // This call is the point of the whole middleware: if the access
  // token is near expiry, Supabase issues a refresh and the setAll
  // above writes the new cookies onto the response.
  //
  // Do NOT move or remove this line — without it the middleware is a
  // no-op and sessions silently expire.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  /**
   * Run on every request EXCEPT:
   *   - Next internals (/_next/*)
   *   - Static assets (favicon, images, fonts)
   *   - The auth callback (/auth/callback) — that route sets cookies
   *     itself via the code-exchange flow and doesn't benefit from a
   *     pre-refresh.
   *   - OG image routes (matching /opengraph-image or /twitter-image) —
   *     served to social-card crawlers that have no session anyway.
   *
   * Everything else (pages, API routes, server components) goes
   * through the refresh.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicons/|img/|auth/callback|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$|.*/opengraph-image$|.*/twitter-image$).*)",
  ],
};
