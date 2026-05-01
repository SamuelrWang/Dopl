import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { resolveActiveWorkspace } from "@/features/workspaces/server/service";
import type { Role } from "@/features/workspaces/types";
import { meetsMinRole } from "@/features/workspaces/types";
import { withUserAuth } from "./with-auth";

export interface WorkspaceAuthContext {
  userId: string;
  apiKeyId?: string;
  workspaceId: string;
  workspaceSlug: string;
  role: Role;
  params?: Record<string, string>;
}

interface Options {
  /**
   * Minimum membership role required to call this route. Defaults to
   * "viewer" — any active member can access. Use "editor" for writes,
   * "admin" for invitations / settings, "owner" for delete.
   */
  minRole?: Role;
}

/**
 * Composes `withUserAuth` to additionally resolve the active workspace
 * and verify the caller's membership + role. Injects `{ workspaceId,
 * workspaceSlug, role }` alongside the standard `{ userId, apiKeyId }`.
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
        apiKeyId: ctx.apiKeyId,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
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
