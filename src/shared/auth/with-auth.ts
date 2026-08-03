import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { touchMcpStatus } from "./mcp-session";
import { validateAccessToken } from "./mcp-oauth";
import { logMcpEvent } from "@/features/analytics/server/mcp-events";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { HttpError } from "@/shared/lib/http-error";

/**
 * Per-route options for `withUserAuth` (forwarded through `withWorkspaceAuth`).
 * Both flags ONLY affect OAuth-bearer (remote-MCP agent) callers; session
 * (Supabase-cookie) callers never reach the token branch and so are never
 * gated by either.
 */
export interface UserAuthOptions {
  /**
   * Exempt this route from the OAuth write-scope method gate. Set ONLY on a
   * non-GET route that is not a content write and must stay reachable by a
   * read-only (`dopl.read`-only) connection. The single legitimate case is
   * the MCP liveness ping (`POST /api/user/mcp-status`), which every
   * connection — including read-only ones — fires to light the "MCP
   * connected" indicator. Never set on a route that mutates user/workspace
   * content.
   */
  writeScopeExempt?: boolean;
  /**
   * Interactive-session only: reject EVERY OAuth agent token (any scope,
   * including `dopl.write`) with `403 SESSION_REQUIRED`. Applied to the
   * destructive admin surface a background agent must never drive — account
   * / workspace deletion, membership + invitation + join-request mutations,
   * and billing mutations. This is independent of (and stricter than) the
   * write-scope gate: a full-write token is still refused. Session (cookie)
   * callers pass through untouched.
   */
  sessionOnly?: boolean;
}

/** HTTP methods that are reads for the purposes of the write-scope gate. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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
 * Injects the authenticated user's ID into the handler. Required for per-user
 * resources (canvas panels, user-scoped clusters).
 *
 * - OAuth-token auth (remote MCP): uses the token's user_id. `apiKeyWorkspaceId`
 *   is always undefined — OAuth callers target any workspace via the
 *   `x-workspace-id` header (request pin) or the per-call `workspace=` arg.
 * - Session auth: uses user.id from the Supabase session.
 */
