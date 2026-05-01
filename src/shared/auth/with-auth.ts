import { NextRequest, NextResponse } from "next/server";
import { API_KEY_PREFIX } from "@/config";
import { createServerClient } from "@supabase/ssr";
import { validateApiKey, checkAndRecordRateLimit, touchApiKey, touchMcpStatus } from "./api-keys";
import { getUserSubscription, type SubscriptionTier } from "@/features/billing/server/subscriptions";
import { hasActiveAccess, accessDeniedBody } from "@/features/billing/server/access";
import { logMcpEvent } from "@/features/analytics/server/mcp-events";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * Wrap a handler call so any thrown error or 5xx response emits a
 * system_events row. Used by withUserAuth so every authenticated route
 * automatically contributes to the health dashboard.
 */
async function runAndLog5xx(
  handler: () => Promise<Response | NextResponse>,
  ctx: { endpoint: string; userId?: string | null }
): Promise<Response | NextResponse> {
  try {
    const response = await handler();
    if (response.status >= 500) {
      void logSystemEvent({
        severity: "error",
        category: "other",
        source: ctx.endpoint,
        message: `5xx response: ${response.status}`,
        fingerprintKeys: ["5xx", ctx.endpoint, String(response.status)],
        metadata: { status_code: response.status },
        userId: ctx.userId ?? null,
      });
    }
    return response;
  } catch (err) {
    const name = err instanceof Error ? err.name : "UnknownError";
    const message = err instanceof Error ? err.message : String(err);
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: ctx.endpoint,
      message: `Handler threw: ${message}`,
      fingerprintKeys: ["handler_throw", ctx.endpoint, name],
      metadata: { error_name: name },
      userId: ctx.userId ?? null,
    });
    throw err;
  }
}

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

      // Atomic rate limit + usage record (single RPC, no race).
      const endpoint = `${request.method} ${request.nextUrl.pathname}`;
      const withinLimit = await checkAndRecordRateLimit(
        keyRecord.id,
        keyRecord.rate_limit_rpm,
        endpoint
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

      touchApiKey(keyRecord.id);

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
 *   When the API key carries a `workspace_id` (Item 4 — workspace-scoped keys),
 *   it's surfaced via `apiKeyWorkspaceId` for `withWorkspaceAuth` to enforce.
 * - Session auth: uses user.id from Supabase session. `apiKeyWorkspaceId` is undefined.
 */
export function withUserAuth(
  handler: (
    request: NextRequest,
    context: {
      userId: string;
      apiKeyId?: string;
      apiKeyWorkspaceId?: string | null;
      params?: Record<string, string>;
    }
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

      const endpoint = `${request.method} ${request.nextUrl.pathname}`;
      const withinLimit = await checkAndRecordRateLimit(
        keyRecord.id,
        keyRecord.rate_limit_rpm,
        endpoint
      );
      if (!withinLimit) {
        return NextResponse.json(
          { error: "Rate limit exceeded", limit: keyRecord.rate_limit_rpm, window: "60 seconds" },
          { status: 429 }
        );
      }

      touchApiKey(keyRecord.id);

      // Locally bind narrowed userId so the closure sees a non-null value.
      const userId = keyRecord.user_id;
      // Every authenticated MCP call acts as a heartbeat for the
      // welcome-step connection detector. Debounced to ~30s.
      touchMcpStatus(userId);
      return runAndLog5xx(
        () =>
          handler(request, {
            userId,
            apiKeyId: keyRecord.id,
            apiKeyWorkspaceId: keyRecord.workspace_id,
            params: resolvedParams,
          }),
        { endpoint, userId }
      );
    }

    // No auth header — check Supabase session
    const user = await getSessionUser(request);
    if (user) {
      return runAndLog5xx(
        () => handler(request, { userId: user.id, params: resolvedParams }),
        {
          endpoint: `${request.method} ${request.nextUrl.pathname}`,
          userId: user.id,
        }
      );
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
    context: { userId: string; apiKeyId?: string; tier: SubscriptionTier; params?: Record<string, string> }
  ) => Promise<Response | NextResponse>
) {
  return withUserAuth(async (request, ctx) => {
    const sub = await getUserSubscription(ctx.userId);
    const tier: SubscriptionTier =
      (sub.tier === "pro" || sub.tier === "power") && sub.status === "active"
        ? sub.tier
        : "free";
    return handler(request, { userId: ctx.userId, apiKeyId: ctx.apiKeyId, tier, params: ctx.params });
  });
}

/**
 * Replaces the old credit-based withMcpCredits. Gates every MCP-reachable
 * endpoint by the single hasActiveAccess() check:
 *
 *   1. Auth + rate limit (via withUserAuth).
 *   2. API-key requests only: check trial-active-or-paid. Session (UI) calls bypass.
 *   3. If denied, return 402 with a clean trial_expired body and log the event.
 *   4. Run the handler. Log the MCP event for analytics. No credit math.
 *
 * The `action` parameter is kept purely as a tool-name hint for
 * logMcpEvent (so the dashboards still group by tool). No deduction or
 * refund logic runs.
 */
export function withMcpAccess(
  action: string,
  handler: (
    request: NextRequest,
    context: {
      userId: string;
      apiKeyId?: string;
      tier: SubscriptionTier;
      params?: Record<string, string>;
    }
  ) => Promise<Response | NextResponse>
) {
  return withUserAuth(async (request, ctx) => {
    const isApiKey = !!request.headers.get("authorization");

    // Resolve tier for downstream content-depth logic (still used for
    // free vs paid content gating inside some handlers). "free" here
    // means non-paid — includes trialing users.
    const sub = await getUserSubscription(ctx.userId);
    const resolvedTier: SubscriptionTier =
      sub.status === "active" && (sub.tier === "pro" || sub.tier === "power")
        ? sub.tier
        : "free";

    // UI (session) calls are unmetered and unlogged — in-app usage is
    // tracked via the conversations table. MCP calls get gated + logged.
    if (!isApiKey) {
      return handler(request, { ...ctx, tier: resolvedTier });
    }

    const endpoint = `${request.method} ${request.nextUrl.pathname}`;
    const toolName = request.headers.get("x-mcp-tool") || action;
    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    let argsPayload: unknown = Object.keys(queryParams).length > 0 ? queryParams : null;
    if (request.method !== "GET" && request.method !== "DELETE") {
      try {
        const bodyJson = await request.clone().json();
        argsPayload = bodyJson ?? argsPayload;
      } catch {
        // Body may be empty/non-JSON — fall back to query params (or null)
      }
    }
    const startedAt = Date.now();

    // ── Access gate: trialing or paid, or 402. ──
    const access = await hasActiveAccess(ctx.userId);
    if (!access.allowed) {
      const body = accessDeniedBody(access);
      const response = NextResponse.json(body, { status: 402 });
      logMcpEvent({
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId ?? null,
        toolName,
        endpoint,
        arguments: argsPayload,
        responseStatus: 402,
        responseSummary: body,
        latencyMs: Date.now() - startedAt,
        source: "mcp",
        error: "trial_expired",
      }).catch(() => {});
      return response;
    }

    // Run handler.
    let response: Response | NextResponse;
    try {
      response = await handler(request, { ...ctx, tier: resolvedTier });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logMcpEvent({
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId ?? null,
        toolName,
        endpoint,
        arguments: argsPayload,
        responseStatus: 500,
        latencyMs: Date.now() - startedAt,
        source: "mcp",
        error: message,
      }).catch(() => {});
      throw err;
    }

    // Capture response summary for analytics.
    let responseSummary: unknown = null;
    let errorMessage: string | null = null;
    try {
      const clone = response.clone();
      const text = await clone.text();
      if (text) {
        try {
          responseSummary = JSON.parse(text);
          if (
            !response.ok &&
            responseSummary &&
            typeof responseSummary === "object" &&
            "error" in responseSummary
          ) {
            errorMessage = String((responseSummary as { error: unknown }).error);
          }
        } catch {
          responseSummary = { _nonJson: true, preview: text.slice(0, 500) };
        }
      }
    } catch {
      // clone/read failed — skip summary
    }

    logMcpEvent({
      userId: ctx.userId,
      apiKeyId: ctx.apiKeyId ?? null,
      toolName,
      endpoint,
      arguments: argsPayload,
      responseStatus: response.status,
      responseSummary,
      latencyMs: Date.now() - startedAt,
      source: "mcp",
      error: errorMessage,
    }).catch(() => {});

    return response;
  });
}

/**
 * Returns true if the given user ID is the designated admin.
 * Admin is bound to a single Supabase auth UUID via ADMIN_USER_ID env var.
 */
export function isAdmin(userId: string | null | undefined): boolean {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || !userId) return false;
  return userId === adminId;
}

