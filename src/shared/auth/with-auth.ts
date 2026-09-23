import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { touchMcpStatus, checkAndRecordRateLimitSubject } from "./mcp-session";
import { isOAuthAccessToken, validateAccessToken } from "./mcp-oauth";
import { getBearerJwtUser } from "./bearer-jwt";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { HttpError } from "@/shared/lib/http-error";
import { runWithCallerScope } from "@/shared/supabase/caller-scope";
import { sessionCallerScope, tokenCallerScope } from "./with-auth-scope";

/** Per-route options for `withUserAuth` (forwarded through `withWorkspaceAuth`). Both affect OAuth
 *  bearer (agent) callers only. */
export interface UserAuthOptions {
  /** Exempt a non-GET, non-content route from the write-scope gate — only the MCP liveness ping
   *  `POST /api/user/mcp-status`. Never on a route that mutates content. */
  writeScopeExempt?: boolean;
  /** Refuse every OAuth agent token (any scope) with `403 SESSION_REQUIRED` — the destructive admin
   *  surface (account/workspace deletion, membership, billing). */
  sessionOnly?: boolean;
}

/**
 * Next's second route-handler argument. Both the parameter and `params` must be required: Next's
 * generated `ParamCheck<RouteContext>` rejects any `| undefined` (a default value counts as optional).
 * Pinned by `route-context-signature.test.ts`.
 */
export interface RouteContextArg {
  params: Promise<Record<string, string>>;
}

/** HTTP methods that are reads for the purposes of the write-scope gate. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Per-token ceiling for OAuth bearers on REST. Must match `with-mcp-transport-auth.ts`: same store,
 *  subject `mcp:<tokenId>` and env var — one budget across both doors. */
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
 * Injects the authenticated user into the handler, with the credential's two independent axes:
 *  - `apiKeyWorkspaceId` — which container (`mcp_tokens.container_id`), for a container-locked token;
 *  - `credentialSubjectUserId` — whose reach (`mcp_tokens.subject_user_id`), read only through
 *    `credential-audience.ts › isSharedCredential`; `null` = nobody in particular, the narrow rule.
 * Reading one axis off the other is F-333/F-336. Sessions and bearer JWTs are unfenced, own subject.
 * The caller scope (`shared/supabase/caller-scope.ts`) is established here, from the credential this
 * function validated; `withWorkspaceAuth` composes this. A read outside such a request has no scope
 * and keeps the service-role client, fenced by the TS predicates.
 */
export function withUserAuth(
  handler: (
    request: NextRequest,
    context: {
      userId: string;
      // Set for agent (OAuth) calls only; its truthiness is the "is this an agent?" signal
      // (writeback `source`, `agent_write_enabled`).
      agentTokenId?: string;
      /** Axis 1 — which container (`mcp_tokens.container_id`); `null` = unfenced. */
      apiKeyWorkspaceId?: string | null;
      /** Axis 2 — whose reach (`mcp_tokens.subject_user_id`); `null` = nobody in particular. Required;
       *  read only through `isSharedCredential`. */
      credentialSubjectUserId: string | null;
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

      // Two bearer families, routed by exact prefix (a Supabase JWT never starts `dopl_at_`):
      //   `dopl_at_*` = agent: `agentTokenId` set, sessionOnly + write-scope gates apply.
      //   anything else = Supabase access JWT (desktop SPA) = a session, same as a cookie caller.
      // No fallthrough to cookie auth once a bearer is presented; an invalid one is 401.
      if (!isOAuthAccessToken(token)) {
        const jwtUser = await getBearerJwtUser(token);
        if (jwtUser) {
          return runAndLog5xx(
            () =>
              runWithCallerScope(sessionCallerScope(jwtUser.id), () =>
                handler(request, {
                  userId: jwtUser.id,
                  // A signed-in person is their own subject, and unfenced — stated, not defaulted.
                  credentialSubjectUserId: jwtUser.id,
                  params: resolvedParams,
                })
              ),
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

      // Remote-MCP OAuth token; `/api/mcp` forwards it to `/api/*` over loopback.
      const tok = await validateAccessToken(token);
      if (tok) {
        // Subject `mcp:<tokenId>`, shared with the `/api/mcp` limiter, so a bearer aimed at REST cannot
        // bypass it. Checked first so gated-out requests still count; fail-closed on DB error.
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

        // Heartbeat for the settings MCP-connection detector; debounced.
        touchMcpStatus(tok.userId);

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

        // Fail-closed: a write needs `dopl.write` explicitly. Mirrors the tool gate in
        // `packages/mcp-server/src/server.ts`; keep both in sync.
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
            // The one lane whose axes vary; `with-auth-scope.ts › tokenCallerScope` reads the subject axis.
            runWithCallerScope(tokenCallerScope(tok), () =>
              handler(request, {
                userId: tok.userId,
                agentTokenId: tok.tokenId,
                apiKeyWorkspaceId: tok.containerId,
                // Dropping this fails closed, silently: every agent token reads as shared (F-336).
                credentialSubjectUserId: tok.subjectUserId,
                params: resolvedParams,
              })
            ),
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

    // No auth header: Supabase session cookie.
    const user = await getSessionUser(request);
    if (user) {
      return runAndLog5xx(
        () =>
          runWithCallerScope(sessionCallerScope(user.id), () =>
            handler(request, {
              userId: user.id,
              // A cookie caller is a person, never a shared credential.
              credentialSubjectUserId: user.id,
              params: resolvedParams,
            })
          ),
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

/** Admin is a single Supabase auth UUID, bound via the ADMIN_USER_ID env var. */
export function isAdmin(userId: string | null | undefined): boolean {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || !userId) return false;
  return userId === adminId;
}

// Without ADMIN_USER_ID every admin route silently 404s.
if (typeof process !== "undefined" && !process.env.ADMIN_USER_ID) {
  console.warn(
    "[auth] ADMIN_USER_ID is not set. /admin/* routes will reject all callers as 404. " +
      "Set ADMIN_USER_ID to your Supabase auth UUID to enable moderation."
  );
}

/**
 * The user id from Supabase session cookies. Never `getUser()` here: a network round trip per
 * request; `getClaims()` verifies the token locally against the JWKS.
 * The try/catch is load-bearing: `getClaims()` re-throws a plain `Error` on an expired JWT, which
 * would be a 500 instead of a 401 — every road must end at `null`.
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
            // Middleware handles refresh; API routes never set cookies.
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

