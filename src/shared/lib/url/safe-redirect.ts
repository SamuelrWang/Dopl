/**
 * Validate a `redirectTo` query-string value before bouncing the user to it.
 *
 * ⚠ OPEN-REDIRECT GUARD: the `URL` constructor honors absolute URLs and ignores
 * its base, and `router.push()` obeys — so `?redirectTo=https://evil.com` sends
 * the user off-domain after a legitimate sign-in.
 *
 * Rule: only same-origin **path-relative** redirects.
 *
 *   "/canvas"            → "/canvas"          (relative, OK)
 *   "https://evil.com"   → fallback           (absolute scheme)
 *   "//evil.com/x"       → fallback           (protocol-relative)
 *   "/\\evil.com"        → fallback           (URL-parsing weirdness)
 *   "" / undefined / null → fallback
 *
 * Callers may pass their own fallback (an OAuth callback prefers `/login`).
 */
/** ⚠ Must equal `WEB_POST_AUTH_LANDING`; duplicated rather than imported because
 *  `post-auth-landing.ts` imports `safeRedirect` from here and the import would
 *  close a cycle. Pinned equal by safe-redirect.test.ts. */
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
  // Reject anything URL parsing resolves to a different origin (tab + scheme
  // injection). No request origin available here, so parse against a sentinel
  // base and require the parsed origin to match it.
  const sentinelOrigin = "https://safe-redirect.invalid";
  let parsed: URL;
  try {
    parsed = new URL(redirectTo, sentinelOrigin);
  } catch {
    return fallback;
  }
  if (parsed.origin !== sentinelOrigin) return fallback;
  // Reassemble path + search + hash so the result is normalized and cannot
  // carry encoded credentials.
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
