import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, checkRateLimit, recordUsage } from "./api-keys";

/**
 * Wraps an API route handler with external authentication.
 *
 * - If Authorization header with `sk-sie-` key is present → validate, rate limit, proceed
 * - If no header but request is same-origin (from our own frontend) → allow through
 * - If no header and not same-origin → 401
 */
export function withExternalAuth(
  handler: (request: NextRequest, context?: unknown) => Promise<Response | NextResponse>
) {
  return async (
    request: NextRequest,
    context?: unknown
  ): Promise<Response | NextResponse> => {
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      // External API call with key
      const key = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!key.startsWith("sk-sie-")) {
        return NextResponse.json(
          { error: "Invalid API key format" },
          { status: 401 }
        );
      }

      const keyRecord = await validateApiKey(key);
      if (!keyRecord) {
        return NextResponse.json(
          { error: "Invalid or revoked API key" },
          { status: 401 }
        );
      }

      // Rate limit check
      const withinLimit = await checkRateLimit(
        keyRecord.id,
        keyRecord.rate_limit_rpm
      );
      if (!withinLimit) {
        return NextResponse.json(
          {
            error: "Rate limit exceeded",
            limit: keyRecord.rate_limit_rpm,
            window: "60 seconds",
          },
          { status: 429 }
        );
      }

      // Record usage (fire-and-forget, don't block the response)
      const endpoint = `${request.method} ${request.nextUrl.pathname}`;
      recordUsage(keyRecord.id, endpoint).catch(console.error);

      return handler(request, context);
    }

    // No auth header — check if same-origin (our own frontend)
    if (isSameOrigin(request)) {
      return handler(request, context);
    }

    // External request without API key
    return NextResponse.json(
      {
        error: "Authentication required",
        message:
          "Provide an API key via Authorization: Bearer sk-sie-... header",
      },
      { status: 401 }
    );
  };
}

/**
 * Check if a request originates from our own frontend.
 * This is a convenience check, not a security boundary.
 */
function isSameOrigin(request: NextRequest): boolean {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return true; // If not configured, assume same-origin (dev mode)

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin && origin.startsWith(appUrl)) return true;
  if (referer && referer.startsWith(appUrl)) return true;

  // In development, also allow localhost
  if (origin?.includes("localhost") || referer?.includes("localhost")) {
    return true;
  }

  return false;
}
