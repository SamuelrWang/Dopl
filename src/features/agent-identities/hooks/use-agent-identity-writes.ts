"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  coldKeys,
  patchCache,
  useApiMutationWith,
  type ApiMutation,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { AgentIdentityApiError, agentIdentityRequest } from "../client/api";
import { agentIdentityKeys, agentIdentityPath, agentIdentitiesPath } from "../client/query-keys";
import type { IdentityShelf } from "../client/types";
import type {
  AgentIdentity,
  AgentIdentityCreateBody,
  AgentIdentityListResponse,
  AgentIdentityResponse,
  AgentIdentityUpdateBody,
} from "../client/types";

/**
 * THE THREE WRITES behind the Agents page — create, update, delete — on the
 * shared mutation layer (INVARIANTS §8). Never `await write(); await refetch()`:
 * that shape is what this hook exists to close.
 *
 * 🔴 **EVERY PATCH IS BY THE `entry({workspaceId})` KEY, NEVER THE `.all`
 * PREFIX — F-331, ✅ RESOLVED, and this comment is what stops a tidy-up putting
 * the prefix back.** Until 2026-08-26 all three configs patched
 * the `.all` key, i.e. the one-element PATH key, and TanStack
 * matches by array PREFIX — so every patch reached EVERY WORKSPACE VARIANT of
 * this list. That is harmless on a surface that mounts one workspace, and it is
 * a cross-tenant display bug the moment a surface mounts two: the /home Agents
 * tab reads a channel CONTAINER and the home workspace side by side.
 *   - create/update `upsertRow` APPENDS when the id is absent, so a write in one
 *     workspace materialised that identity in the OTHER workspace's list until a
 *     cold refetch;
 *   - the entry key is exactly reproducible here because `useAgentIdentities`
 *     passes `{workspaceId, select}` and no `query` — `[path, workspaceId,
 *     undefined]`. **Check that before copying this pattern**: a path that also
 *     has query-param variants needs both axes, and the prefix is the answer for
 *     the param axis (INVARIANTS §8).
 * `./use-agent-identity-writes.test.ts` is the two-workspace pin.
 *
 * ⚠ CREATE HAS NO OPTIMISTIC ROW, DELIBERATELY. The server mints the id, and a
 * placeholder card would have to invent one; the POST answers with the created
 * identity, so `reconcile` folds the real row in and NO refetch is needed
 * (INVARIANTS §8). `coldKeys` covers the one case reconcile cannot: a cache
 * entry that still holds nothing (cold start, or the IndexedDB restore window),
 * where a patch has nothing to patch and the new identity would never reach the
 * screen. ⚠ **IT TAKES THE ENTRY KEY FOR THE SAME REASON THE PATCHES DO** — over
 * the prefix, `coldKeys` asks "does ANY variant of this path hold data", so one
 * warm workspace beside a cold one answers "warm" and the cold list never
 * refetches the row that was just created in it.
 *
 * ⚠ DELETE IS HARD AND IS NOT A TOMBSTONE. The row leaves the cache on the
 * click; there is no archived variant of this list to move it into, so a single
 * patch is the whole eviction.
 */

/** The list cache as it sits on disk — the RAW response body, not the selection. */
type IdentitiesCache = AgentIdentityListResponse;

export interface CreateDraft {
  body: AgentIdentityCreateBody;
}

export interface UpdateDraft {
  identityId: string;
  body: AgentIdentityUpdateBody;
  /** The row as it should read the moment the operator clicks Save. */
  optimistic: AgentIdentity;
  /**
   * 🔒 The `X-Updated-At` precondition — the `updatedAt` of the row the editor
   * was OPENED on (F-747). Absent = last-writer-wins, which is the shape this
   * page had until 2026-09-18 and is kept only so a host that has no version
   * to give still saves.
   */
  expectedUpdatedAt?: string;
}

export interface DeleteDraft {
  identityId: string;
}

/** Put the server's own row where the optimistic one was — or append it. */
function upsertRow(cache: IdentitiesCache | undefined, row: AgentIdentity) {
  if (!cache) return cache;
  const exists = cache.identities.some((t) => t.id === row.id);
  return {
    ...cache,
    identities: exists
      ? cache.identities.map((t) => (t.id === row.id ? row : t))
      : [...cache.identities, row],
  };
}

