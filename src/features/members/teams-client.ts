/**
 * Client-side fetch helpers for the teams API. Mutations throw
 * `TeamAccessConflictError` on 409 TEAM_KB_ACCESS_CONFLICT so callers
 * can offer the "grant read access?" retry with `autoGrant: true`.
 */

import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { KbTeamConflict, TeamView } from "@/features/teams/types";

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error;
    if (res.status === 409 && err?.code === "TEAM_KB_ACCESS_CONFLICT") {
      throw new TeamAccessConflictError(
        err.message ?? "Team access conflict",
        err.details as TeamConflictDetails
      );
    }
    throw new Error(err?.message || err || "Request failed");
  }
  return body as T;
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
    body: JSON.stringify(input),
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
    body: JSON.stringify(patch),
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
    body: JSON.stringify({ userIds }),
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
    body: JSON.stringify({
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
    body: JSON.stringify({
      resourceType,
      resourceId,
      accessMode,
      autoGrant: opts?.autoGrant,
    }),
  });
}
