"use client";

import type { QueryKey } from "@tanstack/react-query";
import {
  patchCache,
  useApiMutation,
  type ApiMutation,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import type { TeamView } from "@/features/teams/types";
import {
  memberKeys,
  teamMemberPath,
  teamMembersPath,
  teamPath,
} from "../client/query-keys";
import {
  dropTeam,
  dropTeamRef,
  patchTeam,
  setMemberTeamRef,
  setTeamMembers,
  type MembersCache,
  type TeamsCache,
} from "../lib/optimistic-cache";

/**
 * Team identity + team membership writes on the shared mutation layer.
 * Rename commits on blur and is read back by the crumb bar, the list row and
 * the header input's reset effect — all three read the teams CACHE.
 * ⚠ Membership drafts carry the whole `TeamView` captured AT SUBMIT, not an
 * id: roster chips need name/colour/icon, and re-reading them from the
 * current selection is the in-flight-selection race.
 */

export interface TeamPatchDraft {
  teamId: string;
  /** Only the fields being committed; applied over the cached row. */
  patch: { name?: string; description?: string | null };
}

export interface TeamDeleteDraft {
  teamId: string;
  /** ⚠ Roster CAPTURED AT SUBMIT — the row leaves the cache the moment the
   *  optimistic patch runs, so the ids can't be looked up afterwards. Deleting
   *  a team deletes its grants, which `memberAccessPath` resolves through. */
  memberIds: string[];
}

export interface TeamMembershipDraft {
  team: TeamView;
  userIds: string[];
}

export interface TeamWrites {
  update: ApiMutation<TeamPatchDraft, unknown>;
  remove: ApiMutation<TeamDeleteDraft, unknown>;
  addMembers: ApiMutation<TeamMembershipDraft, unknown>;
  removeMembers: ApiMutation<TeamMembershipDraft, unknown>;
  /** True while any of the four writes is in flight. */
  pending: boolean;
}

/** Every touched member's server-computed access pane. ⚠ One key per member:
 *  these keys are whole PATHS and TanStack matches per array element, so
 *  `[…/members]` reaches no `[…/members/<id>/access]` entry. */
function accessKeys(workspaceSlug: string, userIds: string[]): QueryKey[] {
  return userIds.map(
    (userId) => memberKeys.memberAccess(workspaceSlug, userId).all
  );
}

/** Exported so the write-config suite drives the SHIPPED config through
 *  `MutationObserver` — a re-declared copy passes while the real one is
 *  wrong. */
export function teamDeleteConfig(
  workspaceSlug: string
): UseApiMutationConfig<TeamDeleteDraft, unknown> {
  return {
    request: (draft) => ({
      path: teamPath(workspaceSlug, draft.teamId),
      method: "DELETE",
    }),
    // ⚠ Team row and every roster chip pointing at it go together — a leftover
    // chip asserts membership of a team that no longer exists. Paired snapshot
    // restores both if the DELETE fails.
    optimistic: (draft) => [
      patchCache<TeamsCache>(memberKeys.teams(workspaceSlug).all, (cache) =>
        dropTeam(cache, draft.teamId)
      ),
      patchCache<MembersCache>(memberKeys.members(workspaceSlug).all, (cache) =>
        dropTeamRef(cache, draft.teamId)
      ),
    ],
    // Deleting the team destroys its grants, changing what the server resolves
    // for each member — the one surface no client can recompute.
    invalidate: (draft) => accessKeys(workspaceSlug, draft.memberIds),
  };
}

export function useTeamWrites(workspaceSlug: string): TeamWrites {
  const teamsKey = memberKeys.teams(workspaceSlug).all;
  const membersKey = memberKeys.members(workspaceSlug).all;

  const update = useApiMutation<TeamPatchDraft, unknown>({
    request: (draft) => ({
      path: teamPath(workspaceSlug, draft.teamId),
      method: "PATCH",
      body: draft.patch,
    }),
    optimistic: (draft) =>
      patchCache<TeamsCache>(teamsKey, (cache) =>
        patchTeam(cache, draft.teamId, draft.patch)
      ),
  });

  const remove = useApiMutation<TeamDeleteDraft, unknown>(
    teamDeleteConfig(workspaceSlug)
  );

  const addMembers = useApiMutation<TeamMembershipDraft, unknown>({
    request: (draft) => ({
      path: teamMembersPath(workspaceSlug, draft.team.id),
      method: "POST",
      body: { userIds: draft.userIds },
    }),
    optimistic: (draft) => [
      patchCache<TeamsCache>(teamsKey, (cache) =>
        setTeamMembers(cache, draft.team.id, draft.userIds, true)
      ),
      patchCache<MembersCache>(membersKey, (cache) =>
        setMemberTeamRef(cache, draft.userIds, draft.team, true)
      ),
    ],
    invalidate: (draft) => accessKeys(workspaceSlug, draft.userIds),
  });

  const removeMembers = useApiMutation<TeamMembershipDraft, unknown>({
    // One id per call: the endpoint is a per-member DELETE.
    request: (draft) => {
      const [userId] = draft.userIds;
      // ⚠ Empty draft would DELETE `…/members/undefined`. Thrown from
      // `request` so the layer rolls the optimistic patch back exactly as a
      // refused DELETE would.
      if (!userId) throw new Error("Removing a member needs one member id");
      return {
        path: teamMemberPath(workspaceSlug, draft.team.id, userId),
        method: "DELETE" as const,
      };
    },
    optimistic: (draft) => [
      patchCache<TeamsCache>(teamsKey, (cache) =>
        setTeamMembers(cache, draft.team.id, draft.userIds, false)
      ),
      patchCache<MembersCache>(membersKey, (cache) =>
        setMemberTeamRef(cache, draft.userIds, draft.team, false)
      ),
    ],
    invalidate: (draft) => accessKeys(workspaceSlug, draft.userIds),
  });

  return {
    update,
    remove,
    addMembers,
    removeMembers,
    pending:
      update.pending ||
      remove.pending ||
      addMembers.pending ||
      removeMembers.pending,
  };
}
