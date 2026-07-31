import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = [
  "/login",
  "/auth/callback",
  // Desktop app sign-in bridge: /auth/desktop-start (pre-auth, kicks off OAuth
  // in the system browser), /auth/desktop-handoff (hands the session to the
  // dopl:// deep link), /auth/desktop-complete (loaded in the app window to
  // adopt the session). All must bypass the session gate — the user isn't
  // signed in within the app window until desktop-complete runs.
  "/auth/desktop",
  "/api/billing/webhook",
  // Cron + scheduled jobs are machine-to-machine: invoked by Vercel Cron with
  // a Bearer CRON_SECRET that the routes verify themselves. They must bypass
  // the session gate (same rationale as the billing webhook above) or the
  // middleware 401s them before their own auth runs — so the jobs never fire.
  "/api/cron/",
  "/terms",
  "/privacy",
  "/pricing",
  // Canvas invite acceptance — invitee may not be signed in yet. The
  // landing page shows what they're being invited to; the underlying
  // accept POST is still auth-gated by withUserAuth, so non-members
  // still bounce to /login at the click.
  "/invite/",
  "/api/workspaces/invitations/",
  // Remote MCP + OAuth surface. These self-authenticate: the /api/mcp handler
  // returns its own MCP-spec 401 + WWW-Authenticate (so clients can discover
  // the OAuth server and start the login dance); the OAuth endpoints are
  // public per spec or do their own session/PKCE checks; the /oauth/authorize
  // consent page runs its own getUser + login bounce (preserving the OAuth
  // query). They MUST bypass the middleware session gate or the dance never
  // starts. "/api/oauth" covers /api/oauth/* plus the /api/oauth-*-server
  // metadata routes.
  "/.well-known/oauth-",
  "/oauth/authorize",
  "/api/oauth",
  "/api/mcp",
];

