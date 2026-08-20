/**
 * THE AUTH ENTRY SCREENS — every path that answers with the sign-in form, named
 * once so the middleware and everything else that treats them alike cannot
 * drift.
 *
 * `/authenticate` is THE page (2026-08-16): one route, both flows, the form's
 * own switch swaps between them in place, `?mode=signup` opens it in sign-up.
 * `/login` and `/signup` remain as REDIRECTORS — each 307s to `/authenticate`
 * (signup carrying `mode=signup`), preserving its query — because the world
 * links to them: every bounce destination in this codebase names `/login`, and
 * the landing page shipped `/signup` CTAs for months.
 *
 * All three are PUBLIC (their audience is signed out by definition) and all
 * three are SESSION-AWARE (a visitor with a session is bounced into the app
 * BEFORE the redirector can hop — the middleware runs first).
 *
 * ⚠ THE LOOP BREAKER MUST COUNT `/login` AND `/authenticate` TOGETHER
 * (`src/proxy.ts` › the Q4 branch). `/login` is the only path server components
 * redirect to, so it is where the outage cycle arrives — but when the breaker
 * trips and SERVES `/login`, that page now 307s to `/authenticate`, and if the
 * counter did not follow, the signed-in bounce there would restart the cycle
 * with the breaker blind to it. `/signup` stays uncounted: nothing redirects to
 * it, so it cannot be one end of a cycle.
 */
export const AUTH_ENTRY_ROUTES = ["/login", "/signup", "/authenticate"] as const;

/** The two paths whose signed-in bounces share the Q4 loop-breaker counter —
 *  see the header for why `/signup` is not here. Consumed only through
 *  `isLoopCountedAuthRoute`. */
const LOOP_COUNTED_AUTH_ROUTES = ["/login", "/authenticate"] as const;

/** Exact match, not `startsWith`: none of these routes has children, and a
 *  prefix test would quietly claim any `/login*` route someone adds later. */
export function isAuthEntryRoute(pathname: string): boolean {
  return (AUTH_ENTRY_ROUTES as readonly string[]).includes(pathname);
}

export function isLoopCountedAuthRoute(pathname: string): boolean {
  return (LOOP_COUNTED_AUTH_ROUTES as readonly string[]).includes(pathname);
}
