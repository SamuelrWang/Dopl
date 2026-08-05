import type { NextRequest, NextResponse } from "next/server";

/**
 * Q4 (2026-07-31) — THE LOOP BREAKER for the `/login → app` bounce in
 * `src/proxy.ts`, extracted here as F-134's named seam (the middleware was at
 * 486 of its 500-line cap). The reasoning travels WITH the helpers, because the
 * helpers are unreadable without it: they are a deliberately dumb counter whose
 * every design choice is an argument about an outage.
 *
 * The middleware decides "who is signed in" from LOCALLY verified claims
 * (`getClaims()`), but every server component still asks GoTrue over the network
 * (`shared/supabase/server.ts` → `getUser()`). Those two can DISAGREE, and
 * supabase-js does not throw when they do: a GoTrue outage, a 503, or an account
 * disabled server-side all come back as `{ data: { user: null }, error }`, so the
 * page's `if (!user) redirect("/login")` fires while the middleware still reads
 * the request as authenticated. The result was a hard cycle —
 *   /login → 307 /canvas → page redirects → /login → 307 /canvas → …
 * → ERR_TOO_MANY_REDIRECTS, no error page, during EXACTLY the GoTrue degradation
 * the local-claims swap exists to survive. Before that swap the operator simply
 * landed on the login screen.
 *
 * The breaker restores that outcome without needing the two layers to agree:
 * count the bounces we hand out per browser, and once a browser has been bounced
 * off `/login` LIMIT times inside the TTL, SERVE `/login` instead of bouncing
 * again. Worst case is 2 extra hops; the cycle cannot be unbounded. It is
 * deliberately a dumb counter — no shared state, no network, nothing that can
 * itself fail during an auth incident.
 *
 * A claims fallback inside the server-side `getUser()` helper would be a
 * complement, not a substitute: it can only cover the RETRYABLE network shape.
 * A disabled or deleted account returns an authoritative 403 with a still-valid
 * unexpired token (up to ~1h), and that must keep reading as "signed out" — so
 * the disagreement, and therefore the loop, survives any such fallback. The
 * breaker is the only stop that covers both.
 *
 * THE COOKIE ALSO REMEMBERS WHERE IT BOUNCED TO, and that half is load-bearing.
 * The counter is disarmed by the first healthy authenticated page view, and the
 * one page that must NOT disarm it is the cycle's own midpoint — otherwise the
 * counter resets on every lap and the loop never terminates. That used to be a
 * hardcoded `/canvas`, which was true while `/canvas` was the only place a
 * signed-in visitor to `/login` could land. It no longer is: `/login?redirectTo=…`
 * is now honoured (an invite, a join link, the billing page), so the midpoint is
 * whatever that bounce chose, and the cookie carries it: `"<count>|<pathname>"`.
 * A legacy bare `"<count>"` still reads as `/canvas`, so cookies in flight
 * across the deploy keep the old — correct — meaning.
 */
export const LOGIN_BOUNCE_COOKIE = "dopl-login-bounce";
export const LOGIN_BOUNCE_LIMIT = 2;

/**
 * What a legacy bare `"<count>"` cookie meant, and the only thing it can still
 * mean. Cookies written before the destination half shipped carry no path, and
 * `/canvas` was the sole destination a bounce could choose at the time — so a
 * browser mid-loop across that deploy keeps its breaker. This is a fact about
 * OLD COOKIES, not a routing decision: where a bounce sends someone TODAY is the
 * middleware's business (and `/canvas` is on the website-retirement RETIRE list,
 * so the two values have already diverged).
 */
export const LEGACY_BOUNCE_DESTINATION = "/canvas";

/**
 * Long enough that a loop whose hops are SLOW (a degraded GoTrue makes every
 * page render wait on a doomed `/auth/v1/user` call) still reaches the limit
 * before the counter expires; short enough that it is gone by the next visit.
 * It is also cleared eagerly on the first healthy authenticated page view.
 */
const LOGIN_BOUNCE_TTL_SECONDS = 30;

/** `{ count, destination }` from `"<count>|<encoded pathname>"`, or from the
 *  legacy bare `"<count>"` (destination `/canvas`). */
export function readLoginBounce(request: NextRequest): {
  count: number;
  destination: string;
} {
  const raw = request.cookies.get(LOGIN_BOUNCE_COOKIE)?.value ?? "";
  const separator = raw.indexOf("|");
  const countPart = separator === -1 ? raw : raw.slice(0, separator);
  const count = Number(countPart);
  let destination = LEGACY_BOUNCE_DESTINATION;
  if (separator !== -1) {
    try {
      destination = decodeURIComponent(raw.slice(separator + 1)) || destination;
    } catch {
      // A mangled cookie must not be able to throw the middleware; falling back
      // to `/canvas` only means the breaker disarms one hop early.
    }
  }
  return {
    count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
    destination,
  };
}

export function setLoginBounce(
  request: NextRequest,
  response: NextResponse,
  count: number,
  destination: string
): void {
  response.cookies.set(
    LOGIN_BOUNCE_COOKIE,
    `${count}|${encodeURIComponent(destination)}`,
    {
      path: "/",
      maxAge: LOGIN_BOUNCE_TTL_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    }
  );
}

export function clearLoginBounces(response: NextResponse): void {
  response.cookies.set(LOGIN_BOUNCE_COOKIE, "", { path: "/", maxAge: 0 });
}

/**
 * Point `url` at a `safeRedirect`-validated same-origin target, replacing the
 * query rather than merging into it — the incoming `?redirectTo=` has been
 * consumed by getting here and must not ride along to the destination.
 */
export function applyTarget(url: URL, target: string): void {
  const parsed = new URL(target, url.origin);
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  url.hash = parsed.hash;
}
