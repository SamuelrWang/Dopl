import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import type { Role } from "@/features/workspaces/types";
import { meetsMinRole } from "@/features/workspaces/types";
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
  params?: Record<string, string>;
}

interface Options {
  /**
   * Minimum membership role required to call this route. Defaults to
   * "viewer" — any active member can access. Use "member" for writes,
   * "admin" for invitations / settings, "owner" for delete.
   */
  minRole?: Role;
}

/**
 * Composes `withUserAuth` to additionally resolve the active workspace
 * and verify the caller's membership + role. Injects `{ workspaceId,
 * workspaceSlug, role }` alongside the standard `{ userId, agentTokenId }`.
 *
 * Workspace resolution priority (Item 4 update):
 *   1. If the API key has a `workspace_id` (workspace-scoped key), use it.
 *      The header MUST agree with it or we 403 — prevents a single key
 *      from being used cross-workspace by accident or design.
 *   2. Else `X-Workspace-Id` header.
 *   3. Else fall back to the user's default workspace.
 *
 * Routes that scope per-workspace should use this in place of
 * `withUserAuth`. Routes that operate user-globally (settings, billing,
 * the global entry KB, admin) keep `withUserAuth`.
 *
 * MCP / paid-gating policy (audit decision #8) — withWorkspaceAuth
 * intentionally does NOT call `withMcpAccess`. The reasoning:
 *   - Unlike the read-only Dopl knowledge packs (`kb_list_packs` /
 *     `kb_list` / `kb_get` use `withMcpAccess` to gate by trial/paid
 *     status), the user's OWN workspace + knowledge bases are first-
 *     class data the user creates — gating them behind a paywall would
 *     hold their content hostage.
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
    const keyWorkspaceId = ctx.apiKeyWorkspaceId ?? null;

    // Workspace-scoped API key: enforce the lock. Reject if the header
    // contradicts. Use the key's workspace as the active one.
    let effectiveWorkspaceId = headerWorkspaceId;
    if (keyWorkspaceId) {
      if (headerWorkspaceId && headerWorkspaceId !== keyWorkspaceId) {
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
      return handler(request, {
        userId: ctx.userId,
        agentTokenId: ctx.agentTokenId,
        apiKeyWorkspaceId: ctx.apiKeyWorkspaceId ?? null,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspacePublicId: workspace.publicId,
        role: membership.role,
        params: ctx.params,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      throw err;
    }
  });
}
