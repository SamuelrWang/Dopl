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
 * Both go through the feature-injected transport (`teamsRequest`), so a
 * refusal reaches the caller as an `Error` carrying the server's message.
 * `SegmentedControl` renders straight off the cached `accessMode`, so
 * patching the access-matrix cache IS the thumb moving on the click.
 */

export interface GrantDraft {
  teamId: string;
  resourceType: TeamResourceType;
  resourceId: string;
  /** `null` removes the grant. */
  level: AccessLevel | null;
  /** ⚠ Roster CAPTURED AT SUBMIT. A grant is what `memberAccessPath` resolves
   *  through, so changing one changes what every member of this team may
   *  reach — per-member cache entries this write cannot compute. Read from the
   *  team row at click time, never from the selection mid-PUT. */
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
    // Grants live on the TEAM row, so one patch moves the team detail's grant
    // boxes, the resource detail's per-team list and the "N team grants"
    // caption.
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
    // ⚠ TEAMS cache is NOT invalidated — the grant is fully computed above,
    // and invalidating re-downloads what this write just reconciled.
    invalidate: (draft) => [
      // ⚠ Every member of the team, always: `member-detail` reads a
      // per-member `…/members/<id>/access` entry only the server computes and
      // nothing else refreshes (the pane never unmounts). Per-member because
      // these keys are whole paths — TanStack matches per array element, so
      // `[…/members]` reaches no `[…/members/<id>/access]` entry.
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
    // Which grants still apply after a scope flip is not computable here — the
    // teams cache is the one this write cannot reconcile itself.
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
