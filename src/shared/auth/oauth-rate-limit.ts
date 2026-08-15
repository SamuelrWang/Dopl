import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { checkAndRecordRateLimitSubject } from "./mcp-session";

/**
 * Per-IP rate limiting for the UNAUTHENTICATED OAuth endpoints (`/api/oauth/*`),
 * which have no bearer to key on. ⚠ `/register` INSERTs an `oauth_clients` row
 * per call, so uncapped it is an unauthenticated unbounded table-growth
 * primitive.
 *
 * ⚠ Reuses the SAME store + RPC as the OAuth bearer limiter
 * (`rate_limit_events` via `checkAndRecordRateLimitSubject`) — one mechanism,
 * many subjects.
 */

/**
 * Best-effort client IP from proxy headers. ⚠ Falls back to `"unknown"`, which
 * fails TOWARD limiting — header-less callers share one bucket rather than
 * escaping. IP is a rate-limit key only, never persisted or trusted for authz,
 * so a spoofed `X-Forwarded-For` can at most starve its own bucket.
 */
export function clientIpFromRequest(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Per-IP ceiling for an OAuth endpoint. Returns a ready 429 `NextResponse`
 * (RFC 6749 `{ error, error_description }` + `Retry-After`) when over the limit,
 * else `null`. ⚠ Fail-closed: `checkAndRecordRateLimitSubject` returns false on
 * any DB error, so a limiter outage rejects rather than admits.
 */
export async function enforceOAuthIpRateLimit(
  request: NextRequest,
  opts: { bucket: string; rpm: number; endpoint: string }
): Promise<NextResponse | null> {
  const ip = clientIpFromRequest(request);
  const within = await checkAndRecordRateLimitSubject(
    `${opts.bucket}:${ip}`,
    opts.rpm,
    opts.endpoint
  );
  if (within) return null;
  return NextResponse.json(
    {
      error: "rate_limited",
      error_description: "Too many requests from this client. Try again shortly.",
    },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
  );
}
