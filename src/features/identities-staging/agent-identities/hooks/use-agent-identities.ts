"use client";

/**
 * STAGING STUB of `src/features/agent-identities/hooks/use-agent-identities.ts`. Same signature
 * and result shape; rows come from the in-memory store (`../../identity-store.ts`), filtered by
 * the workspace the read names. `shelf` is accepted and ignored (every staged home row is home).
 */
import { useMemo } from "react";
import type { AgentIdentity, IdentityShelf } from "@/features/agent-identities/client/types";
import { AgentIdentityApiError } from "@/features/agent-identities/client/api";
import { STAGING_HOME_WORKSPACE_ID } from "../../data";
import { setHomeReadFails, useIdentityState } from "../../identity-store";

const EMPTY_IDENTITIES: readonly AgentIdentity[] = Object.freeze([]);

export interface UseAgentIdentitiesOptions {
  enabled?: boolean;
  shelf?: IdentityShelf;
}

export interface UseAgentIdentitiesResult {
  identities: readonly AgentIdentity[];
  loading: boolean;
  resolved: boolean;
  error: unknown;
  refetch: () => void;
}

const HOME_READ_ERROR = new AgentIdentityApiError(
  503,
  "SERVICE_UNAVAILABLE",
  "Identities are temporarily unavailable. Try again in a moment."
);

export function useAgentIdentities(
  workspaceId: string | null,
  opts: UseAgentIdentitiesOptions = {}
): UseAgentIdentitiesResult {
  void opts.shelf;
  const { identities, homeReadFails } = useIdentityState();
  const enabled = workspaceId !== null && (opts.enabled ?? true);
  const failed = enabled && homeReadFails && workspaceId === STAGING_HOME_WORKSPACE_ID;
  const rows = useMemo(
    () => (enabled && !failed ? identities.filter((i) => i.workspaceId === workspaceId) : EMPTY_IDENTITIES),
    [enabled, failed, identities, workspaceId]
  );
  return {
    identities: rows,
    loading: !enabled,
    resolved: enabled && !failed,
    error: failed ? HOME_READ_ERROR : null,
    // "Try again" recovers, so the failure state and the loaded state are both reachable.
    refetch: () => setHomeReadFails(false),
  };
}
