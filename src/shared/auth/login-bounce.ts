import type { NextRequest, NextResponse } from "next/server";

/**
 * LOOP BREAKER for the `/login → app` bounce in `src/proxy.ts`.
 *
 * ⚠ The middleware decides "who is signed in" from LOCALLY verified claims
 * (`getClaims()`); server components still ask GoTrue over the network
 * (`shared/supabase/server.ts` → `getUser()`). Those two DISAGREE during a GoTrue
 * outage / 503 / server-disabled account (all return `{ user: null, error }`
 * without throwing), producing an unbounded redirect cycle —
 * ERR_TOO_MANY_REDIRECTS during exactly the degradation local claims exist to
 * survive.
 *
 * Fix: count bounces per browser; once a browser has been bounced off `/login`
 * LIMIT times inside the TTL, SERVE `/login` instead. Deliberately a dumb counter
 * — no shared state, no network, nothing that can fail during an auth incident.
 * ⚠ A claims fallback in `getUser()` is a complement, not a substitute: it covers
 * only the retryable network shape, while a disabled account returns an
 * authoritative 403 on a still-valid token.
 *
 * ⚠ The cookie also remembers WHERE it bounced to (`"<count>|<pathname>"`) and
 * that half is load-bearing: the counter is disarmed by the first healthy
 * authenticated page view, and the cycle's own midpoint must NOT disarm it or
 * the counter resets every lap. Midpoint varies now that `/login?redirectTo=…`
 * is honoured. A legacy bare `"<count>"` reads as `/canvas`.
 */
export const LOGIN_BOUNCE_COOKIE = "dopl-login-bounce";
export const LOGIN_BOUNCE_LIMIT = 2;

/**
 * ⚠ A fact about OLD COOKIES, not a routing decision: cookies written before the
 * destination half shipped carry no path, and `/canvas` was the sole destination
 * a bounce could pick then. Where a bounce sends someone TODAY is the
 * middleware's business — `/canvas` is on the retirement RETIRE list, so the two
 * values have already diverged.
 */
export const LEGACY_BOUNCE_DESTINATION = "/canvas";

/** Long enough that a loop with SLOW hops (degraded GoTrue) still reaches the
 *  limit before expiry; short enough to be gone by the next visit. Also cleared
 *  eagerly on the first healthy authenticated page view. */
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
      // ⚠ A mangled cookie must not throw the middleware; the fallback only
      // means the breaker disarms one hop early.
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

/** Point `url` at a `safeRedirect`-validated same-origin target. ⚠ REPLACES the
 *  query rather than merging — the incoming `?redirectTo=` was consumed getting
 *  here and must not ride along. */
export function applyTarget(url: URL, target: string): void {
  const parsed = new URL(target, url.origin);
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  url.hash = parsed.hash;
}
