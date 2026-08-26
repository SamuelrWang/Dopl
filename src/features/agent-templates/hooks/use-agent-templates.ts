"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { agentTemplateKeys } from "../client/query-keys";
import type { AgentTemplate, AgentTemplateListResponse } from "../client/types";

/**
 * THE list read behind every agent-template surface — every template the caller
 * may see in one request, grouped client-side by `visibility`
 * (`../lib/visibility.ts`).
 *
 * ⚠ ONE READ FOR THREE PANELS, not one per scope. The server already filters by
 * what the caller can see, so three scoped requests would be three chances for
 * the panels to disagree about a template that moved between them mid-load.
 *
 * ⚠ ONE READ **PER WORKSPACE**, and a surface may mount TWO of them (the /home
 * Agents tab reads a channel container and the home workspace side by side).
 * The cache entry is `[path, workspaceId, undefined]` — no caller passes a
 * `query`, so that tuple is exactly reproducible, and the writes patch that
 * ENTRY key rather than the path prefix (`./use-agent-template-writes.ts`,
 * F-331). **If a `query` variant is ever added on this path, that pairing has
 * to be revisited on BOTH sides in the same change.**
 *
 * ⚠ `select` IS MODULE-LEVEL. A fresh arrow per render makes TanStack re-run the
 * projection every time and hands every consumer a new array identity, which
 * re-renders the whole grid on any unrelated state change.
 *
 * ⚠ A FAILED READ IS A FAILED READ — it renders `[]` plus the `error` the
 * surface prints, and NOTHING is substituted for it. A dev-only fixture
 * fallback lived here until 2026-08-26 (F-332, ✅ RESOLVED): it was written
 * while `agent_templates` was unapplied, the migration is applied
 * (INVARIANTS §5A/§12), and on a link CONTAINER a 403/404 is a NORMAL answer —
 * so the fallback had turned into a dev build painting fabricated templates
 * under a channel that has none. **Do not reintroduce one.** UNKNOWN is not
 * EMPTY and it is not a GUESS either (INVARIANTS §11).
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
