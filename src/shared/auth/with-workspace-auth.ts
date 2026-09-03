import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import {
  resolveActiveWorkspace,
  WorkspaceResolutionError,
} from "@/features/workspaces/server/service";
import type { Role, WorkspaceKind } from "@/features/workspaces/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { logMcpToolCall } from "@/features/analytics/server/mcp-tool-calls";
import { readAppVersionHeader } from "./app-version-header";
import {
  narrowRuntime,
  readRuntimeHeader,
  type DoplRuntime,
} from "./runtime-header";
import { readSessionIdHeader } from "./session-header";
import { withUserAuth } from "./with-auth";

export interface WorkspaceAuthContext {
  userId: string;
  agentTokenId?: string;
  /**
   * 🔒 AXIS 1 — WHICH CONTAINER the credential may act in
   * (`mcp_tokens.container_id`). `null` for session callers and unfenced keys.
   * The 403 below is the only thing that reads it here.
   *
   * ⚠ IT ANSWERS *WHICH*, NEVER *WHOSE*. Reading it as an audience is F-336;
   * the audience is {@link WorkspaceAuthContext.credentialSubjectUserId}.
   */
  apiKeyWorkspaceId?: string | null;
  /**
   * 🔒 AXIS 2 — WHOSE REACH the credential inherits
   * (`mcp_tokens.subject_user_id`): the ONE human it acts as, or `null` for a
   * credential that may be passed between humans (a CI runner, a service
   * account), which must inherit nobody's private rows (M-10).
   *
   * ⚠ REQUIRED, and read ONLY through `credential-audience.ts ›
   * isSharedCredential`. It is independent of axis 1 in both directions: a
   * container session is fenced AND personal, and it is fenced by the 403 above
   * exactly as before.
   */
  credentialSubjectUserId: string | null;
  workspaceId: string;
  workspaceSlug: string;
  workspacePublicId: string;
  /**
   * `link` = a hidden home-channel container, which has no plan of its own.
   * FREE — the resolver already read the row. Absent = "standard" (the column
   * applied 2026-08-24, but the default outlives it: a narrowed projection or an
   * older row carries none); read it through
   * `features/workspaces/types.ts › isStandardWorkspace`, never by hand. Routing
   * / billing hint, NEVER an authz signal — membership is what grants access.
   */
  workspaceKind?: WorkspaceKind;
  role: Role;
  /**
   * Recognized `X-Dopl-Runtime` (`desktop-session` | `desktop-ui`), else
   * undefined. ⚠ Read once HERE, never off the raw request in a feature — ONE
   * trusted source for the reserved `metadata.runtime` stamp. Routing hint,
   * NEVER an authz signal (`runtime-header.ts`).
   *
   * ⚠ Already bounded by the credential: `desktop-ui` is refused for an agent
   * (`dopl_at_*`) token; `desktop-session` is credential-agnostic on purpose —
   * it IS an agent-token caller. See `narrowRuntime`.
   */
  runtime?: DoplRuntime;
  /**
   * `X-Dopl-App-Version` (a desktop build like `1.7.15`), else undefined. ⚠ Read
   * once here, never off the raw request in a feature — ONE source for the
   * reserved `metadata.appVersion` stamp. Diagnostic hint, NEVER an authz signal
   * (`app-version-header.ts`).
   */
  appVersion?: string;
  /**
   * `X-Dopl-Session-Id` (the desktop's slot key for the calling session), else
   * undefined. ⚠ Read once here, never off the raw request in a feature — ONE
   * source for the reserved `metadata.session_id` stamp. ATTRIBUTION hint,
   * NEVER an authz signal (`session-header.ts`).
   */
  sessionId?: string;
  params?: Record<string, string>;
}

interface Options {
  /** Min membership role. Default "viewer". "member" for writes, "admin" for
   *  invitations/settings, "owner" for delete. "guest" is the FLOOR below viewer
   *  (INVARIANTS §4A): only routes explicitly set to "guest" admit a guest — the
   *  "viewer" default REJECTS one, so every workspace-scoped route fails closed
   *  against guests unless it opts in. */
  minRole?: Role;
  /**
   * Opt-in for GET download routes (`<a download>` can't send headers): let
   * `?workspaceId=` participate in resolution at the SAME priority as the
   * `X-Workspace-Id` header. Key lock still wins over both; header wins over the
   * query param.
   */
  workspaceIdFromQuery?: boolean;
  /** Forwarded verbatim into the inner `withUserAuth` — see `UserAuthOptions`. */
  writeScopeExempt?: boolean;
  sessionOnly?: boolean;
}

