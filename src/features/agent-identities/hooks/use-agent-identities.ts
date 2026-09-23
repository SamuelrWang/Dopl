"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { agentIdentityKeys, identityListQuery } from "../client/query-keys";
import type {
  AgentIdentity,
  AgentIdentityListResponse,
  IdentityShelf,
} from "../client/types";

/**
 * The list read behind every identity surface: one read per workspace (and shelf), grouped
 * client-side. A failed read renders `[]` plus `error` — never a substitute (INVARIANTS §11).
 * `select` is module-level so consumers keep a stable array identity.
 */

const selectIdentities = (body: AgentIdentityListResponse) => body.identities ?? [];

/** Shared frozen empty list — a fresh `[]` per render would re-run every consumer's grouping. */
const EMPTY_IDENTITIES: readonly AgentIdentity[] = Object.freeze([]);

export interface UseAgentIdentitiesOptions {
  /** Pause the read; defaults to true. */
  enabled?: boolean;
  /**
   * Which shelf; omitted = both. It keys the cache entry too, so the writes hook must be given the
   * same value (F-331).
   */
  shelf?: IdentityShelf;
}

export interface UseAgentIdentitiesResult {
  /** `readonly`: the shared empty fallback must not be mutated. */
  identities: readonly AgentIdentity[];
  loading: boolean;
  /**
   * Has the read answered (`data !== undefined`)? Gate every empty sentence on this — not on length,
   * and not on `!loading` (a disabled query is `pending` forever).
   */
  resolved: boolean;
  error: unknown;
  refetch: () => void;
}

/** @param workspaceId `null` = nothing to ask: the read is disabled and `resolved` stays false. */
export function useAgentIdentities(
  workspaceId: string | null,
  opts: UseAgentIdentitiesOptions = {}
): UseAgentIdentitiesResult {
  const query = useApiQuery<AgentIdentityListResponse, AgentIdentity[]>(
    agentIdentityKeys.list(opts.shelf).path,
    {
      workspaceId: workspaceId ?? undefined,
      // One minter for the param and the key's third element.
      query: identityListQuery(opts.shelf),
      select: selectIdentities,
      enabled: workspaceId !== null && (opts.enabled ?? true),
    }
  );
  return {
    identities: query.data ?? EMPTY_IDENTITIES,
    loading: query.isPending,
    resolved: query.data !== undefined,
    error: query.error,
    refetch: query.refetch,
  };
}
