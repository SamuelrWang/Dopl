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
 * The identity writes on the shared mutation layer (INVARIANTS §8). Every patch addresses the
 * `entry({workspaceId})` key, never the `.all` prefix — a surface mounts two workspaces' lists (F-331).
 * Create has no optimistic row (the server mints the id); `coldKeys` covers a still-empty cache entry.
 */

/** The list cache as it sits on disk — the raw response body, not the selection. */
type IdentitiesCache = AgentIdentityListResponse;

export interface CreateDraft {
  body: AgentIdentityCreateBody;
}

export interface UpdateDraft {
  identityId: string;
  body: AgentIdentityUpdateBody;
  /** The row as it should read the moment the operator clicks Save. */
  optimistic: AgentIdentity;
  /** `X-Updated-At`: the version the editor was opened on (F-747); absent = last writer wins. */
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

/** @param shelf Must match the surface's `useAgentIdentities` shelf, or every patch misses (F-331). */
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
      // On a 412 the cache holds the losing version; refetch so a reopen shows the current row (F-747).
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