/**
 * Composes `withUserAuth`, additionally resolving the active workspace and
 * verifying membership + role.
 *
 * ⚠ Resolution priority, most explicit first:
 *   1. Workspace-scoped API key's `workspace_id`. A contradicting requested
 *      target 403s — one key must never be used cross-workspace.
 *   2. Else `X-Workspace-Id` header (UUID only; blank/non-UUID → 400
 *      WORKSPACE_INVALID). With `workspaceIdFromQuery`, `?workspaceId=` slots in
 *      at the same priority (header wins).
 *   3. Else **the caller's own personal container** (`resolveActiveWorkspace`),
 *      minted on first ask. ⚠ Ruling B10: there is no derivation left here, so
 *      there is no membership count, no auto-target and no refusal to render —
 *      an unnamed request lands on a container the caller is the only member of,
 *      which is why removing the refusal does not widen anything.
 *
 * Per-workspace routes use this; user-global routes (settings, billing, global
 * entry KB, admin) keep `withUserAuth`.
 *
 * ⚠ Deliberately does NOT call `withMcpAccess`: a user's own workspace + KBs are
 * their content and must not be paywalled. The per-resource gate is
 * `agent_write_enabled`; rate-limit + analytics still happen in `withUserAuth`.
 */
export function withWorkspaceAuth(
  handler: (
    request: NextRequest,
    context: WorkspaceAuthContext
  ) => Promise<Response | NextResponse>,
  options: Options = {}
) {
  const minRole: Role = options.minRole ?? "viewer";
  return withUserAuth(async (request, ctx) => {
    const headerWorkspaceId = request.headers.get("x-workspace-id");
    const queryWorkspaceId = options.workspaceIdFromQuery
      ? request.nextUrl.searchParams.get("workspaceId")
      : null;
    // ⚠ `??` (not `||`) keeps a present-but-blank header authoritative so it
    // still fails closed as WORKSPACE_INVALID.
    const requestedWorkspaceId = headerWorkspaceId ?? queryWorkspaceId;
    const keyWorkspaceId = ctx.apiKeyWorkspaceId ?? null;

    // Workspace-scoped API key: enforce the lock.
    let effectiveWorkspaceId = requestedWorkspaceId;
    if (keyWorkspaceId) {
      // ⚠ Trim before the compare, else a whitespace-padded value reads as a
      // spurious cross-workspace mismatch.
      const requestedTrimmed = requestedWorkspaceId?.trim();
      if (requestedTrimmed && requestedTrimmed !== keyWorkspaceId) {
        return NextResponse.json(
          new HttpError(
            403,
            "API_KEY_WORKSPACE_MISMATCH",
            "API key is locked to a different workspace than the X-Workspace-Id header"
          ).toResponseBody(),
          { status: 403 }
        );
      }
      effectiveWorkspaceId = keyWorkspaceId;
    }

    try {
      const { workspace, membership } = await resolveActiveWorkspace(
        ctx.userId,
        effectiveWorkspaceId
      );
      if (!meetsMinRole(membership.role, minRole)) {
        return NextResponse.json(
          new HttpError(
            403,
            "WORKSPACE_FORBIDDEN",
            `Requires ${minRole} role or higher`
          ).toResponseBody(),
          { status: 403 }
        );
      }
      // Per-op MCP usage instrumentation, agent callers only. Loopback sends a
      // granular `X-MCP-Tool` ("kb_write_file", …); split on first "_" into
      // tool + op. Fire-and-forget.
      if (ctx.agentTokenId) {
        const mcpTool = request.headers.get("x-mcp-tool");
        // ⚠ LEADING UNDERSCORE = INTERNAL (MCP layer calling our own
        // infrastructure routes), NOT analytics: `_mcp_credits_consume` fires
        // on EVERY tool call, so logging it adds an `mcp_tool_calls` insert per
        // call and puts a synthetic "tool" atop every usage query. No real tool
        // name starts with `_`.
        if (mcpTool && !mcpTool.startsWith("_")) {
          const sep = mcpTool.indexOf("_");
          void logMcpToolCall({
            workspaceId: workspace.id,
            userId: ctx.userId,
            tool: sep > 0 ? mcpTool.slice(0, sep) : mcpTool,
            op: sep > 0 ? mcpTool.slice(sep + 1) : "",
            isWrite: request.method !== "GET",
          });
        }
      }
      return handler(request, {
        userId: ctx.userId,
        agentTokenId: ctx.agentTokenId,
        apiKeyWorkspaceId: ctx.apiKeyWorkspaceId ?? null,
        credentialSubjectUserId: ctx.credentialSubjectUserId,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspacePublicId: workspace.publicId,
        workspaceKind: workspace.kind,
        role: membership.role,
        // ⚠ Header CLAIM bounded by the presenting credential: an agent token
        // can never buy the `desktop-ui` stamp (runtime-header.ts).
        runtime: narrowRuntime(readRuntimeHeader(request), {
          agentCredential: !!ctx.agentTokenId,
        }),
        appVersion: readAppVersionHeader(request),
        sessionId: readSessionIdHeader(request),
        params: ctx.params,
      });
    } catch (err) {
      if (err instanceof WorkspaceResolutionError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      throw err;
    }
  }, {
    writeScopeExempt: options.writeScopeExempt,
    sessionOnly: options.sessionOnly,
  });
}
