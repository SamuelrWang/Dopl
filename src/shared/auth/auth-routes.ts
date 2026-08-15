/**
 * THE AUTH ENTRY SCREENS — the two paths rendering the sign-in form, named once
 * so the middleware and everything else that treats them alike cannot drift.
 *
 * `/login` and `/signup` are ONE screen over two routes (both render
 * `LoginScreen` with the mode the route names), so the URL always says which
 * flow is on screen.
 *
 * Both PUBLIC (their audience is signed out by definition) and both
 * SESSION-AWARE (a visitor with a session is bounced into the app).
 *
 * ⚠ NOT SYMMETRIC, AND MUST NOT BE MADE SO: `/login` is the only REDIRECT
 * DESTINATION of the two — every bounce names it. Nothing redirects to
 * `/signup`, which is why the loop breaker (`./login-bounce.ts`) stays
 * `/login`-only: a path nothing redirects to cannot be one end of a cycle.
 */
export const AUTH_ENTRY_ROUTES = ["/login", "/signup"] as const;

/** Exact match, not `startsWith`: neither route has children, and a prefix test
 *  would quietly claim any `/login*` route someone adds later. */
export function isAuthEntryRoute(pathname: string): boolean {
  return (AUTH_ENTRY_ROUTES as readonly string[]).includes(pathname);
}
