import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { isStandardWorkspace, meetsMinRole, type Role, type WorkspaceKind } from "../types";
import { findMembership, findWorkspaceById } from "./repository";

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

/**
 * THE TWO-PERSON MODEL, ENFORCED SERVER-SIDE. A `kind='link'` home-channel
 * container's roster is exactly the pair the claim minted, forever — so every
 * path that could ADD a third member refuses here, not merely in a UI that
 * hides the button. A third member would read a private relationship's whole
 * transcript.
 *
 * ⚠ REMOVAL AND DEPARTURE STAY ALLOWED. The invariant is "no third party", not
 * "immutable" — a member who leaves takes the relationship with them, which is
 * the intended way one ends.
 *
 * ⚠ Absent `kind` = standard, through `isStandardWorkspace` and nothing else:
 * the column (migration 20260823150000) is written-not-applied, so today's rows
 * carry none and must behave exactly as they do now.
 */
export function assertMemberAddable(workspace: { kind?: WorkspaceKind }): void {
  if (isStandardWorkspace(workspace)) return;
  throw new HttpError(
    403,
    "LINK_CONTAINER_IMMUTABLE",
    "This is a two-person channel — nobody else can be added to it."
  );
}

/**
 * Same refusal for a caller holding only an id. ⚠ One bounded read, and a
 * MISSING workspace is not this guard's 404 to raise — the caller's own
 * membership gate already answered that question.
 */
export async function assertMemberAddableById(workspaceId: string): Promise<void> {
  const workspace = await findWorkspaceById(workspaceId);
  if (workspace) assertMemberAddable(workspace);
}
