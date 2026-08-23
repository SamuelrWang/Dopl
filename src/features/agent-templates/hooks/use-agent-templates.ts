"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { MOCK_AGENT_TEMPLATES } from "../client/mock";
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
  /** ⚠ DEV MOCK — see below. True means NOTHING on this page came from the
   *  server, and the page says so out loud. */
  isMockData: boolean;
}

/**
 * ⚠⚠ DEV MOCK FALLBACK (2026-08-23) — TEMPORARY, DELETE WITH `../client/mock.ts` ⚠⚠
 *
 * `supabase/migrations/20260822200000_agent_templates.sql` is not applied yet, so
 * this read 500s on a missing relation and the Agents page has nothing to draw.
 * When — and ONLY when — this is a DEV BUILD **and** the request FAILED and no
 * answer is cached, the hook substitutes hardcoded fixtures so the surface can
 * be reviewed.
 *
 * ⚠ A PRODUCTION BUILD CAN NEVER TAKE THIS BRANCH. The first line is a
 * BUILD-TIME constant in both bundlers that compile this module — Next/webpack
 * and Vite each statically replace `process.env.NODE_ENV`, so a production build
 * compiles the guard to `if ("production" === "production") return false` and
 * drops the rest. A real outage in production therefore renders EXACTLY the
 * plain error state it rendered before this file existed. Pinned by
 * `./use-agent-templates.test.ts › never in a production build`.
 *
 * ⚠ `process.env.NODE_ENV`, **NOT** `import.meta.env.DEV`. This module is shared:
 * the desktop SPA bundles it through vite (where `import.meta.env` exists) and
 * the web tree compiles it through Next (where it does not, and the root
 * tsconfig carries no `vite/client` types, so it would not even typecheck).
 * `process.env.NODE_ENV` is the one dev flag both halves understand — the same
 * one `@/features/auth/hooks/use-login.ts` tests against.
 *
 * ⚠ THE SECOND GATE IS "THE FETCH FAILED", NOT "THE LIST IS EMPTY". A successful
 * `[]` is a real answer and must keep rendering the three real empty states — an
 * empty-list fallback would make "you have no templates" unreachable forever,
 * which is the INVARIANTS §11 defect (UNKNOWN is not EMPTY) written backwards.
 *
 * ⚠ `error` IS STILL RETURNED, and the page still shows its alert. The mock
 * rows sit UNDER the failure line plus a "Sample data" note, never instead of
 * them: a page that swallowed the error to show pretty fixtures is a page that
 * lies about the state of the system.
 *
 * ⚠ `query.data === undefined` keeps a real (even stale) answer winning over the
 * fixtures on a refetch that failed.
 */
function isMockFallback(query: {
  error: unknown;
  data: AgentTemplate[] | undefined;
}): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return query.error != null && query.data === undefined;
}

export function useAgentTemplates(workspaceId: string): UseAgentTemplatesResult {
  const query = useApiQuery<AgentTemplateListResponse, AgentTemplate[]>(
    agentTemplateKeys.list().path,
    { workspaceId, select: selectTemplates }
  );
  const isMockData = isMockFallback(query);
  return {
    templates: isMockData ? MOCK_AGENT_TEMPLATES : (query.data ?? []),
    loading: query.isPending,
    error: query.error,
    refetch: query.refetch,
    isMockData,
  };
}
