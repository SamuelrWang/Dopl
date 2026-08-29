"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { agentTemplateKeys, templateListQuery } from "../client/query-keys";
import type {
  AgentTemplate,
  AgentTemplateListResponse,
  TemplateShelf,
} from "../client/types";

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

/** Shared frozen empty list. ⚠ NOT a fresh `[]` per render: every consumer
 *  `useMemo`s a grouping over `templates`, and a new array identity each render
 *  re-runs all of them (and re-renders every grid) while a read is in flight. */
const EMPTY_TEMPLATES: readonly AgentTemplate[] = Object.freeze([]);

export interface UseAgentTemplatesOptions {
  /**
   * Pause the read. Defaults to TRUE — a surface that mounts this hook usually
   * means to fetch. The /home Agents face passes `false` for the home-workspace
   * list until the scope pill asks for it, so a reader who never opens the
   * dropdown pays for one workspace, not two.
   */
  enabled?: boolean;
  /**
   * WHICH SHELF (`../types.ts › TemplateShelf`) — the /home Personal section
   * passes `"home"`, the workspace Agents page `"workspace"`, and the launch
   * picker omits it to get BOTH.
   *
   * 🔒 ⚠ IT KEYS THE CACHE ENTRY AS WELL AS THE REQUEST, and the WRITES hook
   * must be given the SAME value — see `../client/query-keys.ts`. A read on
   * `[path, ws, {shelf:"home"}]` patched by a writer on `[path, ws, undefined]`
   * is F-331 with a new axis: silent, and visible only as a created row that
   * never appears.
   * ⚠ Omitting it WIDENS. There is no client-side fallback filter; `home_scoped`
   * is never projected.
   */
  shelf?: TemplateShelf;
}

export interface UseAgentTemplatesResult {
  /** ⚠ `readonly`, so the shared empty fallback below cannot be sorted or
   *  spliced by a consumer into every other consumer's list. */
  templates: readonly AgentTemplate[];
  loading: boolean;
  /**
   * Has this read ANSWERED? ⚠ `templates.length === 0` cannot tell you: a
   * disabled, in-flight or failed read is also empty, and a surface that states
   * "there is nothing here" against one is asserting something nobody has
   * measured (INVARIANTS §11). Gate every empty sentence on THIS.
   *
   * ⚠ NOT `!loading` either — TanStack reports a DISABLED query as `pending`
   * forever, so `loading` is false only after data lands and stays true for a
   * scope nobody has asked for.
   */
  resolved: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * @param workspaceId Which workspace's templates. ⚠ `null` = THERE IS NO
 *   WORKSPACE TO ASK (no channel selected; a caller who is not onboarded yet, so
 *   `POST /api/boot` answered `workspace: null`). The read is disabled and
 *   `resolved` stays false — the surface must say "unavailable", never "empty".
 */
export function useAgentTemplates(
  workspaceId: string | null,
  opts: UseAgentTemplatesOptions = {}
): UseAgentTemplatesResult {
  const query = useApiQuery<AgentTemplateListResponse, AgentTemplate[]>(
    agentTemplateKeys.list(opts.shelf).path,
    {
      workspaceId: workspaceId ?? undefined,
      // ⚠ ONE MINTER for the param and the key's third element — spelling the
      // object here would be the second place it is decided.
      query: templateListQuery(opts.shelf),
      select: selectTemplates,
      enabled: workspaceId !== null && (opts.enabled ?? true),
    }
  );
  return {
    templates: query.data ?? EMPTY_TEMPLATES,
    loading: query.isPending,
    resolved: query.data !== undefined,
    error: query.error,
    refetch: query.refetch,
  };
}
