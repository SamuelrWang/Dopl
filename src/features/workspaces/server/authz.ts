import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { meetsMinRole, type Role } from "../types";
import { findMembership } from "./repository";

/**
 * The single workspace role gate behind every service-layer permission check:
 * resolve the caller's active membership (⚠ 404 when absent, so membership
 * existence isn't leaked) and require `minRole` (403 below it). Returns the
 * caller's role for follow-up policy decisions. `minRole: "viewer"` = any
 * active member.
 */
export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  minRole: Role
): Promise<Role> {
  const membership = await findMembership(workspaceId, userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  if (!meetsMinRole(membership.role, minRole)) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      `Requires ${minRole} role or higher`
    );
  }
  return membership.role;
}
