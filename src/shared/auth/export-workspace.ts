import "server-only";
import type { NextRequest } from "next/server";
import { requireWorkspaceRole } from "@/features/workspaces/server/authz";
import type { Role } from "@/features/workspaces/types";
import type { WorkspaceAuthContext } from "./with-workspace-auth";

/**
 * Resolve the workspace an export DOWNLOAD should read from. A plain
 * `<a download>` link can't send the `X-Workspace-Id` header, so these GET
 * download routes accept a `?workspaceId=` query param instead. When it names
 * a workspace other than the auth-resolved (default) one, the caller's
 * membership + role is verified via `requireWorkspaceRole` before it's
 * honored — the param is never trusted on its own.
 *
 * Scoped to export routes on purpose: the header stays the norm everywhere
 * else and `withWorkspaceAuth` is unchanged. Returns the effective workspace
 * id plus the caller's role IN that workspace (so the service context gates
 * visibility with the right role, not the default workspace's).
 */
export async function resolveExportWorkspace(
  request: NextRequest,
  auth: WorkspaceAuthContext,
  minRole: Role = "viewer"
): Promise<{ workspaceId: string; role: Role }> {
  const requested = request.nextUrl.searchParams.get("workspaceId");
  if (!requested || requested === auth.workspaceId) {
    return { workspaceId: auth.workspaceId, role: auth.role };
  }
  const role = await requireWorkspaceRole(requested, auth.userId, minRole);
  return { workspaceId: requested, role };
}