function dropRow(cache: IdentitiesCache | undefined, identityId: string) {
  if (!cache) return cache;
  return {
    ...cache,
    identities: cache.identities.filter((t) => t.id !== identityId),
  };
}

export function createConfig(
  workspaceId: string,
  shelf: IdentityShelf | undefined,
  coldFallback: () => ReturnType<typeof coldKeys>
): UseApiMutationConfig<CreateDraft, AgentIdentityResponse> {
  return {
    request: (draft) => ({
      path: agentIdentitiesPath(),
      method: "POST",
      body: draft.body,
      workspaceId,
    }),
    reconcile: (data) =>
      patchCache<IdentitiesCache>(agentIdentityKeys.list(shelf).entry({ workspaceId }), (cache) =>
        upsertRow(cache, data.identity)
      ),
    invalidate: coldFallback,
  };
}

export function updateConfig(
  workspaceId: string,
  shelf: IdentityShelf | undefined
): UseApiMutationConfig<UpdateDraft, AgentIdentityResponse> {
  return {
    request: (draft) => ({
      path: agentIdentityPath(draft.identityId),
      method: "PATCH",
      body: draft.body,
      workspaceId,
      expectedUpdatedAt: draft.expectedUpdatedAt,
    }),
    optimistic: (draft) =>
      patchCache<IdentitiesCache>(agentIdentityKeys.list(shelf).entry({ workspaceId }), (cache) =>
        upsertRow(cache, draft.optimistic)
      ),
    reconcile: (data) =>
      patchCache<IdentitiesCache>(agentIdentityKeys.list(shelf).entry({ workspaceId }), (cache) =>
        upsertRow(cache, data.identity)
      ),
  };
}

export function deleteConfig(
  workspaceId: string,
  shelf: IdentityShelf | undefined
): UseApiMutationConfig<DeleteDraft, void> {
  return {
    request: (draft) => ({
      path: agentIdentityPath(draft.identityId),
      method: "DELETE",
      workspaceId,
    }),
    optimistic: (draft) =>
      patchCache<IdentitiesCache>(agentIdentityKeys.list(shelf).entry({ workspaceId }), (cache) =>
        dropRow(cache, draft.identityId)
      ),
  };
}

export interface AgentIdentityWrites {
  create: ApiMutation<CreateDraft, AgentIdentityResponse>;
  update: ApiMutation<UpdateDraft, AgentIdentityResponse>;
  remove: ApiMutation<DeleteDraft, void>;
}

/**
 * @param shelf ⚠ MUST MATCH the `shelf` the surface's `useAgentIdentities` read
 *   was mounted with (`../client/query-keys.ts`). Every patch below addresses
 *   ONE entry; a mismatch patches a key nobody is subscribed to and the write
 *   silently does not appear — F-331's failure with the SHELF as the axis.
 *   `undefined` = the unfiltered list, which is what a link CONTAINER surface
 *   and the launch picker use.
 */
export function useAgentIdentityWrites(
  workspaceId: string,
  shelf?: IdentityShelf
): AgentIdentityWrites {
  const client = useQueryClient();
  const listEntry = agentIdentityKeys.list(shelf).entry({ workspaceId });
  return {
    create: useApiMutationWith(
      agentIdentityRequest,
      createConfig(workspaceId, shelf, () => coldKeys(client, [listEntry]))
    ),
    update: useApiMutationWith(agentIdentityRequest, {
      ...updateConfig(workspaceId, shelf),
      // 🔒 **THE 412 REFETCH (F-747), AND IT LIVES HERE BECAUSE THE CLIENT DOES.**
      // The optimistic patch has already rolled back by now, so the cache holds
      // the version that just LOST the race; without this the operator reopens
      // the same stale row and the next Save 412s again. ⚠ Only on 412 — every
      // other failure leaves the list alone, which is what `reconcile` is for.
      onError: (error) => {
        if (
          error instanceof AgentIdentityApiError &&
          error.status === 412
        ) {
          void client.invalidateQueries({ queryKey: listEntry });
        }
      },
    }),
    remove: useApiMutationWith(
      agentIdentityRequest,
      deleteConfig(workspaceId, shelf)
    ),
  };
}
