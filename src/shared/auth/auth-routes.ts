/**
 * THE AUTH ENTRY SCREENS — the two paths that render the sign-in form, named
 * once so the middleware and anything else that must treat them alike cannot
 * drift apart. Extracted here rather than inlined in `src/proxy.ts` for the
 * reason F-134 extracted `login-bounce.ts`: that file sits AT its 500-line cap
 * (`eslint.config.mjs › max-lines`, enforced at error over `src/**`), so a new
 * rule in it has to arrive as a seam.
 *
 * `/login` and `/signup` are ONE screen over two routes
 * (`src/app/login/page.tsx`, `src/app/signup/page.tsx`, both rendering
 * `LoginScreen` with the mode the route names). The split exists so the URL
 * always says which flow is on screen, so the landing page's "Get Started" can
 * point at account CREATION (`features/marketing/constants.ts` ›
 * GET_STARTED_URL), and so the switch under the submit button is a navigation
 * rather than a state toggle.
 *
 * BOTH ARE PUBLIC AND BOTH ARE SESSION-AWARE. Public because their entire
 * audience is signed out by definition; session-aware because a visitor who
 * already has a session has no business on either, and is bounced into the app.
 *
 * WHAT IS **NOT** SYMMETRIC, AND MUST NOT BE MADE SO: `/login` is the only
 * REDIRECT DESTINATION of the two. Every bounce in the app names it — the
 * middleware's own signed-out redirect, `/auth/callback`, the reset-password
 * page, the OAuth consent screen — because all of them carry someone who
 * already has an account. Nothing redirects to `/signup`, which is why the Q4
 * loop breaker (`./login-bounce.ts`) stays `/login`-only: a path nothing
 * redirects to cannot be one end of a redirect cycle, and arming a counter for
 * it would only add a way to serve the wrong screen.
 */
export const AUTH_ENTRY_ROUTES = ["/login", "/signup"] as const;

/** Exact match, not `startsWith`: neither route has children, and a prefix test
 *  would quietly claim any `/login*` route someone adds later. */
export function isAuthEntryRoute(pathname: string): boolean {
  return (AUTH_ENTRY_ROUTES as readonly string[]).includes(pathname);
}
