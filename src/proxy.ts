import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { explicitPostAuthTarget, WEB_POST_AUTH_LANDING } from "@/shared/lib/url/post-auth-landing";
import { AUTH_ENTRY_ROUTES, isAuthEntryRoute, isLoopCountedAuthRoute } from "@/shared/auth/auth-routes";
import {
  LOGIN_BOUNCE_COOKIE,
  LOGIN_BOUNCE_LIMIT,
  applyTarget,
  clearLoginBounces,
  readLoginBounce,
  setLoginBounce,
} from "@/shared/auth/login-bounce";
import {
  RETIREMENT_LANDING,
  isWebsiteRetired,
  retirementRedirect,
} from "@/shared/lib/url/website-retirement";

const PUBLIC_ROUTES = [
  // `/login` + `/signup` — one screen, two routes; `shared/auth/auth-routes.ts`.
  ...AUTH_ENTRY_ROUTES,
  "/auth/callback",
  // Desktop app sign-in bridge: /auth/desktop-start (pre-auth, kicks off OAuth
  // in the system browser) and /auth/desktop-handoff (hands the session to the
  // dopl:// deep link). Both must bypass the session gate — the app window has
  // no session until the deep link is adopted.
  //
  // A THIRD ONE IS GONE (Stage D, 2026-08-06): /auth/desktop-complete was loaded
  // IN the app window so that page could plant the cookie jar for the retired
  // remote shell. The SPA adopts the captured tokens directly — the page stranded
  // the window on "Signing you in…" — so it was deleted with that shell. The
  // `/auth/desktop` prefix below still covers the two that remain.
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
  // The landing page's Download button: resolves the newest notarized mac build
  // and 307s to GitHub (src/app/download/route.ts). A visitor with no account is
  // the entire audience — a session gate would bounce the download to /login.
  "/download",
  "/playground", // public demo page — its whole audience has no account (same rationale as /download)
  "/receipt-test", // temporary receipt-print animation demo page
  // Canvas invite acceptance — invitee may not be signed in yet. The landing page
  // shows what they're being invited to; the accept POST itself is still auth-gated
  // by withUserAuth, so non-members still bounce to /login at the click.
  "/invite/",
  "/api/workspaces/invitations/",
  // Shareable join links, for the same reason as /invite/ and with a stronger
  // claim to it (retirement plan §1.1, GAP-6): the app copies
  // `${getAppOrigin()}/join/{token}` to a member's clipboard TODAY
  // (`invite-dialog.tsx`), so those URLs exist in the wild permanently and the
  // person opening one has, by definition, no account yet. The page is built
  // for exactly that — `JoinLinkCard`'s `needsAuth` branch names the workspace
  // and the inviter, then offers `/login?redirectTo=/join/{token}` — and the
  // session gate here made that branch DEAD IN PRODUCTION: every visitor was
  // bounced to a bare login screen that could not say what they were joining.
  // The join REQUEST itself is still auth-gated by its own route.
  "/join/",
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
  // The desktop minimum-version floor. It MUST answer a signed-out caller: a
  // build below the floor may be too old to complete a sign-in at all, and the
  // whole point is to tell it to upgrade before it tries. Left out of this list
  // it 401s here, the desktop reads the 401 as "no answer", fails open, and the
  // gate silently never blocks anybody — which is how it shipped, and how it was
  // caught (a live `version gate: floor fetch 401` in the field log).
  // See src/app/api/version/route.ts.
  "/api/version",
];

