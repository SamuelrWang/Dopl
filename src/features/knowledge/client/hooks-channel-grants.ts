"use client";

/**
 * The scope-A (KB, channel) grant read + write, client side.
 *
 * ⚠ HAND-ROLLED, not `useApiMutation` — the same reason `hooks.ts ›
 * useToggleBaseStar` is. INVARIANTS §8 rule 6 requires the READ to be on
 * `useApiQuery` first, and knowledge reads sit under `["knowledge", key]` keys
 * that `apiQueryKey` never mints, so the write layer would patch an
 * unsubscribed key and fail SILENTLY. Its rules still apply and are followed
 * below: cancel before patching and only with data (2); MERGE, leaving every
 * sibling map on the base-list entry untouched (5); no blanket invalidation,
 * because the surfaces that render grants are warm by construction (1); the
 * keys come from the ids captured AT SUBMIT (4). Rollback restores the
 * SNAPSHOT, never the inverse write — an inverse is wrong if a refetch landed
 * in between.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { coldKeys } from "@/shared/hooks/use-api-mutation";
import type {
  ChannelGrantLevelInput,
  ChannelResourceGrant,
} from "@/features/knowledge/types";
import {
  fetchChannelGrants,
  setChannelGrant,
  type ChannelGrantSettings,
  type KnowledgeBaseList,
} from "./api";
import { knowledgeBasesCacheSegment, knowledgeBasesQueryKey } from "./hooks";

/** The settings section's own entry: one KB, every channel it reaches. */
export function knowledgeChannelGrantsQueryKey(
  workspaceId: string | undefined,
  baseId: string
) {
  return ["knowledge", `grants:${workspaceId ?? "default"}:${baseId}`] as const;
}

/**
 * The grants section's read. Disabled until a base id exists.
 *
 * ⚠ `canManage` comes off the SERVER, not off a role the client re-derives —
 * the same answer the write gate applies, so the editor cannot render for
 * somebody the PUT will refuse.
 */
export function useChannelGrantSettings(
  baseId: string,
  workspaceId?: string
) {
  const query = useQuery({
    queryKey: knowledgeChannelGrantsQueryKey(workspaceId, baseId),
    queryFn: () => fetchChannelGrants(baseId, workspaceId),
  });
  return {
    data: query.data ?? null,
    loading: query.isPending,
    error: query.error ? (query.error as Error).message : null,
  };
}

/**
 * Apply ONE grant change to every cached surface that renders grants.
 *
 * TWO SHAPES, ONE FACT, and the map keys differ between them:
 *  - the SETTINGS entry is `{channelId → grant}` for one base;
 *  - each CHANNEL-SCOPED BASE LIST entry is `{baseId → grant}` for one channel.
 *
 * ⚠ `null` REMOVES THE KEY rather than storing a level. Absence is the third
 * state everywhere — storage, wire and cache — so a `{level:"none"}` here would
 * be a fourth state that only the client believes in.
 *
 * ⚠ THE BASE-LIST HALF MATCHES BY PREFIX. Its segment is minted by
 * `knowledgeBasesCacheSegment(ws, channelId)`, and a surface may extend that
 * segment further; an exact-key patch would silently miss those entries and the
 * grid would keep rendering the old level until a refetch. The UNSCOPED base
 * list is deliberately NOT patched — it carries no `channelGrants` at all
 * (absent param ⇒ absent key, §9), and writing one there would invent a
 * channel-scoped payload nobody asked for.
 */
export function patchChannelGrantInCache(
  client: QueryClient,
  args: {
    workspaceId?: string;
    baseId: string;
    channelId: string;
    grant: ChannelResourceGrant | null;
  }
): void {
  const { workspaceId, baseId, channelId, grant } = args;

  client.setQueryData<ChannelGrantSettings>(
    knowledgeChannelGrantsQueryKey(workspaceId, baseId),
    (prev) => (prev ? { ...prev, grants: withGrant(prev.grants, channelId, grant) } : prev)
  );

  const target = knowledgeBasesCacheSegment(workspaceId, channelId);
  for (const [key, data] of client.getQueriesData<KnowledgeBaseList>({
    queryKey: ["knowledge"],
  })) {
    const segment = key[1];
    if (typeof segment !== "string") continue;
    if (segment !== target && !segment.startsWith(`${target}:`)) continue;
    if (!data) continue;
    client.setQueryData<KnowledgeBaseList>(key, (prev) =>
      prev
        ? { ...prev, channelGrants: withGrant(prev.channelGrants, baseId, grant) }
        : prev
    );
  }
}

function withGrant(
  map: Record<string, ChannelResourceGrant>,
  key: string,
  grant: ChannelResourceGrant | null
): Record<string, ChannelResourceGrant> {
  const next = { ...map };
  if (grant) next[key] = grant;
  else delete next[key];
  return next;
}

/**
 * Set one (KB, channel) grant, patching the cache from the SERVER'S answer.
 *
 * ⚠ THE PATCH IS APPLIED ON SUCCESS, NOT OPTIMISTICALLY, and that is the point:
 * the server normalises the write (`guestWrite` is forced false at
 * `agent_only`), so an optimistic patch would paint a state the row never took
 * and then quietly disagree with the next refetch. The snapshot is still taken
 * so a failure restores exactly what was on screen.
 *
 * ⚠ `coldKeys` NAMES THE `?channelId=` VARIANT (§8's one exception to "no
 * invalidation"): the patch above declines on an entry with no data, so a
 * grant set from the workspace settings modal before the /home panel has ever
 * loaded its channel-scoped list would land server-side and never reach that
 * surface. `coldKeys` runs after the patch, so "still empty" IS the decline and
 * a warm cache re-downloads nothing.
 */
export function useSetChannelGrant(baseId: string, workspaceId?: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      channelId: string;
      level: ChannelGrantLevelInput;
      guestWrite: boolean;
    }) => setChannelGrant(baseId, vars, workspaceId),
    onMutate: () => ({
      previous: client.getQueryData<ChannelGrantSettings>(
        knowledgeChannelGrantsQueryKey(workspaceId, baseId)
      ),
    }),
    onSuccess: (grant, vars) => {
      patchChannelGrantInCache(client, {
        workspaceId,
        baseId,
        channelId: vars.channelId,
        grant,
      });
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        client.setQueryData(
          knowledgeChannelGrantsQueryKey(workspaceId, baseId),
          context.previous
        );
      }
    },
    onSettled: (_data, _err, vars) => {
      for (const key of coldKeys(client, [
        knowledgeBasesQueryKey(workspaceId, vars.channelId),
      ])) {
        void client.invalidateQueries({ queryKey: key, exact: true });
      }
    },
  });
}
