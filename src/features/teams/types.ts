/**
 * Teams feature — named member groups inside a workspace that carry
 * resource access grants for knowledge bases and workflows.
 *
 * Scoping model: a resource's `access_mode` is either 'workspace'
 * (every active member, level by role default) or 'teams' (only teams
 * with a grant row; owner/admin and the creator always retain edit).
 */

import type {
  AccessLevel,
  AccessMode,
  TeamResourceType,
} from "./access-levels";

export type { AccessLevel, AccessMode, TeamResourceType };

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamGrant {
  teamId: string;
  resourceType: TeamResourceType;
  resourceId: string;
  level: AccessLevel;
}

export interface TeamMemberRow {
  teamId: string;
  userId: string;
  addedBy: string | null;
  addedAt: string;
}

/** List-view shape: team + member preview + grants in one payload. */
export interface TeamView extends Team {
  memberCount: number;
  memberIds: string[];
  grants: TeamGrant[];
}

/** Lightweight reference attached to member rows (chips). */
export interface MemberTeamRef {
  teamId: string;
  name: string;
  color: string | null;
  icon: string | null;
}

/** A teams-mode resource with the caller's resolved level (null = hidden). */
export interface TeamsModeResourceAccess {
  resourceType: TeamResourceType;
  resourceId: string;
  level: AccessLevel | null;
}

/**
 * Batch access-resolution result for one user in one workspace.
 * `workspace`-mode resources never appear in `teamsModeResources` —
 * their level is always `defaultLevel`. A teams-mode resource that is
 * absent from the array (or has level null) is invisible to the user.
 */
export interface EffectiveAccessResult {
  defaultLevel: AccessLevel;
  isAdmin: boolean;
  teamsModeResources: TeamsModeResourceAccess[];
}

/** One conflicting KB in a workflow↔KB invariant violation (409 payload). */
export interface KbTeamConflict {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  /** Teams in the workflow's audience that lack read on this KB. */
  teams: Array<{ teamId: string; teamName: string }>;
  /** True when the workflow is workspace-mode (audience = everyone) — autoGrant can't fix it. */
  audienceIsAllMembers: boolean;
}

/** Resource descriptor for the access matrix tab. */
export interface AccessMatrixResource {
  resourceType: TeamResourceType;
  resourceId: string;
  name: string;
  accessMode: AccessMode;
  createdBy: string | null;
}

export interface AccessMatrix {
  teams: TeamView[];
  resources: AccessMatrixResource[];
}
