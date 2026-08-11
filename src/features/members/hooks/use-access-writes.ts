"use client";

import {
  patchCache,
  useApiMutationWith,
  type ApiMutation,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import type { AccessLevel, TeamResourceType } from "@/features/teams/access-levels";
import type { AccessMode } from "@/features/teams/types";
import { accessMatrixPath, memberKeys, teamAccessPath } from "../client/query-keys";
import {
  setResourceMode,
  setTeamGrant,
  type ResourcesCache,
  type TeamsCache,
} from "../lib/optimistic-cache";
import { teamsRequest } from "../teams-client";

/**
 * The two ACCESS writes — one team's grant on one resource, and a resource's
 * workspace/teams scope — on the shared mutation layer.
 *
 * Both go through the FEATURE-INJECTED transport (`teamsRequest`), the same
 * composition channels uses for `channelRequest`, so a refusal reaches the
 * caller as an `Error` carrying the server's message. (This is also where the
 * `TEAM_KB_ACCESS_CONFLICT` 409 used to be translated into a retryable typed
 * error — that status had one producer, the workflow↔KB invariant, and it went
 * with workflows on 2026-08-11.)
 *
 * The scope toggle is the launch audit's "segmented control doesn't move":
 * `SegmentedControl` is driven straight off the cached `accessMode`, so
 * patching the access-matrix cache IS the thumb moving on the click.
 */

export interface GrantDraft {
  teamId: string;
  resourceType: TeamResourceType;
  resourceId: string;
  /** `null` removes the grant. */
  level: AccessLevel | null;
  /**
   * The team's roster CAPTURED AT SUBMIT (rule 4). A grant is the thing
   * `memberAccessPath` resolves through, so changing one changes what every
   * member of this team is told they can reach — and those panes are per-member
   * cache entries this write cannot compute. Read from the team row at the
   * click, never from the selection while the PUT is in flight.
   */
  memberIds: string[];
}

export interface ResourceScopeDraft {
  resourceType: TeamResourceType;
  resourceId: string;
  accessMode: AccessMode;
}

export function setGrantConfig(
  workspaceSlug: string
): UseApiMutationConfig<GrantDraft, unknown> {
  const teamsKey = memberKeys.teams(workspaceSlug).all;
  return {
    request: (draft) => ({
      path: teamAccessPath(workspaceSlug, draft.teamId),
      method: "PUT",
      body: {
        resourceType: draft.resourceType,
        resourceId: draft.resourceId,
        level: draft.level,
      },
    }),
    // Grants live on the TEAM row, so this one patch moves both surfaces that
    // render a level: the team detail's grant boxes and the resource detail's
    // per-team list. The Access tab's "N team grants" caption is derived from
    // the same array and follows without a second patch.
    optimistic: (draft) =>
      patchCache<TeamsCache>(teamsKey, (cache) =>
        setTeamGrant(
          cache,
          draft.teamId,
          draft.resourceType,
          draft.resourceId,
          draft.level
        )
      ),
    // The TEAMS cache is NOT invalidated: the grant is fully computed above and
    // invalidating it would re-download the cache this write just reconciled.
    // (It used to be, on the `autoGrant` retry, because that asked the SERVER
    // to write grants on OTHER teams — that path went with workflows.)
    invalidate: (draft) => [
      // Every member of the team, always. `member-detail` reads a per-member
      // `…/members/<id>/access` entry that ONLY the server computes and nothing
      // else refreshes — the pane does not unmount — so a grant changed here
      // would otherwise leave "Reports KB · via Growth" sitting under a level
      // that no longer exists. Per-member because these keys are whole paths:
      // TanStack matches per array element, so `[…/members]` reaches no
      // `[…/members/<id>/access]` entry and there is no prefix that could.
      ...draft.memberIds.map(
        (userId) => memberKeys.memberAccess(workspaceSlug, userId).all
      ),
    ],
  };
}

export function setResourceScopeConfig(
  workspaceSlug: string
): UseApiMutationConfig<ResourceScopeDraft, unknown> {
  return {
    request: (draft) => ({
      path: accessMatrixPath(workspaceSlug),
      method: "PUT",
      body: {
        resourceType: draft.resourceType,
        resourceId: draft.resourceId,
        accessMode: draft.accessMode,
      },
    }),
    optimistic: (draft) =>
      patchCache<ResourcesCache>(
        memberKeys.accessMatrix(workspaceSlug).all,
        (cache) =>
          setResourceMode(
            cache,
            draft.resourceType,
            draft.resourceId,
            draft.accessMode
          )
      ),
    // Flipping a resource between scopes changes which grants still apply, and
    // that is not computable here — the teams cache is the one this write may
    // not reconcile itself.
    invalidate: () => [memberKeys.teams(workspaceSlug).all],
  };
}

export interface AccessWrites {
  setGrant: ApiMutation<GrantDraft, unknown>;
  setScope: ApiMutation<ResourceScopeDraft, unknown>;
  pending: boolean;
}

export function useAccessWrites(workspaceSlug: string): AccessWrites {
  const setGrant = useApiMutationWith(teamsRequest, setGrantConfig(workspaceSlug));
  const setScope = useApiMutationWith(
    teamsRequest,
    setResourceScopeConfig(workspaceSlug)
  );
  return { setGrant, setScope, pending: setGrant.pending || setScope.pending };
}
