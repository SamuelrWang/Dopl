/**
 * Validate a `redirectTo` query-string value before bouncing the user
 * to it.
 *
 * The auth callback and the email/password login both honor a
 * `?redirectTo=` param so deep links survive the round-trip. Without a
 * guard, an attacker can craft `?redirectTo=https://evil.com` — the
 * `URL` constructor honors absolute URLs and ignores its base, and
 * `router.push()` will obey, sending the user off-domain after a
 * legitimate sign-in. Even though Supabase only completes the callback
 * for OAuth flows it issued (limiting drive-by phishing), this is
 * still a real open-redirect vector.
 *
 * Rule: only same-origin **path-relative** redirects are allowed.
 *
 *   "/canvas"            → "/canvas"          (relative, OK)
 *   "/foo/bar"           → "/foo/bar"         (relative, OK)
 *   "https://evil.com"   → fallback           (absolute scheme)
 *   "//evil.com/x"       → fallback           (protocol-relative)
 *   "/\\evil.com"        → fallback           (URL-parsing weirdness)
 *   ""                   → fallback           (empty)
 *   undefined / null     → fallback           (missing)
 *
 * The fallback defaults to the post-auth landing but callers can pass a
 * different default — e.g. an OAuth callback might want to fall back to
 * `/login` on a sketchy value. It used to default to `/canvas`, which Stage D
 * deleted; every current caller passes its own fallback, so that default was
 * unreachable — but a NEW caller would have silently inherited a dead route.
 *
 * WHY THE LITERAL RATHER THAN IMPORTING `WEB_POST_AUTH_LANDING`: this module is the LEAF —
 * `post-auth-landing.ts` imports `safeRedirect` from here, so importing its constant back
 * would close a cycle. The two are pinned equal by a test instead, which is the honest
 * trade: one duplicated string, guarded, versus an import cycle in the redirect path.
 */
/** Must equal `WEB_POST_AUTH_LANDING`. Pinned by safe-redirect.test.ts — see the note above. */
const POST_AUTH_LANDING_FALLBACK = "/get-started";

export function safeRedirect(
  redirectTo: string | null | undefined,
  fallback: string = POST_AUTH_LANDING_FALLBACK,
): string {
  if (!redirectTo || typeof redirectTo !== "string") return fallback;
  // Must start with a single forward slash.
  if (!redirectTo.startsWith("/")) return fallback;
  // Reject protocol-relative ("//evil.com") and the backslash variant
  // some browsers mis-parse as protocol-relative.
  if (redirectTo.startsWith("//") || redirectTo.startsWith("/\\")) {
    return fallback;
  }
  // Reject anything that, when run through URL parsing, would resolve
  // to a different origin (e.g. tab + scheme injection). Use a known
  // base; if the result's origin doesn't match, reject. Empty origin
  // means it's a same-origin path. We don't have access to the request
  // origin here so we use a sentinel and check the parsed origin
  // matches it.
  const sentinelOrigin = "https://safe-redirect.invalid";
  let parsed: URL;
  try {
    parsed = new URL(redirectTo, sentinelOrigin);
  } catch {
    return fallback;
  }
  if (parsed.origin !== sentinelOrigin) return fallback;
  // Reassemble path + search + hash so the result is normalized and
  // can't carry encoded credentials etc.
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
