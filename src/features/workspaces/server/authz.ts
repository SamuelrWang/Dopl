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
 * THE CAP, ENFORCED SERVER-SIDE. A `kind='link'` home-channel container holds
 * at most TWO members, so every WORKSPACE-level path that could add one refuses
 * here — invitations, join links, direct member-add — not merely in a UI that
 * hides the button. A third member would read a private relationship's whole
 * transcript.
 *
 * ⚠ RENAMED FROM `LINK_CONTAINER_IMMUTABLE` (2026-08-25). The old name asserted
 * that a container's roster never changes, and since the channel-first inversion
 * that is FALSE: a container starts with ONE member and gains its second when a
 * BOUND link is claimed. What survives the rename is the reason the guard exists
 * — not "frozen", but "closed to everybody except the one admitted path".
 *
 * ⚠ THE BOUND CLAIM DOES NOT ROUTE THROUGH HERE, AND THAT IS THE DESIGN.
 * `home/server/service-claim-bound.ts › claimBoundLink` writes the member row
 * directly, having proved possession of a single-use token bound to that exact
 * container. This guard covers the WORKSPACE surfaces, which have no such proof
 * and must never become a second door into a private relationship. **The hard
 * fence under both is the database** — `enforce_link_container_member_cap`
 * (migration 20260824120000) — so an admitted path cannot exceed the cap either.
 *
 * ⚠ REMOVAL AND DEPARTURE STAY ALLOWED, unchanged. A member who leaves drops the
 * container back to ONE member, which is now an ordinary state rather than a
 * broken one; the survivor can mint a fresh link and invite somebody else.
 *
 * ⚠ Absent `kind` = standard, through `isStandardWorkspace` and nothing else.
 * The column (migration 20260823150000) APPLIED 2026-08-24 and is NOT NULL
 * DEFAULT 'standard', so live rows carry it — the default survives for the rows
 * that omit it: a narrowed projection, an older server, a test fixture.
 */
export function assertMemberAddable(workspace: { kind?: WorkspaceKind }): void {
  if (isStandardWorkspace(workspace)) return;
  throw new HttpError(
    403,
    "LINK_CONTAINER_CLOSED",
    "This is a private home channel — people join it by its own invite link."
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
