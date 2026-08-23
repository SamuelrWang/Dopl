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
 * ⚠ EVERY PATCH IS BY THE PREFIX KEY (`agentTemplateKeys.list().all`). The list
 * is read once per workspace, but a writer cannot know which workspace variants
 * a reader has mounted, and TanStack matches by array prefix — so the prefix is
 * the key that reaches all of them.
 *
 * ⚠ CREATE HAS NO OPTIMISTIC ROW, DELIBERATELY. The server mints the id, and a
 * placeholder card would have to invent one; the POST answers with the created
 * template, so `reconcile` folds the real row in and NO refetch is needed
 * (INVARIANTS §8). `coldKeys` covers the one case reconcile cannot: a cache
 * entry that still holds nothing (cold start, or the IndexedDB restore window),
 * where a patch has nothing to patch and the new template would never reach the
 * screen.
 *
 * ⚠ DELETE IS HARD AND IS NOT A TOMBSTONE. The row leaves the cache on the
 * click; there is no archived variant of this list to move it into, so a single
 * prefix patch is the whole eviction.
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
      patchCache<TemplatesCache>(agentTemplateKeys.list().all, (cache) =>
        upsertRow(cache, data.template)
      ),
    invalidate: coldFallback,
  };
}

export function updateConfig(
  workspaceId: string
): UseApiMutationConfig<UpdateDraft, AgentTemplateResponse> {
  return {
    request: (draft) => ({
      path: agentTemplatePath(draft.templateId),
      method: "PATCH",
      body: draft.body,
      workspaceId,
    }),
    optimistic: (draft) =>
      patchCache<TemplatesCache>(agentTemplateKeys.list().all, (cache) =>
        upsertRow(cache, draft.optimistic)
      ),
    reconcile: (data) =>
      patchCache<TemplatesCache>(agentTemplateKeys.list().all, (cache) =>
        upsertRow(cache, data.template)
      ),
  };
}

export function deleteConfig(
  workspaceId: string
): UseApiMutationConfig<DeleteDraft, void> {
  return {
    request: (draft) => ({
      path: agentTemplatePath(draft.templateId),
      method: "DELETE",
      workspaceId,
    }),
    optimistic: (draft) =>
      patchCache<TemplatesCache>(agentTemplateKeys.list().all, (cache) =>
        dropRow(cache, draft.templateId)
      ),
  };
}

export interface AgentTemplateWrites {
  create: ApiMutation<CreateDraft, AgentTemplateResponse>;
  update: ApiMutation<UpdateDraft, AgentTemplateResponse>;
  remove: ApiMutation<DeleteDraft, void>;
}

export function useAgentTemplateWrites(workspaceId: string): AgentTemplateWrites {
  const client = useQueryClient();
  return {
    create: useApiMutationWith(
      agentTemplateRequest,
      createConfig(workspaceId, () => coldKeys(client, [agentTemplateKeys.list().all]))
    ),
    update: useApiMutationWith(agentTemplateRequest, updateConfig(workspaceId)),
    remove: useApiMutationWith(agentTemplateRequest, deleteConfig(workspaceId)),
  };
}
