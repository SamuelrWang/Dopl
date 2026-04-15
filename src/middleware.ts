import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = ["/login", "/auth/callback", "/api/og/tweet", "/api/billing/webhook", "/terms", "/privacy", "/pricing"];

export async function middleware(request: NextRequest) {
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