// ── Boot validation ─────────────────────────────────────────────────
// Warn loudly at module load if ADMIN_USER_ID isn't configured.
// Without it, every admin route silently returns 404 and the moderation
// queue fills up forever with no way to approve entries. A one-time
// stderr line is cheap insurance.
if (typeof process !== "undefined" && !process.env.ADMIN_USER_ID) {
  console.warn(
    "[auth] ADMIN_USER_ID is not set. /admin/* routes will reject all callers as 404. " +
      "Set ADMIN_USER_ID to your Supabase auth UUID to enable moderation."
  );
}
if (typeof process !== "undefined" && !process.env.ADMIN_SECRET) {
  console.warn(
    "[auth] ADMIN_SECRET is not set. /api/admin/keys will reject all callers as 401."
  );
}

/**
 * Like withUserAuth, but also requires the caller to be the designated admin
 * (as set via the ADMIN_USER_ID env var). Returns 403 otherwise.
 *
 * Use for routes that manage the global entry moderation queue.
 */
export function withAdminAuth(
  handler: (
    request: NextRequest,
    context: { userId: string; params?: Record<string, string> }
  ) => Promise<Response | NextResponse>
) {
  return withUserAuth(async (request, ctx) => {
    if (!isAdmin(ctx.userId)) {
      // Return 404 rather than 403 so admin routes are indistinguishable
      // from nonexistent ones. Non-admins (and MCP clients) must never
      // learn that an admin surface exists at this path.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return handler(request, ctx);
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
