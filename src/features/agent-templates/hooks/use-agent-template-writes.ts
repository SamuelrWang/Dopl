"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  coldKeys,
  patchCache,
  useApiMutationWith,
  type ApiMutation,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { agentTemplateRequest } from "../client/api";
import { agentTemplateKeys, agentTemplatePath, agentTemplatesPath } from "../client/query-keys";
import type { TemplateShelf } from "../client/types";
import type {
  AgentTemplate,
  AgentTemplateCreateBody,
  AgentTemplateListResponse,
  AgentTemplateResponse,
  AgentTemplateUpdateBody,
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
 *     workspace materialised that template in the OTHER workspace's list until a
 *     cold refetch;
 *   - the entry key is exactly reproducible here because `useAgentTemplates`
 *     passes `{workspaceId, select}` and no `query` — `[path, workspaceId,
 *     undefined]`. **Check that before copying this pattern**: a path that also
 *     has query-param variants needs both axes, and the prefix is the answer for
 *     the param axis (INVARIANTS §8).
 * `./use-agent-template-writes.test.ts` is the two-workspace pin.
 *
 * ⚠ CREATE HAS NO OPTIMISTIC ROW, DELIBERATELY. The server mints the id, and a
 * placeholder card would have to invent one; the POST answers with the created
 * template, so `reconcile` folds the real row in and NO refetch is needed
 * (INVARIANTS §8). `coldKeys` covers the one case reconcile cannot: a cache
 * entry that still holds nothing (cold start, or the IndexedDB restore window),
 * where a patch has nothing to patch and the new template would never reach the
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
type TemplatesCache = AgentTemplateListResponse;

export interface CreateDraft {
  body: AgentTemplateCreateBody;
}

export interface UpdateDraft {
  templateId: string;
  body: AgentTemplateUpdateBody;
  /** The row as it should read the moment the operator clicks Save. */
  optimistic: AgentTemplate;
}

export interface DeleteDraft {
  templateId: string;
}

/** Put the server's own row where the optimistic one was — or append it. */
function upsertRow(cache: TemplatesCache | undefined, row: AgentTemplate) {
  if (!cache) return cache;
  const exists = cache.templates.some((t) => t.id === row.id);
  return {
    ...cache,
    templates: exists
      ? cache.templates.map((t) => (t.id === row.id ? row : t))
      : [...cache.templates, row],
  };
}

function dropRow(cache: TemplatesCache | undefined, templateId: string) {
  if (!cache) return cache;
  return {
    ...cache,
    templates: cache.templates.filter((t) => t.id !== templateId),
  };
}

export function createConfig(
  workspaceId: string,
  shelf: TemplateShelf | undefined,
  coldFallback: () => ReturnType<typeof coldKeys>
): UseApiMutationConfig<CreateDraft, AgentTemplateResponse> {
  return {
    request: (draft) => ({
      path: agentTemplatesPath(),
      method: "POST",
      body: draft.body,
      workspaceId,
    }),
    reconcile: (data) =>
      patchCache<TemplatesCache>(agentTemplateKeys.list(shelf).entry({ workspaceId }), (cache) =>
        upsertRow(cache, data.template)
      ),
    invalidate: coldFallback,
  };
}

export function updateConfig(
  workspaceId: string,
  shelf: TemplateShelf | undefined
): UseApiMutationConfig<UpdateDraft, AgentTemplateResponse> {
  return {
    request: (draft) => ({
      path: agentTemplatePath(draft.templateId),
      method: "PATCH",
      body: draft.body,
      workspaceId,
    }),
    optimistic: (draft) =>
      patchCache<TemplatesCache>(agentTemplateKeys.list(shelf).entry({ workspaceId }), (cache) =>
        upsertRow(cache, draft.optimistic)
      ),
    reconcile: (data) =>
      patchCache<TemplatesCache>(agentTemplateKeys.list(shelf).entry({ workspaceId }), (cache) =>
        upsertRow(cache, data.template)
      ),
  };
}

export function deleteConfig(
  workspaceId: string,
  shelf: TemplateShelf | undefined
): UseApiMutationConfig<DeleteDraft, void> {
  return {
    request: (draft) => ({
      path: agentTemplatePath(draft.templateId),
      method: "DELETE",
      workspaceId,
    }),
    optimistic: (draft) =>
      patchCache<TemplatesCache>(agentTemplateKeys.list(shelf).entry({ workspaceId }), (cache) =>
        dropRow(cache, draft.templateId)
      ),
  };
}

export interface AgentTemplateWrites {
  create: ApiMutation<CreateDraft, AgentTemplateResponse>;
  update: ApiMutation<UpdateDraft, AgentTemplateResponse>;
  remove: ApiMutation<DeleteDraft, void>;
}

/**
 * @param shelf ⚠ MUST MATCH the `shelf` the surface's `useAgentTemplates` read
 *   was mounted with (`../client/query-keys.ts`). Every patch below addresses
 *   ONE entry; a mismatch patches a key nobody is subscribed to and the write
 *   silently does not appear — F-331's failure with the SHELF as the axis.
 *   `undefined` = the unfiltered list, which is what a link CONTAINER surface
 *   and the launch picker use.
 */
export function useAgentTemplateWrites(
  workspaceId: string,
  shelf?: TemplateShelf
): AgentTemplateWrites {
  const client = useQueryClient();
  const listEntry = agentTemplateKeys.list(shelf).entry({ workspaceId });
  return {
    create: useApiMutationWith(
      agentTemplateRequest,
      createConfig(workspaceId, shelf, () => coldKeys(client, [listEntry]))
    ),
    update: useApiMutationWith(
      agentTemplateRequest,
      updateConfig(workspaceId, shelf)
    ),
    remove: useApiMutationWith(
      agentTemplateRequest,
      deleteConfig(workspaceId, shelf)
    ),
  };
}
