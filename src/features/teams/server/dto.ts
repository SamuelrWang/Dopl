import "server-only";
import type { AccessLevel, TeamResourceType } from "../access-levels";
import type { Team, TeamGrant, TeamMemberRow } from "../types";

export interface TeamRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMemberDbRow {
  team_id: string;
  user_id: string;
  added_by: string | null;
  added_at: string;
}

export interface TeamGrantDbRow {
  team_id: string;
  resource_type: TeamResourceType;
  resource_id: string;
  level: AccessLevel;
}

export function mapTeamRow(row: TeamRow): Team {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTeamMemberRow(row: TeamMemberDbRow): TeamMemberRow {
  return {
    teamId: row.team_id,
    userId: row.user_id,
    addedBy: row.added_by,
    addedAt: row.added_at,
  };
}

export function mapTeamGrantRow(row: TeamGrantDbRow): TeamGrant {
  return {
    teamId: row.team_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    level: row.level,
  };
}
