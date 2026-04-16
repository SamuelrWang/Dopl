import { NextRequest, NextResponse } from "next/server";
import { API_KEY_PREFIX } from "@/lib/config";
import { createServerClient } from "@supabase/ssr";
import { validateApiKey, checkRateLimit, recordUsage } from "./api-keys";
import { getUserSubscription, type SubscriptionTier } from "@/lib/billing/subscriptions";

/**
 * Wraps an API route handler with authentication.
 *
 * - If Authorization header with `sk-dopl-` key is present → validate, rate limit, proceed
 * - If no header → check Supabase session cookies → allow if authenticated
 * - Otherwise → 401
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withExternalAuth(
  handler: (request: NextRequest, context?: any) => Promise<Response | NextResponse>
) {
  return async (
    request: NextRequest,
    context?: any // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<Response | NextResponse> => {
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      // External API call with key
      const key = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!key.startsWith(API_KEY_PREFIX)) {
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

    // No auth header — check Supabase session
    const user = await getSessionUser(request);
    if (user) {
      return handler(request, context);
    }

    // No valid auth
    return NextResponse.json(
      {
        error: "Authentication required",
        message:
          "Sign in or provide an API key via Authorization: Bearer sk-dopl-... header",
      },
      { status: 401 }
    );
  };
}

/**
 * Like withExternalAuth, but injects the authenticated user's ID into the handler.
 * Required for per-user resources (canvas panels, user-scoped clusters).
 *
 * - API key auth: uses user_id from the api_keys table. Returns 403 if key has no user_id.
 * - Session auth: uses user.id from Supabase session.
 */
export function withUserAuth(
  handler: (
    request: NextRequest,
    context: { userId: string; params?: Record<string, string> }
  ) => Promise<Response | NextResponse>
) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Promise<Record<string, string>> }
  ): Promise<Response | NextResponse> => {
    const resolvedParams = routeContext?.params ? await routeContext.params : undefined;
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      const key = authHeader.replace(/^Bearer\s+/i, "").trim();

      if (!key.startsWith(API_KEY_PREFIX)) {
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

      if (!keyRecord.user_id) {
        return NextResponse.json(
          {
            error: "This API key is not linked to a user account",
            message: "Canvas operations require a user-scoped API key. Generate one from Settings.",
          },
          { status: 403 }
        );
      }

      const withinLimit = await checkRateLimit(
        keyRecord.id,
        keyRecord.rate_limit_rpm
      );
      if (!withinLimit) {
        return NextResponse.json(
          { error: "Rate limit exceeded", limit: keyRecord.rate_limit_rpm, window: "60 seconds" },
          { status: 429 }
        );
      }

      const endpoint = `${request.method} ${request.nextUrl.pathname}`;
      recordUsage(keyRecord.id, endpoint).catch(console.error);

      return handler(request, { userId: keyRecord.user_id, params: resolvedParams });
    }

    // No auth header — check Supabase session
    const user = await getSessionUser(request);
    if (user) {
      return handler(request, { userId: user.id, params: resolvedParams });
    }

    return NextResponse.json(
      {
        error: "Authentication required",
        message: "Sign in or provide an API key via Authorization: Bearer sk-dopl-... header",
      },
      { status: 401 }
    );
  };
}

/**
 * Like withUserAuth, but also resolves the user's subscription tier.
 * Use for routes that need tier-based gating (ingestion, entry details, build).
 */
export function withSubscriptionAuth(
  handler: (
    request: NextRequest,
    context: { userId: string; tier: SubscriptionTier; params?: Record<string, string> }
  ) => Promise<Response | NextResponse>
) {
  return withUserAuth(async (request, ctx) => {
    const sub = await getUserSubscription(ctx.userId);
    const tier: SubscriptionTier =
      (sub.tier === "pro" || sub.tier === "power") && sub.status === "active"
        ? sub.tier
        : "free";
    return handler(request, { userId: ctx.userId, tier, params: ctx.params });
  });
}

/**
 * Extract the authenticated user from Supabase session cookies.
 */
async function getSessionUser(request: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll() {
            // API routes don't need to set cookies — middleware handles refresh
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  } catch {
    return null;
  }
}
