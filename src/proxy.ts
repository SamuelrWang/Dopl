import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = [
  "/login",
  "/auth/callback",
  "/api/og/tweet",
  "/api/og/github",
  "/api/billing/webhook",
  "/terms",
  "/privacy",
  "/pricing",
  "/docs",
  // Canvas invite acceptance — invitee may not be signed in yet. The
  // landing page shows what they're being invited to; the underlying
  // accept POST is still auth-gated by withUserAuth, so non-members
  // still bounce to /login at the click.
  "/invite/",
  "/api/workspaces/invitations/",
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

  // Refresh the session — this is critical for keeping auth cookies alive
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

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
  if (user && (pathname === "/" || pathname === "/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/canvas";
    return NextResponse.redirect(url);
  }

  // Allow the landing page (exact match)
  if (pathname === "/") {
    return supabaseResponse;
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return supabaseResponse;
  }

  // Allow API routes with API key auth (external/MCP access)
  const authHeader = request.headers.get("authorization");
  if (pathname.startsWith("/api/") && authHeader?.includes("sk-dopl-")) {
    return supabaseResponse;
  }

  // Allow admin API routes (they have their own ADMIN_SECRET check)
  if (pathname.startsWith("/api/admin/")) {
    return supabaseResponse;
  }

  // Knowledge-pack sync webhooks are HMAC-authenticated, not session-
  // authenticated — bypass so the route's verifyHmac() check runs.
  if (
    pathname.startsWith("/api/knowledge/packs/") &&
    pathname.endsWith("/sync")
  ) {
    return supabaseResponse;
  }

  // If not authenticated, redirect to login (for pages) or return 401 (for API)
  if (!user) {
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