// The subset of PUBLIC_ROUTES that is MACHINE-authenticated: no human session is
// involved, so nothing below the auth call can change what these routes do. They
// short-circuit BEFORE `getClaims()`, because even local verification can go to
// the network once per process (the JWKS fetch) — and `/api/mcp` streams, with its
// whole correctness resting on response headers reaching the client inside the
// client's 60s time-to-headers budget. Spending any of that on authenticating a
// route that self-authenticates is pure risk.
//
// The rest of PUBLIC_ROUTES stays BELOW the auth call on purpose: /login and the
// marketing pages are public but session-AWARE (a signed-in visitor to /login is
// bounced into the app), so they still need the claims read.
const SELF_AUTH_ROUTES = [
  "/api/mcp",
  "/api/oauth",
  "/.well-known/oauth-",
  "/api/billing/webhook",
  "/api/cron/",
];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Q12 (2026-07-31 self-DDoS incident) — this used to be `getUser()`, a NETWORK
  // round-trip to GoTrue (≈5 Postgres queries) on EVERY matched request. At ~200k
  // matched requests/day that is the single largest source of the auth-request
  // storm that starved GoTrue until OAuth code-exchange started failing.
  //
  // `getClaims()` verifies the access token LOCALLY. This project's GoTrue signs
  // with an ASYMMETRIC key — `/auth/v1/.well-known/jwks.json` publishes exactly one
  // ES256 (EC P-256) key with a `kid`, and the anon key is the new `sb_publishable_`
  // format, so there is no legacy HS256 shared secret left — which means auth-js
  // takes the WebCrypto path: fetch the JWK once (cached process-wide in
  // `GLOBAL_JWKS` for `JWKS_TTL` = 10 min), then `crypto.subtle.verify` the ES256
  // signature in-process. Signatures ARE still checked; nothing is trusted on
  // decode alone. If a token ever arrives with `alg: HS*` or no `kid` (a legacy
  // pre-rotation token), auth-js falls back to a network `getUser()` on its own, so
  // the swap degrades to today's behavior rather than skipping verification.
  //
  // COOKIE REFRESH IS PRESERVED, and this is the load-bearing part: `getClaims()`
  // with no argument calls `getSession()` first, and `getSession()` still does the
  // rotating-cookie refresh — when the stored session is within `EXPIRY_MARGIN_MS`
  // (90s) of expiry it POSTs `token?grant_type=refresh_token`, the new session goes
  // through the storage adapter, and the `setAll` callback above rebuilds
  // `supabaseResponse` with the rotated cookies. So the network call now happens
  // ONLY near expiry (~1/hour/session) instead of on every request.
  //
  // THE try/catch IS LOAD-BEARING — do not simplify it away. `getClaims()` only
  // converts `AuthError`s into `{ data: null, error }`; auth-js `validateExp`
  // throws a PLAIN `Error` ("JWT has expired" / "Missing exp claim") which
  // `getClaims()` RE-THROWS at the caller. `getUser()` could never do that, and
  // an uncaught throw here is a 500 on every server-rendered page — the exact
  // shape of the incident this change exists to prevent. Pinned by
  // `proxy-claims.test.ts`. Every other failure (JWKS unreachable, refresh
  // refused) already returns an error object; both roads end at `userId = null`,
  // i.e. the same "not authenticated" branches a failed `getUser()` landed in.
  const { pathname } = request.nextUrl;

  // Machine-authenticated routes never touch the auth call (see SELF_AUTH_ROUTES).
  if (SELF_AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    return supabaseResponse;
  }

  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims.sub ?? null;
  } catch {
    userId = null;
  }

  // Audit fix S-8: redirect mixed-case URLs to lowercase. Slugs in this
  // app (workspaces, canvases, knowledge bases, entries, clusters) are
  // generated lowercase, but Next's router is case-sensitive — so a
  // pasted `/Default/knowledge` 404s instead of resolving to the same
  // workspace as `/default/knowledge`. 308 redirects so the canonical
  // lowercase form is the one search engines and history remember.
  //
  // Skip: API routes (path may include case-sensitive UUIDs / tokens
  // / signatures); /_next; OG/twitter image routes; /invite/<token>
  // (signed token); /auth/callback (may carry case-sensitive code).
  if (
    /[A-Z]/.test(pathname) &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    !pathname.startsWith("/invite/") &&
    !pathname.startsWith("/auth/") &&
    !pathname.endsWith("/opengraph-image") &&
    !pathname.endsWith("/twitter-image")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.toLowerCase();
    return NextResponse.redirect(url, 308);
  }

  // Allow OG / Twitter image routes through for social crawlers that
  // have no session. Convention-based route files like
  // /community/[slug]/opengraph-image resolve to paths ending in
  // /opengraph-image or /twitter-image. Redirecting these to /login
  // breaks social card previews.
  if (
    pathname.endsWith("/opengraph-image") ||
    pathname.endsWith("/twitter-image")
  ) {
    return supabaseResponse;
  }

  // If authenticated, redirect landing page and login to /canvas
  if (userId && (pathname === "/" || pathname === "/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/canvas";
    return NextResponse.redirect(url);
  }

  // Allow the landing page (exact match)
  if (pathname === "/") {
    return supabaseResponse;
  }

  // Allow public routes (session-aware: /login bounces a signed-in visitor).
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return supabaseResponse;
  }

  // Allow API routes carrying a remote-MCP OAuth access token (dopl_at_). The
  // route's own auth wrapper validates it; the middleware just must not block
  // the loopback /api/* calls the hosted MCP server makes on the caller's behalf.
  const authHeader = request.headers.get("authorization");
  if (pathname.startsWith("/api/") && authHeader?.includes("dopl_at_")) {
    return supabaseResponse;
  }

  // If not authenticated, redirect to login (for pages) or return 401 (for API)
  if (!userId) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Only add redirectTo if it's not the default landing page
    if (pathname !== "/" && pathname !== "/canvas") {
      url.searchParams.set("redirectTo", pathname);
    }
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