// The subset of PUBLIC_ROUTES that is MACHINE-authenticated: no human session is
// involved, so nothing below the auth call can change what these routes do. They
// short-circuit BEFORE `getClaims()`, because even local verification can go to
// the network once per process (the JWKS fetch) — and `/api/mcp` streams, with its
// whole correctness resting on response headers reaching the client inside the
// client's 60s time-to-headers budget. Spending any of that on authenticating a
// route that self-authenticates is pure risk.
//
// The rest stays BELOW the auth call on purpose: the auth entry routes and the
// marketing pages are session-AWARE, so they still need the claims read.
const SELF_AUTH_ROUTES = [
  "/api/mcp",
  // Playground machine surface: /session provisions anonymously (per-IP limited inside); /mcp/<token> self-authenticates by the guest bearer. The /playground PAGE is PUBLIC_ROUTES.
  "/api/playground",
  "/api/oauth",
  "/.well-known/oauth-",
  "/api/billing/webhook",
  "/api/cron/",
  // The one entry here that is not machine-AUTHENTICATED: /api/version has no
  // auth of its own because there is nothing to protect — every caller gets the
  // same public fact, and the release feed already carries it. It qualifies for
  // the short-circuit on the property that actually matters above: nothing
  // below the auth call can change its answer. Skipping the claims read also
  // keeps a boot-time liveness question off the JWKS path, and every desktop
  // asks it at launch.
  "/api/version",
];

// THE Q4 LOOP BREAKER for the `/login → app` bounce below lives in
// `shared/auth/login-bounce.ts` — cookie read/write/clear plus `applyTarget`,
// with the outage argument that explains every one of its choices. It was
// extracted there under F-134 when this file reached 486 of its 500-line cap.

/**
 * Where a signed-in visitor to `/login` goes when the URL asked for nothing.
 *
 * THIS IS THE FLAG-OFF BRANCH ONLY (see `:315`) — with the retirement on, which is the
 * default and the shipping state, the landing is `RETIREMENT_LANDING`. It used to be
 * `/canvas`, a page Stage D DELETED, which made the un-retire lever's own front door a
 * 404: flip `WEBSITE_RETIRED=0` to bring the website back and the first thing a signed-in
 * visitor hits is a route that no longer exists. Naming the landing costs nothing and
 * removes one 404 from a path somebody only ever walks during an incident.
 */
const DEFAULT_SIGNED_IN_DESTINATION = WEB_POST_AUTH_LANDING;

/**
 * Redirect while KEEPING whatever cookies `getClaims()` rotated onto
 * `supabaseResponse`. `getSession()` refreshes the session ~90s before expiry and
 * writes the new tokens through the storage adapter onto that response object —
 * returning a bare `NextResponse.redirect()` drops them, so the rotated refresh
 * token is never persisted and the NEXT request retries the refresh with a token
 * the server already consumed. That is a spurious sign-out, i.e. another way into
 * the login bounce this file is trying to make safe.
 */
