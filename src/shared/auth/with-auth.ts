import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { touchMcpStatus, checkAndRecordRateLimitSubject } from "./mcp-session";
import { isOAuthAccessToken, validateAccessToken } from "./mcp-oauth";
import { getBearerJwtUser } from "./bearer-jwt";
import { logMcpEvent } from "@/features/analytics/server/mcp-events";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { HttpError } from "@/shared/lib/http-error";

/** Per-route options for `withUserAuth` (forwarded through
 *  `withWorkspaceAuth`). ⚠ Both flags affect OAuth-bearer (agent) callers ONLY;
 *  session callers never reach the token branch. */
export interface UserAuthOptions {
  /**
   * Exempt route from OAuth write-scope method gate. ⚠ Set ONLY on a non-GET
   * route that is not a content write and must stay reachable read-only
   * (`dopl.read`-only) — sole legitimate case is the MCP liveness ping
   * `POST /api/user/mcp-status`. Never on a route that mutates content.
   */
  writeScopeExempt?: boolean;
  /**
   * Reject EVERY OAuth agent token (any scope, incl. `dopl.write`) with
   * `403 SESSION_REQUIRED`. Stricter than, and independent of, the write-scope
   * gate. For the destructive admin surface: account/workspace deletion,
   * membership + invitation + join-request mutations, billing mutations.
   */
  sessionOnly?: boolean;
}

/**
 * Second argument Next passes to an exported route method, and the ONLY shape
 * its type checker accepts there.
 *
 * ⚠ BOTH the parameter AND `params` must be REQUIRED. Next generates, per route
 * it compiles, `.next/dev/types/app/api/**\/route.ts` containing
 * `type RouteContext = { params: Promise<SegmentParams> }` and asserts
 * `SecondArg<HANDLER>` extends it (`ParamCheck<RouteContext>`), and tsconfig
 * includes `.next/dev/types/**\/*.ts`. `SecondArg` is inferred from the
 * parameter tuple, so an OPTIONAL param (incl. one with a default value —
 * a default does not make a parameter required in the function type) yields
 * `... | undefined` and fails; an optional `params?` fails too, because
 * `Promise<…> | undefined` is not assignable to `Promise<SegmentParams>`.
 * Pinned by `route-context-signature.test.ts`, which mirrors the generated
 * checker (a test cannot import from `.next/`).
 *
 * Runtime is unaffected: Next always calls with a context object, and the
 * wrapper still reads `params` defensively.
 */
export interface RouteContextArg {
  params: Promise<Record<string, string>>;
}

/** HTTP methods that are reads for the purposes of the write-scope gate. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Per-token ceiling for OAuth bearers hitting REST directly. ⚠ Must stay
 * identical to the `/api/mcp` transport limiter in
 * `src/shared/auth/with-mcp-transport-auth.ts`: same store
 * (`rate_limit_events`), same subject (`mcp:<tokenId>`), same env var — one
 * UNIFIED budget across both doors, not two.
 */
const OAUTH_REST_RPM = Number(process.env.MCP_OAUTH_RATE_LIMIT_RPM) || 600;

/** Emit a system_events row on any throw or 5xx — feeds the health dashboard. */
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
 * Injects the authenticated user's ID into the handler.
 *
 * - OAuth-token (remote MCP): token's user_id, and — since 2026-08-26 — the
 *   token's own `workspace_id` as `apiKeyWorkspaceId`.
 * - Session: user.id from the Supabase session.
 *
 * 🔒 ⚠ `apiKeyWorkspaceId` HAS A PRODUCER AGAIN, AND THIS IS IT. This docblock
 * used to say it was *"always undefined"*, and it was: the `api_keys` table it
 * was written for was dropped by `20260609000000_drop_api_key_auth.sql` and
 * INVARIANTS §4 recorded the whole chain as "dead scaffolding; preserved". What
 * revived it is the CONTAINER-LOCKED CHILD CREDENTIAL (plan §4.4 B1): the
 * desktop mints a token carrying `mcp_tokens.workspace_id` for a session
 * spawned into a SHARED link container, and this line is what makes the lock
 * reach `with-workspace-auth`'s 403.
 *
 * ⚠ SO THE M-10 GATES THAT READ IT ARE NO LONGER DEAD EITHER, and there are
 * more of them than this file: `knowledge/server/service-shared.ts › canSeeBase`
 * (private bases are invisible to a workspace-scoped key), the same predicate in
 * chats, skills and agent-templates, and the `fromWorkspaceKey` branches in the
 * knowledge and skill write services. They all start biting for these tokens
 * together. That is intended — a credential a PEER's presence caused to exist
 * should not be able to read its operator's private drafts — but it is a
 * behaviour change on every one of those paths, not just on workspace targeting.
 */
