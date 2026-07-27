"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { AgentTrustRule } from "../types";

const selectRules = (body: { rules: AgentTrustRule[] }) => body.rules ?? [];

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_RULES: AgentTrustRule[] = [];

/**
 * The caller's standing trust rules for the workspace. `agent_trust_rules` is
 * intentionally NOT in the realtime publication (a personal, low-churn list),
 * so this refetches on demand after an add / remove rather than subscribing.
 */
export function useTrustRules(workspaceId: string | null | undefined) {
  const query = useApiQuery<{ rules: AgentTrustRule[] }, AgentTrustRule[]>(
    workspaceId ? "/api/channels/trust" : null,
    { workspaceId: workspaceId ?? undefined, select: selectRules }
  );
  const rules = query.data ?? NO_RULES;
  // Memoized: the view derives its trust lens from this set, so a fresh Set per
  // render would defeat that memo on every unrelated re-render.
  const trustedIds = useMemo(
    () => new Set(rules.map((r) => r.trustedUserId)),
    [rules]
  );

  return { rules, trustedIds, refetch: query.refetch };
}