function redirectPreservingSession(
  url: URL,
  supabaseResponse: NextResponse,
  status?: number
): NextResponse {
  const response =
    status === undefined
      ? NextResponse.redirect(url)
      : NextResponse.redirect(url, status);
  for (const cookie of supabaseResponse.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return response;
}

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
          cookiesToSet.forEach(({ name, value }) =>
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
  // / signatures); /_next; /invite/<token> (signed token); /auth/callback
  // (may carry case-sensitive code).
  //
  // TWO MORE SKIPS ARE GONE (P0-4, 2026-08-07): `/opengraph-image` and
  // `/twitter-image`, with the passthrough branch that sat directly below. They
  // served convention-based route FILES; none exist in `src/app/` any more —
  // `/community` went first, the `[workspaceSlug]` tree in Stage D. The card this
  // app really serves is the static file the root layout names, matcher-excluded
  // by extension, so it never reaches this function.
  if (
    /[A-Z]/.test(pathname) &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/_next/") &&
    !pathname.startsWith("/invite/") &&
    !pathname.startsWith("/auth/")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.toLowerCase();
    return redirectPreservingSession(url, supabaseResponse, 308);
  }

  // Read PER REQUEST, so the flip is an env change and never a deploy. Used
  // twice: the retirement map below, and the default signed-in landing here.
  const retired = isWebsiteRetired();

  // If authenticated, redirect the landing page and every auth entry route in.
  if (userId && (pathname === "/" || isAuthEntryRoute(pathname))) {
    // Q4: the cycle arrives at `/login` (sole server-component redirect
    // target), but `/login` 307s to `/authenticate`, so the two share the
    // counter — `shared/auth/auth-routes.ts › LOOP_COUNTED_AUTH_ROUTES`.
    // Nothing redirects to `/` or `/signup`; neither is counted.
    const bounces = isLoopCountedAuthRoute(pathname) ? readLoginBounce(request).count : 0;
    if (bounces >= LOGIN_BOUNCE_LIMIT) {
      // Break the cycle: serve the request (what it would get signed out)
      // rather than bouncing into a page that sends it straight back. Both
      // counted routes are PUBLIC_ROUTES; at `/login` "serve" means the 307 to
      // `/authenticate`, whose bounce this branch then stops via the same
      // cookie count. `?redirectTo=` stays honoured.
      clearLoginBounces(supabaseResponse);
      return supabaseResponse;
    }

    // HONOUR A VALID `?redirectTo=` FOR AN ALREADY-SIGNED-IN VISITOR.
    //
    // This used to hardcode `/canvas` and leave the param sitting on the
    // destination URL as decoration: a live session hitting
    // `/login?redirectTo=%2Finvite%2Ftok_x` was 307'd to
    // `/canvas?redirectTo=%2Finvite%2Ftok_x` and the invite was never reached.
    // Every producer of that URL — the middleware's own bounce below,
    // `/oauth/authorize`, `/invite`, `/join`, and now `/billing/{segment}` — is
    // stating a destination, and having a session already is not a reason to
    // discard it; it is the reason the sign-in step can be skipped.
    //
    // Same validation as everywhere else (`explicitPostAuthTarget` →
    // `safeRedirect`): a hostile value ("https://evil.example",
    // "//evil.example", "/\\evil.example", a bare word) is not a destination, it
    // is an attack, and it reads as null so this falls through to the default —
    // it can never make the middleware emit an off-origin `Location`.
    //
    // BOTH auth entry routes participate (the switch between them navigates,
    // carrying the query). The landing page does not: no producer, no meaning.
    const target = isAuthEntryRoute(pathname)
      ? explicitPostAuthTarget(request.nextUrl.searchParams.get("redirectTo"))
      : null;

    const url = request.nextUrl.clone();
    if (target) {
      applyTarget(url, target);
    } else {
      // THE DEFAULT LANDING FOLLOWS THE RETIREMENT, AND THIS IS NOT AN
      // OPTIMISATION — IT IS WHAT KEEPS THE Q4 BREAKER BOUNDED.
      //
      // Leaving it at `/canvas` would make every lap of the cycle three hops
      // instead of two: `/login → /canvas → (retired) /get-started`. The cookie
      // records the midpoint the bounce CHOSE — `/canvas` — so arriving at
      // `/get-started` reads as "a healthy authenticated page view somewhere
      // else" and DISARMS the counter, on every lap, forever. A page whose own
      // `getUser()` then fails sends the browser back to `/login` with the
      // counter at zero, which is the unbounded loop the breaker exists to
      // stop, re-created by the redirect that was supposed to be harmless.
      // Naming the real destination puts the midpoint back under the cookie.
      url.pathname = retired ? RETIREMENT_LANDING : DEFAULT_SIGNED_IN_DESTINATION;
      // A `redirectTo` that reached here was either consumed above or rejected
      // as hostile; either way it has no business riding to the destination,
      // where it used to sit as decoration. The landing page's query (utm and
      // friends) is left alone.
      if (isAuthEntryRoute(pathname)) url.search = "";
    }
    const response = redirectPreservingSession(url, supabaseResponse);
    if (isLoopCountedAuthRoute(pathname)) {
      setLoginBounce(request, response, bounces + 1, url.pathname);
    }
    return response;
  }

  // Q4: a healthy authenticated page view means the browser is NOT in the
  // bounce cycle, so retire the counter — otherwise a single legitimate
  // `/login` visit would leave it armed for the rest of the TTL and a later
  // visit could land on the login screen for no reason. Written only when the
  // cookie actually exists (no `Set-Cookie` on the hot path), and NEVER for the
  // page the bounce just sent this browser to, which is the cycle's own
  // midpoint — clearing there would reset the counter on every lap and the loop
  // would never terminate. That midpoint used to be `/canvas` by definition;
  // now the bounce records it (see LOGIN_BOUNCE_COOKIE), because an honoured
  // `?redirectTo=` makes it any page — and a page whose own `getUser()` fails
  // sends the browser straight back to `/login`, which is the loop verbatim.
  // `/api/*` is excluded for a related reason: a background poll in another tab
  // must not disarm the breaker for the tab that is looping.
  if (
    userId &&
    !pathname.startsWith("/api/") &&
    request.cookies.has(LOGIN_BOUNCE_COOKIE) &&
    pathname !== readLoginBounce(request).destination
  ) {
    clearLoginBounces(supabaseResponse);
  }

  // Allow the landing page (exact match)
  if (pathname === "/") {
    return supabaseResponse;
  }

  // Allow public routes (session-aware: /login bounces a signed-in visitor).
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return supabaseResponse;
  }

  // Allow API routes carrying ANY Authorization header through to the
  // route's own auth wrapper (`withUserAuth`), which is the single
  // authority on bearer credentials and fails closed: `dopl_at_*` tokens
  // are validated as remote-MCP OAuth tokens; anything else must verify
  // locally as a Supabase access JWT (ES256 + kid pre-checked, so a junk
  // bearer costs no GoTrue round-trip) or it 401s with no cookie
  // fallthrough. The middleware deliberately does NOT try to pre-judge
  // bearer kinds — the previous `includes("dopl_at_")` check silently
  // 401'd the desktop SPA's Supabase-JWT bearers before the wrapper ever
  // ran (see docs/migration-research/auth-flows.md §3.2).
  const authHeader = request.headers.get("authorization");
  if (pathname.startsWith("/api/") && authHeader) {
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
    // THE BOUNCE CARRIES THE QUERY, NOT JUST THE PATH.
    //
    // This used to set `redirectTo` to `pathname` alone, so a signed-out visit
    // to `/billing/{segment}?billing=upgrade` came back from `/login` as a bare
    // `/billing/{segment}` and the checkout the URL asked for never opened —
    // hitting, by definition, FIRST-TIME PAYERS, whose browser has never signed
    // in. The same silent truncation applied to every query-bearing deep link.
    //
    // Still safe: the value is validated on the way out (`safeRedirect` /
    // `explicitPostAuthTarget`, in the login form, `/auth/callback` and the
    // signed-in branch above), and a query cannot make a same-origin path
    // off-origin — `safeRedirect` reassembles `pathname + search + hash` from a
    // parsed URL and rejects anything whose origin moved.
    const target = `${pathname}${request.nextUrl.search}`;
    // The default landings name themselves; `redirectTo=/canvas` would just be
    // noise. A QUERY makes even those a real destination, though — a Stripe
    // return to `/canvas?billing=success` in a signed-out tab must survive the
    // sign-in, or the payer lands on the download page with no plan in sight.
    const isDefaultLanding =
      (pathname === "/" || pathname === "/canvas") &&
      request.nextUrl.search === "";
    if (!isDefaultLanding) {
      // Exactly one thing rides to `/login`: where to come back to. The
      // requested page's own query is inside `redirectTo`, so leaving a second
      // copy of it here would be a second, ignored source of truth.
      url.search = "";
      url.searchParams.set("redirectTo", target);
    }
    // Preserve the cookie writes: a REFUSED refresh clears the session through
    // the storage adapter, and that clearing must reach the browser or the dead
    // cookie survives and every later request retries the same doomed refresh.
    // Server components cannot do this (their cookie writes are swallowed), so
    // the middleware is the only layer that can make the state self-heal.
    return redirectPreservingSession(url, supabaseResponse);
  }

  // ── WEBSITE RETIREMENT, STAGE B (docs/migration-research/website-retirement-plan.md)
  //
  // LAST, AND SIGNED-IN ONLY, BOTH DELIBERATELY. Everything that could still
  // answer this request has already returned: the landing page, PUBLIC_ROUTES,
  // the OG crawlers, `/api/**` under a bearer, and — immediately above — the
  // signed-out login bounce. So the flag cannot reach a KEEP route even if the
  // map below were wrong about one, and a signed-out visitor to a retired page
  // bounces to `/login?redirectTo=<the page they asked for>` EXACTLY as today.
  //
  // That last part is the whole redirectTo interaction, and it composes rather
  // than needing a second rule: the bounce carries the original URL, the login
  // form returns the browser to it with a session, and THAT request is the one
  // this branch retires — `/{seg}/canvas` → `/get-started`,
  // `/{seg}/canvas?billing=upgrade` → `/billing/{seg}?billing=upgrade`. A payer
  // signing in for the first time still lands on the checkout they asked for.
  //
  // 302, not 308 and not 410: these URLs are coming back the day the flag flips
  // off, so nothing about this may be cached as permanent.
  if (retired) {
    const destination = retirementRedirect(pathname, request.nextUrl.search);
    if (destination) {
      const url = request.nextUrl.clone();
      // Same helper the honoured `?redirectTo=` uses: it REPLACES the query
      // rather than merging, so the generic redirects shed the retired page's
      // params and the billing rewrites carry exactly the ones they were built
      // with. The target is assembled from a literal root and a charset-checked
      // segment, so it cannot leave the origin.
      applyTarget(url, destination);
      return redirectPreservingSession(url, supabaseResponse, 302);
    }
  }

  return supabaseResponse;
}

