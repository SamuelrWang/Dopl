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
 * (`X-Workspace-Id` header, falling back to the user's default workspace)
 * and verify the caller's membership + role. Injects `{ workspaceId,
 * workspaceSlug, role }` alongside the standard `{ userId, apiKeyId }`.
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
    try {
      const { workspace, membership } = await resolveActiveWorkspace(
        ctx.userId,
        headerWorkspaceId
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
