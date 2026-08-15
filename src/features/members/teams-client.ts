/**
 * Teams API client transport: error flattening, plus the one write that is
 * not a cache patch. Every other write is a mutation config in
 * `hooks/use-{member,team,access}-writes.ts`.
 * `createTeam` stays a plain call on purpose — a CREATE with no row to patch
 * optimistically (server mints id, members and grants in one POST), whose
 * dialog closes onto a freshly-invalidated list.
 */

import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import type { ApiMutationRequestFn } from "@/shared/hooks/use-api-mutation";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { TeamView } from "@/features/teams/types";
import { teamsPath } from "./client/query-keys";

type TeamsRequestOpts = Pick<
  ApiRequestOpts,
  "method" | "body" | "workspaceId" | "query" | "expectedUpdatedAt"
>;

async function request<T>(url: string, init?: TeamsRequestOpts): Promise<T> {
  try {
    return await apiRequest<T>(url, init);
  } catch (err) {
    if (err instanceof ApiError) {
      // Callers catch generic Error and surface .message.
      throw new Error(err.message || "Request failed");
    }
    throw err;
  }
}

/** Same transport shaped for `useApiMutationWith`. ⚠ Module-level so the
 *  reference is stable across renders — the hook memoizes on it. */
export const teamsRequest: ApiMutationRequestFn = <T,>(
  path: string,
  opts?: TeamsRequestOpts
): Promise<T> => request<T>(path, opts);

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
}

export async function createTeam(
  slug: string,
  input: CreateTeamInput
): Promise<TeamView> {
  const body = await request<{ team: TeamView }>(teamsPath(slug), {
    method: "POST",
    body: input,
  });
  return body.team;
}