export function withUserAuth(
  handler: (
    request: NextRequest,
    context: {
      userId: string;
      // MCP-agent session marker: the OAuth access-token id for remote-MCP
      // (agent) calls, undefined for session (UI) calls. Downstream handlers use
      // it to tag writeback `source` and to enforce per-resource agent gates
      // (`agent_write_enabled`, canvas-edit access). The "is this an agent?"
      // signal — its truthiness, not the specific id, is what the gates read.
      agentTokenId?: string;
      apiKeyWorkspaceId?: string | null;
      params?: Record<string, string>;
    }
  ) => Promise<Response | NextResponse>,
  options: UserAuthOptions = {}
) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Promise<Record<string, string>> }
  ): Promise<Response | NextResponse> => {
    const resolvedParams = routeContext?.params ? await routeContext.params : undefined;
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();

      // BEARER KIND DISCRIMINATION (desktop migration Phase 2 — see
      // docs/migration-research/auth-flows.md). Two credential families
      // arrive as Authorization headers and they must never be confused:
      //
      //   - `dopl_at_*` — Dopl OAuth tokens (remote-MCP agents + device
      //     tokens). These are AGENTS: `agentTokenId` is set, the
      //     sessionOnly and write-scope gates apply, writes are stamped
      //     `source: "agent"`.
      //   - anything else — tried as a Supabase access JWT (the bundled
      //     desktop SPA's credential; its main process holds the session
      //     and attaches the JWT). Verified LOCALLY against the ES256 JWKS
      //     (same authority + cost profile as the cookie path, see
      //     getSessionUser). A valid JWT caller is a SESSION — identical
      //     semantics to a cookie caller: no agentTokenId, sessionOnly
      //     routes allowed, no write-scope gate, writes are user-origin.
      //
      // The prefix check is exact-match routing, not a heuristic: every
      // token minted by mcp-oauth.ts carries the `dopl_at_` prefix, and a
      // Supabase JWT (three dot-separated base64url segments) can never
      // start with it. An invalid credential of either kind still ends in
      // the same 401 as before — there is no fallthrough from a presented
      // bearer to cookie auth.
      if (!token.startsWith("dopl_at_")) {
        const jwtUser = await getBearerJwtUser(token);
        if (jwtUser) {
          return runAndLog5xx(
            () => handler(request, { userId: jwtUser.id, params: resolvedParams }),
            {
              endpoint: `${request.method} ${request.nextUrl.pathname}`,
              userId: jwtUser.id,
            }
          );
        }
        return NextResponse.json(
          { error: "Invalid or expired credentials" },
          { status: 401 }
        );
      }

      // Remote-MCP OAuth access token. The /api/mcp route forwards the caller's
      // token to these /api/* endpoints over loopback.
      const tok = await validateAccessToken(token);
      if (tok) {
        // Every authenticated MCP call acts as a heartbeat for the settings
        // MCP-connection detector (polls /api/user/mcp-status). Debounced ~30s.
        touchMcpStatus(tok.userId);

        // SESSION-ONLY GATE (H-3). Destructive admin routes refuse ALL OAuth
        // agent tokens regardless of scope — deleting the account/workspace,
        // changing membership, mutating billing must come from an interactive
        // session, never a background agent. Session (cookie) callers never
        // reach this branch, so they're unaffected.
        if (options.sessionOnly) {
          return NextResponse.json(
            new HttpError(
              403,
              "SESSION_REQUIRED",
              "This action requires an interactive Dopl session and can't be performed over an MCP connection. Sign in to the Dopl app to continue."
            ).toResponseBody(),
            { status: 403 }
          );
        }

        // WRITE-SCOPE GATE (H-3). An OAuth bearer authorized read-only (its
        // `scopes` lack `dopl.write`) may not use a write HTTP method against
        // the REST resource server. Fail-closed — write is permitted ONLY when
        // `scopes` explicitly includes `dopl.write` (mirrors the MCP tool gate
        // in packages/mcp-server/src/server.ts). The `/api/mcp` JSON-RPC
        // transport is a SEPARATE wrapper (authenticateMcpRequest) and never
        // hits this branch, so a read op arriving as a POST envelope there is
        // untouched; its writes are scope-gated per-op by WRITE_OPS instead.
        const isWrite = !READ_METHODS.has(request.method);
        const canWrite =
          Array.isArray(tok.scopes) && tok.scopes.includes("dopl.write");
        if (isWrite && !canWrite && !options.writeScopeExempt) {
          return NextResponse.json(
            new HttpError(
              403,
              "WRITE_SCOPE_REQUIRED",
              "This connection was authorized read-only (missing the dopl.write scope). Re-approve the Dopl connection with write access to perform writes."
            ).toResponseBody(),
            {
              status: 403,
              headers: {
                "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="dopl.write"',
              },
            }
          );
        }

        return runAndLog5xx(
          () =>
            handler(request, {
              userId: tok.userId,
              // Marks this as an agent (MCP) call so per-resource agent gates
              // (agent_write_enabled, canvas-edit) and writeback `source`
              // tagging engage — session (UI) calls leave this undefined.
              agentTokenId: tok.tokenId,
              params: resolvedParams,
            }),
          {
            endpoint: `${request.method} ${request.nextUrl.pathname}`,
            userId: tok.userId,
          }
        );
      }
      return NextResponse.json(
        { error: "Invalid or expired credentials" },
        { status: 401 }
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
      { error: "Authentication required", message: "Sign in to continue." },
      { status: 401 }
    );
  };
}

/**
 * Wraps an MCP-reachable endpoint. The per-user 24h trial gate is RETIRED
 * (billing is workspace-level now — see features/billing/entitlements.ts),
 * so this no longer paywalls callers. It still:
 *
 *   1. Auth + rate limit (via withUserAuth).
 *   2. For MCP (OAuth-token) callers: log the call to mcp_events for the
 *      admin transcript/analytics view.
 *   3. Session (UI) calls pass straight through — unmetered, unlogged.
 *
 * The `action` parameter is a tool-name hint for logMcpEvent (dashboards
 * group by tool). These endpoints are the read-only Dopl knowledge packs;
 * workspace-scoped tool traffic runs through withWorkspaceAuth, which also
 * records per-op usage to mcp_tool_calls.
 */
