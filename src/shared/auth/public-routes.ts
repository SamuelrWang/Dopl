/**
 * THE ROUTE CLASSIFICATION THE MIDDLEWARE READS — extracted from `src/proxy.ts`
 * (2026-08-23) for the same reason `login-bounce.ts` was under F-134: the proxy
 * was AT its 500-line cap, and a file at the cap cannot absorb a new entry, let
 * alone the paragraph explaining one (INVARIANTS §1).
 *
 * ⚠ These are DATA, not behaviour. `proxy.ts` still owns every decision made
 * with them; this module owns only which paths are in which class and why. Both
 * lists match with `pathname.startsWith`, so an entry is a PREFIX — check that
 * no gated route's pathname begins with the bytes you add.
 */
import { AUTH_ENTRY_ROUTES } from "./auth-routes";

export const PUBLIC_ROUTES = [
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
  // HOME-CHANNEL claim links, for exactly the reason /join/ and /invite/ are
  // here: the person opening `/link/{token}` has, by definition, no account —
  // that is what the link is for. `/api/home/link/` (SINGULAR) covers the
  // pre-auth `…/info` lookup, which is narrowed server-side to a display name
  // and three booleans; the CLAIM under the same prefix is still auth-gated by
  // its own `withUserAuth`. ⚠ `/api/home/links/` (plural — mint, list, revoke)
  // is deliberately NOT here: those are the creator's own surface and stay
  // behind the session gate.
  "/link/",
  "/api/home/link/",
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
export const SELF_AUTH_ROUTES = [
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
