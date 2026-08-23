"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { agentTemplateKeys } from "../client/query-keys";
import type { AgentTemplate, AgentTemplateListResponse } from "../client/types";

/**
 * THE list read behind the Agents page — every template the caller may see, in
 * one request, grouped client-side by `visibility` (`../lib/visibility.ts`).
 *
 * ⚠ ONE READ FOR THREE PANELS, not one per scope. The server already filters by
 * what the caller can see, so three scoped requests would be three chances for
 * the panels to disagree about a template that moved between them mid-load.
 *
 * ⚠ `select` IS MODULE-LEVEL. A fresh arrow per render makes TanStack re-run the
 * projection every time and hands every consumer a new array identity, which
 * re-renders the whole grid on any unrelated state change.
 */

const selectTemplates = (body: AgentTemplateListResponse) => body.templates ?? [];

export interface UseAgentTemplatesResult {
  templates: AgentTemplate[];
  loading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useAgentTemplates(workspaceId: string): UseAgentTemplatesResult {
  const query = useApiQuery<AgentTemplateListResponse, AgentTemplate[]>(
    agentTemplateKeys.list().path,
    { workspaceId, select: selectTemplates }
  );
  return {
    templates: query.data ?? [],
    loading: query.isPending,
    error: query.error,
    refetch: query.refetch,
  };
}
