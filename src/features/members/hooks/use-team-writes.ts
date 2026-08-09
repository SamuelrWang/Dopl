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
 * TEAM identity and TEAM MEMBERSHIP writes on the shared mutation layer.
 *
 * The rename is the one worth naming: it commits on blur, and the name it
 * commits is read back by three places at once — the crumb bar, the left list
 * row, and the header input's own reset effect. All three read the roster/teams
 * CACHE, so patching that cache is what makes a rename land everywhere in the
 * same frame instead of reverting to the old name for a round trip.
 *
 * Membership drafts carry the whole `TeamView` captured AT SUBMIT rather than
 * an id, because the roster's team chips need the team's name/colour/icon to
 * render, and re-reading them from the current selection is the race the
 * mutation layer's fourth rule exists to prevent.
 */

export interface TeamPatchDraft {
  teamId: string;
  /** Only the fields being committed; the patch is applied over the cached row. */
  patch: { name?: string; description?: string | null };
}

export interface TeamDeleteDraft {
  teamId: string;
  /**
   * The team's roster CAPTURED AT SUBMIT (rule 4) — the row is gone from the
   * cache the moment the optimistic patch runs, so the ids cannot be looked up
   * afterwards. Deleting a team deletes the grants it carried, which is what
   * `memberAccessPath` resolves through for each of these members.
   */
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

/**
 * Every touched member's resolved-access pane, which only the server computes.
 * One key per member because these keys are whole PATHS: TanStack matches keys
 * per array element, so `[…/members]` reaches no `[…/members/<id>/access]`
 * entry — there is no prefix that covers them and the ids have to be named.
 */
function accessKeys(workspaceSlug: string, userIds: string[]): QueryKey[] {
  return userIds.map(
    (userId) => memberKeys.memberAccess(workspaceSlug, userId).all
  );
}

/**
 * Exported so the write-config suite can drive the SHIPPED config through
 * TanStack's own `MutationObserver` rather than a copy of it — a re-declared
 * config passes while the real one is wrong.
 */
export function teamDeleteConfig(
  workspaceSlug: string
): UseApiMutationConfig<TeamDeleteDraft, unknown> {
  return {
    request: (draft) => ({
      path: teamPath(workspaceSlug, draft.teamId),
      method: "DELETE",
    }),
    // The team row AND every roster chip pointing at it go together: a chip
    // left behind is the console asserting membership of a team that no longer
    // exists, and the paired snapshot restores both if the DELETE fails.
    optimistic: (draft) => [
      patchCache<TeamsCache>(memberKeys.teams(workspaceSlug).all, (cache) =>
        dropTeam(cache, draft.teamId)
      ),
      patchCache<MembersCache>(memberKeys.members(workspaceSlug).all, (cache) =>
        dropTeamRef(cache, draft.teamId)
      ),
    ],
    // Deleting the team destroys its grants, so what the server resolves for
    // each of its members changes — and that pane is the one surface here that
    // no client can recompute.
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
    // One id per call — the endpoint is a per-member DELETE, and the UI only
    // ever removes one at a time (each behind its own confirm).
    request: (draft) => {
      const [userId] = draft.userIds;
      // An empty draft would otherwise DELETE `…/members/undefined`, which is
      // a request the server gets to interpret. Thrown from `request`, so it
      // rejects inside the mutation and the layer rolls the optimistic patch
      // back on the same path a refused DELETE takes.
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