/**
 * STAGE E (2026-08-06) — THE SELF-AUTHENTICATING ROUTES LEAVE THE MATCHER.
 *
 * These are exactly {@link SELF_AUTH_ROUTES}: no human session is involved, nothing below
 * the auth call can change what they do, and they already short-circuit at the top of the
 * proxy. Excluding them here means the middleware never *runs* for them rather than running
 * and immediately returning — which is the point for `/api/mcp`, whose whole correctness
 * rests on response headers reaching the client inside its 60s time-to-headers budget.
 *
 * WHY NOT ALL OF `/api/**`, WHICH IS WHAT THE PLAN SAYS. `docs/migration-research/auth-flows.md`
 * calls dropping the lot the "Phase-4 end state" and then flags the reason to sequence it:
 * the middleware is currently the only thing 401-ing an unauthenticated `/api` call before
 * the route wrapper runs. That half is now safe — `withUserAuth`/`withWorkspaceAuth` 401 on
 * their own (`with-auth.ts:243`) — but it is NOT the whole story. The middleware also
 * REFRESHES the Supabase session cookie on every request it sees, and cookie-authed API
 * calls (the desktop's main process sends a `Cookie` header via `getSessionCookieHeader`)
 * would silently lose that refresh. The failure mode is a session that expires earlier than
 * it used to, recovered only by `api-repair`'s 401 retry — a real behaviour change traded
 * for latency on routes that are not the hot path. Left for its own change, with the live
 * harness's auth-boundary check run either side of it.
 *
 * SELF_AUTH_ROUTES STAYS in the proxy body as defence in depth: if this matcher is ever
 * widened again, those routes must still short-circuit rather than pay for the claims read.
 *
 * ── P0-4 (2026-08-07): FOUR ALTERNATIVES ADDED. FULL ARGUMENT IN ENGINEERING.md §9.4 ──
 * `pricing|privacy|terms` were pure waste — already `PUBLIC_ROUTES`, so the claims read
 * changed nothing — and the `Set-Cookie` they might carry is what made any shared-cache
 * directive inert, so this landed BEFORE `next.config.ts`'s `Cache-Control` rules;
 * unanchored is safe because `PUBLIC_ROUTES` matches with `startsWith`, so no gated route's
 * pathname begins with those bytes. `favicons/` + `ico|webmanifest|txt|xml|woff2?` closed a
 * BUG: the old list named `favicon.ico` at the path ROOT and carried no `.ico`, so the
 * `/favicons/favicon.ico` `layout.tsx` emits was 307'd to `/login` on every signed-out
 * landing visit (`robots.txt`/`sitemap.xml` unserveable too) — `.*\.ico$` now subsumes that
 * root-only alternative. `/` STAYS MATCHED: its only work here is the signed-in bounce at
 * `:268`, which cannot move client-side without baking `isWebsiteRetired()` into HTML.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicons/|pricing|privacy|terms|api/mcp|api/oauth|api/version|api/cron/|api/billing/webhook|\\.well-known/oauth-|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml|woff2?|mp3)$).*)",
  ],
};
