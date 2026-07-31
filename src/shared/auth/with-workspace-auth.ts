import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import {
  resolveActiveWorkspace,
  WorkspaceResolutionError,
} from "@/features/workspaces/server/service";
import type { Role } from "@/features/workspaces/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { logMcpToolCall } from "@/features/analytics/server/mcp-tool-calls";
import { readRuntimeHeader, type DoplRuntime } from "./runtime-header";
import { withUserAuth } from "./with-auth";

export interface WorkspaceAuthContext {
  userId: string;
  agentTokenId?: string;
  /**
   * If the request is authenticated via a workspace-scoped API key
   * (`api_keys.workspace_id IS NOT NULL`), this is the workspace it's
   * locked to. `null` for session callers and user-scoped (personal)
   * API keys. Service layer reads this to enforce M-10's "private
   * items are hidden from workspace-scoped keys" rule — those keys
   * may be shared across humans (CI runners, service accounts), so
   * leaking a teammate's private content through them is unsafe.
   */
  apiKeyWorkspaceId?: string | null;
  workspaceId: string;
  workspaceSlug: string;
  workspacePublicId: string;
  role: Role;
  /**
   * The recognized `X-Dopl-Runtime` this request carried (`desktop-session`),
   * or undefined for every other caller. Reaches handlers the same way
   * `X-Workspace-Id` does — read once here, never off the raw request in a
   * feature — so the channels write path has ONE trusted source for the
   * reserved `metadata.runtime` stamp. A routing hint, never an authz signal
   * (see `runtime-header.ts`).
   */
  runtime?: DoplRuntime;
  params?: Record<string, string>;
}

interface Options {
  /**
   * Minimum membership role required to call this route. Defaults to
   * "viewer" — any active member can access. Use "member" for writes,
   * "admin" for invitations / settings, "owner" for delete.
   */
  minRole?: Role;
  /**
   * Opt-in for GET download routes (`<a download>` can't send headers): let
   * the `?workspaceId=` query param participate in workspace resolution at
   * the SAME priority as the `X-Workspace-Id` header. The key lock still
   * wins over both; the header wins over the query param when both are
   * present. Used by the export routes so a fail-closed resolution doesn't
   * 400 a header-less download before the param is read.
   */
  workspaceIdFromQuery?: boolean;
  /**
   * H-3 — forwarded verbatim into the inner `withUserAuth`. `writeScopeExempt`
   * exempts a non-content-write, non-GET route from the OAuth write-scope gate
   * (only the MCP liveness ping). `sessionOnly` refuses ALL OAuth agent tokens
   * (any scope) on the destructive admin surface — billing mutations set this.
   * Both affect OAuth-bearer callers only; session (cookie) callers are never
   * gated. See `UserAuthOptions`.
   */
  writeScopeExempt?: boolean;
  sessionOnly?: boolean;
}

/**
 * Composes `withUserAuth` to additionally resolve the active workspace
 * and verify the caller's membership + role. Injects `{ workspaceId,
 * workspaceSlug, role }` alongside the standard `{ userId, agentTokenId }`.
 *
 * Workspace resolution priority (MCP-2 — fail-closed, no default fallback):
 *   1. If the API key has a `workspace_id` (workspace-scoped key), use it.
 *      The requested target MUST agree with it or we 403 — prevents a
 *      single key from being used cross-workspace by accident or design.
 *   2. Else `X-Workspace-Id` header (UUID only; blank/non-UUID → 400
 *      WORKSPACE_INVALID). With `workspaceIdFromQuery`, a `?workspaceId=`
 *      param slots in at the same priority (header wins if both present).
 *   3. Else the caller's active memberships decide: exactly one auto-targets;
 *      zero or 2+ → 400 WORKSPACE_REQUIRED (see `resolveActiveWorkspace`).
 *
 * Routes that scope per-workspace should use this in place of
 * `withUserAuth`. Routes that operate user-globally (settings, billing,
 * the global entry KB, admin) keep `withUserAuth`.
 *
 * MCP / paid-gating policy (audit decision #8) — withWorkspaceAuth
 * intentionally does NOT call `withMcpAccess`. The reasoning:
 *   - The user's OWN workspace + knowledge bases are first-class data
 *     the user creates — gating them behind a paywall would hold their
 *     content hostage.
 *   - The agent-write toggle (`agent_write_enabled` per knowledge base)
 *     is the per-resource gate that protects against unwanted MCP
 *     mutations. Read access for an agent stays free; writes require
 *     the user to flip the toggle in settings.
 *   - Rate-limit + analytics for MCP traffic still happen at the
 *     `withUserAuth` layer (the wrapper inside `withWorkspaceAuth`),
 *     so we don't lose observability.
 *
 * If a future product decision requires gating user-data MCP calls,
 * compose `withMcpAccess` inside the handler signature instead of
 * altering this default.
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
    // The header wins over the query param when both are present; the key
    // lock (below) wins over both. `??` keeps a present-but-blank header
    // authoritative so it still fails closed as WORKSPACE_INVALID.
    const requestedWorkspaceId = headerWorkspaceId ?? queryWorkspaceId;
    const keyWorkspaceId = ctx.apiKeyWorkspaceId ?? null;

    // Workspace-scoped API key: enforce the lock. Reject if the requested
    // target contradicts. Use the key's workspace as the active one.
    let effectiveWorkspaceId = requestedWorkspaceId;
    if (keyWorkspaceId) {
      // Trim before the lock compare so a header/query value padded with
      // whitespace doesn't read as a spurious cross-workspace mismatch.
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
      // Per-op MCP usage instrumentation. Agent (OAuth-token) callers only —
      // the loopback sends a granular `X-MCP-Tool` header ("kb_write_file",
      // "ontology_create_object", ...). Split on the first "_" into tool +
      // op; is_write is the reliable HTTP-method signal. Fire-and-forget.
      if (ctx.agentTokenId) {
        const mcpTool = request.headers.get("x-mcp-tool");
        if (mcpTool) {
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
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspacePublicId: workspace.publicId,
        role: membership.role,
        runtime: readRuntimeHeader(request),
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