export function withUserAuth(
  handler: (
    request: NextRequest,
    context: {
      userId: string;
      // OAuth access-token id for agent calls, undefined for session (UI)
      // calls. Truthiness (not the id) is the "is this an agent?" signal read
      // by writeback `source` tagging and per-resource agent gates
      // (`agent_write_enabled`, canvas-edit).
      agentTokenId?: string;
      apiKeyWorkspaceId?: string | null;
      params?: Record<string, string>;
    }
  ) => Promise<Response | NextResponse>,
  options: UserAuthOptions = {}
) {
  return async (
    request: NextRequest,
    routeContext: RouteContextArg
  ): Promise<Response | NextResponse> => {
    const resolvedParams = routeContext?.params ? await routeContext.params : undefined;
    const authHeader = request.headers.get("authorization");

    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();

      // ⚠ BEARER KIND DISCRIMINATION. Two credential families arrive as
      // Authorization headers; never confuse them:
      //   - `dopl_at_*` (minted by mcp-oauth.ts) = AGENT: agentTokenId set,
      //     sessionOnly + write-scope gates apply, writes stamped `source:
      //     "agent"`.
      //   - anything else = tried as Supabase access JWT (desktop SPA). A valid
      //     JWT caller is a SESSION, semantics identical to a cookie caller: no
      //     agentTokenId, sessionOnly routes allowed, no write-scope gate.
      // Prefix check is exact-match routing, not a heuristic — a Supabase JWT
      // can never start with `dopl_at_`. No fallthrough from a presented bearer
      // to cookie auth; an invalid credential of either kind is 401.
      if (!isOAuthAccessToken(token)) {
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

      // Remote-MCP OAuth access token. /api/mcp forwards the caller's token to
      // these /api/* endpoints over loopback.
      const tok = await validateAccessToken(token);
      if (tok) {
        // ⚠ Same limiter as the `/api/mcp` transport (with-mcp-transport-auth.ts):
        // same store, subject `mcp:<tokenId>`, same ceiling — one unified budget
        // across both doors. Without it a bearer pointed straight at REST bypasses
        // the transport limit. Enforced FIRST so requests the gates below would 403
        // still count. Fail-closed (RPC returns false on any DB error).
        const withinLimit = await checkAndRecordRateLimitSubject(
          `mcp:${tok.tokenId}`,
          OAUTH_REST_RPM,
          `${request.method} ${request.nextUrl.pathname}`
        );
        if (!withinLimit) {
          return NextResponse.json(
            new HttpError(
              429,
              "RATE_LIMITED",
              "Rate limit exceeded for this connection. Try again shortly."
            ).toResponseBody(),
            { status: 429, headers: { "Retry-After": "60" } }
          );
        }

        // Heartbeat for the settings MCP-connection detector (polls
        // /api/user/mcp-status). Debounced ~30s.
        touchMcpStatus(tok.userId);

        // Session-only gate: destructive admin routes refuse ALL agent tokens
        // regardless of scope.
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

        // Write-scope gate. Fail-closed: write permitted ONLY when `scopes`
        // explicitly includes `dopl.write`. ⚠ Mirrors the MCP tool gate in
        // packages/mcp-server/src/server.ts — keep both in sync. The /api/mcp
        // JSON-RPC transport uses a separate wrapper (authenticateMcpRequest)
        // and never hits this branch; its writes are gated per-op by WRITE_OPS.
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
              agentTokenId: tok.tokenId,
              // 🔒 THE CONTAINER LOCK. `null` for every ordinary credential.
              apiKeyWorkspaceId: tok.workspaceId,
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
 * Wraps an MCP-reachable endpoint. Does NOT paywall (billing is
 * workspace-level). Auth + per-token rate limiting via withUserAuth; OAuth-token
 * callers are logged to mcp_events; session (UI) calls pass straight through,
 * unmetered and unlogged. `action` is a tool-name hint for logMcpEvent.
 * ⚠ These are the read-only knowledge packs — workspace-scoped tool traffic goes
 * through withWorkspaceAuth, which records per-op usage to mcp_tool_calls.
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
    // ⚠ Key off token KIND, never header presence: a bare "has Authorization"
    // test misclassifies desktop Supabase-JWT sessions as MCP and writes their
    // request bodies into mcp_events.
    const bearerForKind = (request.headers.get("authorization") ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const isMcpCaller = isOAuthAccessToken(bearerForKind);

    if (!isMcpCaller) {
      return handler(request, ctx);
    }

    const endpoint = `${request.method} ${request.nextUrl.pathname}`;
    const toolName = request.headers.get("x-mcp-tool") || action;
    // Loopback always sends the workspace UUID; ignore slugs/garbage.
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
        // Empty/non-JSON body — fall back to query params (or null)
      }
    }
    const startedAt = Date.now();

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

/** Admin is a single Supabase auth UUID, bound via the ADMIN_USER_ID env var. */
export function isAdmin(userId: string | null | undefined): boolean {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || !userId) return false;
  return userId === adminId;
}

// Boot validation: without ADMIN_USER_ID every admin route silently 404s and
// the moderation queue fills with no way to approve entries.
if (typeof process !== "undefined" && !process.env.ADMIN_USER_ID) {
  console.warn(
    "[auth] ADMIN_USER_ID is not set. /admin/* routes will reject all callers as 404. " +
      "Set ADMIN_USER_ID to your Supabase auth UUID to enable moderation."
  );
}

/**
 * Extract the authenticated user id from Supabase session cookies.
 *
 * ⚠ Never `getUser()` here — network round-trip to GoTrue (≈5 Postgres queries)
 * on EVERY cookie-authed API request. `getClaims()` verifies the access token
 * locally against the ES256 JWKS; a tampered signature errors, an HS256/kid-less
 * legacy token degrades to a network `getUser()` inside auth-js.
 *
 * ⚠ THE try/catch IS LOAD-BEARING. `getClaims()` converts only `AuthError`s into
 * `{ data: null, error }`; auth-js `validateExp` throws a PLAIN `Error` ("JWT has
 * expired" / "Missing exp claim") that `getClaims()` re-throws at the caller.
 * Every `/api/channels/**` route composes this via `withWorkspaceAuth`, so an
 * uncaught throw is a 500 on every API route instead of the required 401. Every
 * road — thrown, errored, no session — must end at `null`.
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

