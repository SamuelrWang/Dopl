/**
 * Client-side fetch helpers for the teams + members APIs. Team mutations
 * throw `TeamAccessConflictError` on 409 TEAM_KB_ACCESS_CONFLICT so
 * callers can offer the "grant read access?" retry with `autoGrant: true`.
 */

import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { KbTeamConflict, TeamView } from "@/features/teams/types";
import type { AssignableRole } from "./types";

export interface TeamConflictDetails {
  workflowId: string;
  workflowName: string;
  conflicts: KbTeamConflict[];
  autoGrantResolvable: boolean;
}

export class TeamAccessConflictError extends Error {
  readonly details: TeamConflictDetails;
  constructor(message: string, details: TeamConflictDetails) {
    super(message);
    this.name = "TeamAccessConflictError";
    this.details = details;
  }
}

async function request<T>(
  url: string,
  init?: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown }
): Promise<T> {
  try {
    return await apiRequest<T>(url, init);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 409 && err.code === "TEAM_KB_ACCESS_CONFLICT") {
        throw new TeamAccessConflictError(
          err.message || "Team access conflict",
          err.details as TeamConflictDetails
        );
      }
      // Callers catch generic Error and surface .message.
      throw new Error(err.message || "Request failed");
    }
    throw err;
  }
}

const ws = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}`;

export interface CreateTeamInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  memberIds?: string[];
  grants?: Array<{
    resourceType: TeamResourceType;
    resourceId: string;
    level: AccessLevel;
  }>;
  autoGrant?: boolean;
}

export async function createTeam(
  slug: string,
  input: CreateTeamInput
): Promise<TeamView> {
  const body = await request<{ team: TeamView }>(`${ws(slug)}/teams`, {
    method: "POST",
    body: input,
  });
  return body.team;
}

export async function updateTeam(
  slug: string,
  teamId: string,
  patch: {
    name?: string;
    description?: string | null;
    color?: string | null;
    icon?: string | null;
  }
): Promise<void> {
  await request(`${ws(slug)}/teams/${encodeURIComponent(teamId)}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function deleteTeam(slug: string, teamId: string): Promise<void> {
  await request(`${ws(slug)}/teams/${encodeURIComponent(teamId)}`, {
    method: "DELETE",
  });
}

export async function addTeamMembers(
  slug: string,
  teamId: string,
  userIds: string[]
): Promise<void> {
  await request(`${ws(slug)}/teams/${encodeURIComponent(teamId)}/members`, {
    method: "POST",
    body: { userIds },
  });
}

export async function removeTeamMember(
  slug: string,
  teamId: string,
  userId: string
): Promise<void> {
  await request(
    `${ws(slug)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
}

/** `level: null` removes the grant. May throw TeamAccessConflictError. */
export async function setTeamGrant(
  slug: string,
  teamId: string,
  resourceType: TeamResourceType,
  resourceId: string,
  level: AccessLevel | null,
  opts?: { autoGrant?: boolean }
): Promise<void> {
  await request(`${ws(slug)}/teams/${encodeURIComponent(teamId)}/access`, {
    method: "PUT",
    body: ({
      resourceType,
      resourceId,
      level,
      autoGrant: opts?.autoGrant,
    }),
  });
}

/** Flip a resource between workspace-wide and teams-scoped access. */
export async function setResourceAccessMode(
  slug: string,
  resourceType: TeamResourceType,
  resourceId: string,
  accessMode: "workspace" | "teams",
  opts?: { autoGrant?: boolean }
): Promise<void> {
  await request(`${ws(slug)}/access-matrix`, {
    method: "PUT",
    body: ({
      resourceType,
      resourceId,
      accessMode,
      autoGrant: opts?.autoGrant,
    }),
  });
}

// ── Member mutations (role change + removal) ─────────────────────────

export async function updateMemberRole(
  slug: string,
  userId: string,
  role: AssignableRole
): Promise<void> {
  await request(`${ws(slug)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: { role },
  });
}

export async function removeMember(slug: string, userId: string): Promise<void> {
  await request(`${ws(slug)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}
