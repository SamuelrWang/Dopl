import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { checkAndRecordRateLimitSubject } from "./mcp-session";

/**
 * Per-IP rate limiting for the UNAUTHENTICATED OAuth endpoints (`/api/oauth/*`).
 *
 * These endpoints have no bearer to key on — `/register` (RFC 7591 dynamic
 * client registration) and `/token` are reachable before any credential
 * exists. `/register` in particular INSERTs an `oauth_clients` row per call, so
 * without a cap it is an unauthenticated unbounded table-growth primitive. We
 * bound abuse per source IP while leaving the legitimate MCP-client onboarding
 * path (register → authorize → token, all within minutes) comfortably open.
 *
 * Reuses the exact same store + RPC the OAuth bearer limiter uses
 * (`rate_limit_events` via `checkAndRecordRateLimitSubject`) — one mechanism,
 * many subjects — rather than inventing a second one.
 */

/**
 * Best-effort client IP from the proxy headers Vercel/most CDNs set. Falls back
 * to `"unknown"`, which fails TOWARD limiting: every header-less caller shares
 * one bucket rather than escaping the limit. IP is only a rate-limit key here,
 * never persisted or trusted for authz, so a spoofed `X-Forwarded-For` can at
 * most starve its own bucket.
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
 * Enforce a per-IP ceiling for an OAuth endpoint. Returns a ready-to-return 429
 * `NextResponse` (RFC 6749 `{ error, error_description }` shape, with
 * `Retry-After`) when the caller is over the limit, else `null`. Fail-closed:
 * `checkAndRecordRateLimitSubject` returns false on any DB error, so a limiter
 * outage rejects rather than admits.
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
