/**
 * The teams API's CLIENT TRANSPORT — the error flattening, and the one write
 * that is not a cache patch.
 *
 * This used to be nine `await apiRequest(); refetch()` helpers, one per write,
 * and every one of them was the reason a members-console control produced no
 * pixel change until two network hops had finished. They now live as mutation
 * configs (`hooks/use-{member,team,access}-writes.ts`) over the shared layer,
 * and what stays here is the part that is genuinely transport, exported both
 * as a plain helper and as an `ApiMutationRequestFn`.
 *
 * There used to be a second job here: translating a 409
 * `TEAM_KB_ACCESS_CONFLICT` into a typed error a retry dialog could reopen
 * from. That status had exactly one producer — the workflow↔KB invariant —
 * and it went with workflows on 2026-08-11. No access write can 409 any more,
 * so the typed error, the `autoGrant` retry and the dialog are gone.
 *
 * `createTeam` stays a plain call on purpose: it is a CREATE with no row to
 * patch optimistically (the server mints the id, the members and the grants in
 * one POST) and its dialog closes onto a freshly-invalidated list.
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

/**
 * The same transport, shaped for `useApiMutationWith` — the feature-injected
 * client the mutation layer takes, exactly as channels injects `channelRequest`
 * so every write still throws `ChannelApiError`. Module-level so the reference
 * is stable across renders (the hook memoizes on it).
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
