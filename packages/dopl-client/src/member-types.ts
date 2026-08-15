/**
 * Members / teams / access types — read-only mirrors of
 * `src/features/members/types.ts` and `src/features/teams/types.ts`.
 *
 * ⚠ `resourceType` is a plain string on purpose: the grant table grows new
 * resource kinds and keeps retired ones, and a read client must render an
 * unknown kind, not reject it.
 */

import type { WorkspaceRole, WorkspaceSummary } from "./types.js";

export type MembershipStatus = "pending" | "active" | "revoked";

export type MemberAccessLevel = "read" | "edit";

export interface MemberTeamRef {
  teamId: string;
  name: string;
  color: string | null;
  icon: string | null;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  status: MembershipStatus;
  joinedAt: string;
  invitedBy: string | null;
  invitedAt: string | null;
  lastSeenAt: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  teams: MemberTeamRef[];
}

export interface TeamGrant {
  teamId: string;
  resourceType: string;
  resourceId: string;
  level: MemberAccessLevel;
}

export interface WorkspaceTeam {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  memberIds: string[];
  grants: TeamGrant[];
}

export interface AccessMatrixResource {
  resourceType: string;
  resourceId: string;
  name: string;
  /** 'workspace' = every member at role default; 'teams' = granted teams only. */
  accessMode: "workspace" | "teams";
  createdBy: string | null;
}

export interface AccessMatrix {
  teams: WorkspaceTeam[];
  resources: AccessMatrixResource[];
}

export interface MyAccess {
  defaultLevel: MemberAccessLevel;
  overrides: Array<{
    resourceType: string;
    resourceId: string;
    level: MemberAccessLevel;
  }>;
}

export interface EffectiveAccessRow {
  resourceType: string;
  resourceId: string;
  resourceName: string;
  /** null = resource hidden from this member. */
  level: MemberAccessLevel | null;
  /** Team supplying the winning level; null for role-derived access. */
  viaTeam: { teamId: string; name: string; color: string | null } | null;
}

export interface MyMembership {
  workspace: WorkspaceSummary;
  role: WorkspaceRole;
  /** Present only on servers that expose it. */
  userId: string | null;
}
