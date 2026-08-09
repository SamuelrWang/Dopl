/**
 * The teams API's CLIENT TRANSPORT — the 409 translation, and the one write
 * that is not a cache patch.
 *
 * This used to be nine `await apiRequest(); refetch()` helpers, one per write,
 * and every one of them was the reason a members-console control produced no
 * pixel change until two network hops had finished. They now live as mutation
 * configs (`hooks/use-{member,team,access}-writes.ts`) over the shared layer,
 * and what stays here is the part that is genuinely transport: turning a 409
 * `TEAM_KB_ACCESS_CONFLICT` into a typed error the ConflictDialog can retry
 * from, exported both as a plain helper and as an `ApiMutationRequestFn`.
 *
 * `createTeam` stays a plain call on purpose: it is a CREATE with no row to
 * patch optimistically (the server mints the id, the members and the grants in
 * one POST) and its dialog closes onto a freshly-invalidated list.
 */

import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import type { ApiMutationRequestFn } from "@/shared/hooks/use-api-mutation";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { KbTeamConflict, TeamView } from "@/features/teams/types";
import { teamsPath } from "./client/query-keys";

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

type TeamsRequestOpts = Pick<
  ApiRequestOpts,
  "method" | "body" | "workspaceId" | "query" | "expectedUpdatedAt"
>;

async function request<T>(url: string, init?: TeamsRequestOpts): Promise<T> {
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

/**
 * The same transport, shaped for `useApiMutationWith` — the feature-injected
 * client the mutation layer takes, exactly as channels injects `channelRequest`
 * so every write still throws `ChannelApiError`.
 *
 * The injection is what keeps the 409 retry alive through the conversion: an
 * access write that hits `TEAM_KB_ACCESS_CONFLICT` must reach the caller as a
 * `TeamAccessConflictError` carrying `details`, or the ConflictDialog's
 * "grant read access?" retry has nothing to open with. Module-level so the
 * reference is stable across renders (the hook memoizes on it).
 */
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
  autoGrant?: boolean;
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