export function withMcpAccess(
  action: string,
  handler: (
    request: NextRequest,
    context: {
      userId: string;
      agentTokenId?: string;
      params?: Record<string, string>;
    }
  ) => Promise<Response | NextResponse>
) {
  return withUserAuth(async (request, ctx) => {
    // An Authorization header means a remote-MCP (OAuth-token) caller, whose
    // loopback /api/* requests all carry the bearer. Session (UI) calls have none.
    const isMcpCaller = !!request.headers.get("authorization");

    // UI (session) calls are unmetered and unlogged.
    if (!isMcpCaller) {
      return handler(request, ctx);
    }

    const endpoint = `${request.method} ${request.nextUrl.pathname}`;
    const toolName = request.headers.get("x-mcp-tool") || action;
    // Workspace attribution — the loopback always sends the workspace
    // UUID; ignore anything that isn't one (slugs, garbage).
    const rawWorkspace = request.headers.get("x-workspace-id");
    const eventWorkspaceId =
      rawWorkspace &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawWorkspace)
        ? rawWorkspace
        : null;
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

    // Run handler.
    let response: Response | NextResponse;
    try {
      response = await handler(request, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logMcpEvent({
        userId: ctx.userId,
        workspaceId: eventWorkspaceId,
        agentTokenId: ctx.agentTokenId ?? null,
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
      workspaceId: eventWorkspaceId,
      agentTokenId: ctx.agentTokenId ?? null,
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

/**
 * Extract the authenticated user id from Supabase session cookies.
 *
 * Q11 (2026-07-31) — this used to call `supabase.auth.getUser()`, a NETWORK
 * round-trip to GoTrue (≈5 Postgres queries) on EVERY cookie-authenticated API
 * request, uncached. `proxy.ts` removed that cost from the middleware; this is
 * the HOTTER copy — one idle focused channels tab polls the consent inbox every
 * few seconds, so a browser sitting untouched was worth thousands of GoTrue-side
 * queries an hour before any real work happened. It is the same amplifier that
 * starved GoTrue on 2026-07-31 until OAuth code-exchange started failing.
 *
 * `getClaims()` verifies the access token LOCALLY against the ES256 JWKS (fetched
 * once, cached process-wide for 10 min) — see the long note in `proxy.ts` and the
 * signature-verification proof in `proxy-claims.test.ts`. Nothing is trusted on
 * decode alone: a tampered signature returns an error, and an HS256 / kid-less
 * legacy token degrades to a network `getUser()` inside auth-js itself.
 *
 * THE try/catch IS LOAD-BEARING, and more so here than in the middleware.
 * `getClaims()` only converts `AuthError`s into `{ data: null, error }`; auth-js
 * `validateExp` throws a PLAIN `Error` ("JWT has expired" / "Missing exp claim")
 * which `getClaims()` RE-THROWS at the caller. `getUser()` could never do that.
 * This wrapper is composed by every `/api/channels/**` route (via
 * `withWorkspaceAuth`), so an uncaught throw here is a 500 on every API route
 * instead of the 401 an expired session must produce. Every road — thrown,
 * errored, or no session — ends at `null`, i.e. the same 401 branch a failed
 * `getUser()` landed in. This layer and the middleware now read the SAME
 * authority, which is what Q4 is about.
 *
 * Returns only what the caller uses: the user id (`claims.sub`).
 */
async function getSessionUser(request: NextRequest): Promise<{ id: string } | null> {
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

    const { data } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    return typeof sub === "string" && sub.length > 0 ? { id: sub } : null;
  } catch {
    return null;
  }
}

/** Bare (cookie-less) client for verifying bearer Supabase JWTs. Lazy
 *  singleton so the JWKS cache inside auth-js is shared process-wide. */
let _jwtClient: SupabaseClient | null = null;
function jwtClient(): SupabaseClient {
  if (!_jwtClient) {
    _jwtClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _jwtClient;
}

/**
 * Verify a Supabase access JWT presented as a Bearer credential (the
 * bundled desktop SPA path). Same verification authority as
 * `getSessionUser` — `getClaims(jwt)` checks the signature locally against
 * the cached ES256 JWKS; nothing is trusted on decode alone — and the same
 * load-bearing try/catch: auth-js re-throws plain Errors for expired/
 * malformed tokens, and every road must end at null → 401, never a 500.
 */
async function getBearerJwtUser(token: string): Promise<{ id: string } | null> {
  try {
    const { data } = await jwtClient().auth.getClaims(token);
    const sub = data?.claims?.sub;
    return typeof sub === "string" && sub.length > 0 ? { id: sub } : null;
  } catch {
    return null;
  }
}
