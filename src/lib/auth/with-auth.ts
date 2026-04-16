import { NextRequest, NextResponse } from "next/server";
import { API_KEY_PREFIX } from "@/lib/config";
import { createServerClient } from "@supabase/ssr";
import { validateApiKey, checkAndRecordRateLimit, touchApiKey } from "./api-keys";
import { getUserSubscription, type SubscriptionTier } from "@/lib/billing/subscriptions";
import {
  CREDIT_COSTS,
  checkAndResetCycle,
  deductCredits,
  grantCredits,
  grantDailyBonus,
  type CreditAction,
  type SubscriptionTier as CreditTier,
} from "@/lib/credits";
import { logMcpEvent } from "@/lib/analytics/mcp-events";
import { logSystemEvent } from "@/lib/analytics/system-events";

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
 * - Session auth: uses user.id from Supabase session.
 */
export function withUserAuth(
  handler: (
    request: NextRequest,
    context: { userId: string; apiKeyId?: string; params?: Record<string, string> }
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
      return runAndLog5xx(
        () =>
          handler(request, {
            userId,
            apiKeyId: keyRecord.id,
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
 * Like withUserAuth, but also enforces credit spend when the request came
 * from an API key (MCP / external integrations). Session-based UI requests
 * bypass credit enforcement — the in-app chat/ingest routes already
 * deduct their own credits; canvas/cluster management is free.
 *
 * Behavior for API-key requests:
 *   1. Auth + rate limit (via withUserAuth)
 *   2. Refresh cycle / grant daily bonus
 *   3. Check balance >= CREDIT_COSTS[action]. If insufficient, return 402.
 *   4. Run handler.
 *   5. On 2xx response, deduct credits. On 4xx/5xx, do not charge.
 *
 * Use this for every MCP-reachable endpoint that represents real usage
 * (search, get entry, build, synthesize, cluster query, etc.).
 */
export function withMcpCredits(
  action: CreditAction,
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

    // Resolve tier (used by both UI and MCP for content-depth gating)
    const sub = await getUserSubscription(ctx.userId);
    const resolvedTier: SubscriptionTier =
      (sub.tier === "pro" || sub.tier === "power") && sub.status === "active"
        ? sub.tier
        : "free";

    // UI (session) calls bypass credit enforcement AND analytics logging.
    // We only instrument MCP-originated calls; in-app usage lives in the
    // conversations table already.
    if (!isApiKey) {
      return handler(request, { ...ctx, tier: resolvedTier });
    }

    // Refresh cycle + daily bonus (idempotent, covers MCP-only users)
    const creditTier = (sub.tier as CreditTier) || "free";
    await checkAndResetCycle(ctx.userId, creditTier, sub.subscription_period_end);
    await grantDailyBonus(ctx.userId, creditTier);

    // ── Capture request args before the handler consumes the body stream ──
    // Clone so the downstream handler can still read the original body.
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

    // Deduct BEFORE running the handler. Using the atomic RPC this is
    // the source of truth — if the user has insufficient credits (either
    // now or because a parallel request just drained them), it returns
    // success=false and we 402 immediately without doing any work.
    const cost = CREDIT_COSTS[action];
    const deductResult = await deductCredits(ctx.userId, action, {
      endpoint,
      source: "mcp",
    });
    if (!deductResult.success) {
      const response = NextResponse.json(
        {
          error: "insufficient_credits",
          message: `This action requires ${cost} credits. You have ${deductResult.newBalance}. Visit ${process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com"}/pricing to upgrade.`,
          balance: deductResult.newBalance,
          cost,
        },
        { status: 402 }
      );
      logMcpEvent({
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId ?? null,
        toolName,
        endpoint,
        arguments: argsPayload,
        responseStatus: 402,
        responseSummary: { error: "insufficient_credits", balance: deductResult.newBalance, cost },
        latencyMs: Date.now() - startedAt,
        source: "mcp",
        error: "insufficient_credits",
      }).catch(() => {});
      return response;
    }

    // Run handler. If it throws or returns a non-2xx response, refund the
    // credits we just deducted so failed requests aren't charged.
    let response: Response | NextResponse;
    try {
      response = await handler(request, { ...ctx, tier: resolvedTier });
    } catch (err) {
      // Refund on crash. Log refund failures so we can catch patterns
      // where users get charged but silently not refunded.
      grantCredits(ctx.userId, cost, `${action}_refund`, {
        endpoint,
        reason: "handler_exception",
      }).catch((refundErr) => {
        logSystemEvent({
          severity: "error",
          category: "other",
          source: "withMcpCredits.refund",
          message: `Credit refund failed on handler exception: ${refundErr instanceof Error ? refundErr.message : String(refundErr)}`,
          fingerprintKeys: ["refund_failed", "handler_exception"],
          metadata: { user_id: ctx.userId, action, cost, endpoint },
          userId: ctx.userId,
        }).catch(() => {});
      });

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

    // Capture a response summary for analytics (best-effort — don't consume
    // the original response body, clone first).
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

    // Refund the upfront deduction if the handler responded with an error
    // (4xx/5xx). Users shouldn't be charged for failed requests.
    if (!response.ok) {
      grantCredits(ctx.userId, cost, `${action}_refund`, {
        endpoint,
        reason: `response_${response.status}`,
      }).catch((refundErr) => {
        logSystemEvent({
          severity: "error",
          category: "other",
          source: "withMcpCredits.refund",
          message: `Credit refund failed on ${response.status} response: ${refundErr instanceof Error ? refundErr.message : String(refundErr)}`,
          fingerprintKeys: ["refund_failed", String(response.status)],
          metadata: { user_id: ctx.userId, action, cost, endpoint, status: response.status },
          userId: ctx.userId,
        }).catch(() => {});
      });
    }

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
