/** View models for the members page. The source-of-truth tables
 *  (`workspace_members`, `workspace_invitations`) belong to the workspaces
 *  feature, whose role/status types are re-exported to keep one definition;
 *  these are the hydrated shapes the API returns. */

import type { Role, InvitedRole, MembershipStatus } from "@/features/workspaces/types";
import type { MemberTeamRef } from "@/features/teams/types";

export type MemberRole = Role;
export type AssignableRole = InvitedRole;
export type MemberStatus = MembershipStatus;

export interface WorkspaceMemberView {
  workspaceId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
  invitedBy: string | null;
  invitedAt: string | null;
  /** Throttled activity timestamp (bumped at most every ~5 min). */
  lastSeenAt: string | null;
  /** Hydrated from auth.users — null if lookup fails. */
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** Teams the member belongs to (chips on the members table). */
  teams: MemberTeamRef[];
}

/** One pending join-link request. ⚠ Declared here, not in
 *  `hooks/use-join-requests.ts` (which re-exports it): the optimistic cache
 *  module patches this row and must not import a hook — the hook imports the
 *  cache module. */
export interface JoinRequestView {
  id: string;
  userId: string;
  requestedAt: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceInvitationView {
  id: string;
  workspaceId: string;
  email: string;
  invitedRole: AssignableRole;
  invitedBy: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Teams the invitee auto-joins on accept. */
  teamIds?: string[];
}
