"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { useApiMutation } from "@/shared/hooks/use-api-mutation";
import { apiPathKey } from "@/shared/api/query-keys";
import type { EffectiveAccessRow } from "@/features/teams/effective-access";
import type { ActivityEventRow } from "../../activity-visibility";
import {
  memberAccessPath,
  memberActivityPath,
  memberKeys,
} from "../../client/query-keys";

/** ⚠ A retired-type filter stood here until 2026-09-02 (F-466); `resource_grants`
 *  refuses the value, so the rows are the rows. */
const selectAccess = (body: { rows: EffectiveAccessRow[] }) => body.rows ?? [];

/**
 * One member's server-resolved effective access.
 *
 * ⚠ `enabled` is the gate that keeps a peer from FETCHING what they may not
 * see. The route refuses them anyway (404), but not asking is the point.
 */
export function useMemberAccess(
  workspaceSlug: string,
  userId: string,
  enabled: boolean
) {
  const query = useApiQuery(memberAccessPath(workspaceSlug, userId), {
    select: selectAccess,
    enabled,
  });
  return {
    rows: enabled ? (query.data ?? null) : null,
    loading: query.isPending,
    error: query.error,
    retry: query.refetch,
  };
}

const selectActivity = (body: { events: ActivityEventRow[] }) => body.events ?? [];

/** One member's activity, already filtered by the caller's access server-side. */
export function useMemberActivity(workspaceSlug: string, userId: string) {
  const query = useApiQuery(memberActivityPath(workspaceSlug, userId), {
    select: selectActivity,
  });
  return {
    events: query.data ?? null,
    loading: query.isPending,
    error: query.error,
    retry: query.refetch,
  };
}

const PROFILE_PATH = "/api/user/profile";

export interface MyProfile {
  display_name: string | null;
  bio: string | null;
}

/**
 * The signed-in user's editable profile fields.
 *
 * ⚠ RETURNS NULL WHEN DISABLED. TanStack keeps `data` populated after `enabled`
 * goes false, so reading `query.data` straight through would hand a PEER view
 * the viewer's own bio from cache. The gate has to be on the read, not only on
 * the fetch.
 */
export function useMyProfile(enabled: boolean) {
  const query = useApiQuery<MyProfile>(PROFILE_PATH, { enabled });
  return { profile: enabled ? (query.data ?? null) : null };
}

/** Self-service profile write. Patches the roster too: `display_name` is what
 *  the members list and the detail header render. */
export function useProfileWrites(workspaceSlug: string) {
  return useApiMutation<Partial<MyProfile>, MyProfile>({
    request: (fields) => ({
      path: PROFILE_PATH,
      method: "PATCH",
      body: fields,
    }),
    invalidate: () => [
      apiPathKey(PROFILE_PATH),
      memberKeys.members(workspaceSlug).all,
    ],
  });
}
