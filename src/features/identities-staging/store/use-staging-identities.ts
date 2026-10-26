"use client";

/**
 * STAND-IN for `agent-identities/hooks/use-agent-identities.ts`: the same result shape, rows from
 * the in-memory store filtered by the workspace the read names. The home read can be switched to
 * fail, so the Personal section's failure state is reachable.
 */
import { useMemo } from "react";
import type { AgentIdentity } from "@/features/agent-identities/client/types";
import { AgentIdentityApiError } from "@/features/agent-identities/client/api";
import type { UseAgentIdentitiesResult } from "@/features/agent-identities/hooks/use-agent-identities";
import { STAGING_HOME_WORKSPACE_ID } from "../data";
import { setHomeReadFails, useIdentityState } from "./identity-store";

const EMPTY_IDENTITIES: readonly AgentIdentity[] = Object.freeze([]);

const HOME_READ_ERROR = new AgentIdentityApiError(
  503,
  "SERVICE_UNAVAILABLE",
  "Identities are temporarily unavailable. Try again in a moment."
);

export function useStagingIdentities(workspaceId: string | null): UseAgentIdentitiesResult {
  const { identities, homeReadFails } = useIdentityState();
  const enabled = workspaceId !== null;
  const failed = enabled && homeReadFails && workspaceId === STAGING_HOME_WORKSPACE_ID;
  const rows = useMemo(
    () =>
      enabled && !failed
        ? identities.filter((i) => i.workspaceId === workspaceId)
        : EMPTY_IDENTITIES,
    [enabled, failed, identities, workspaceId]
  );
  return {
    identities: rows,
    loading: !enabled,
    resolved: enabled && !failed,
    error: failed ? HOME_READ_ERROR : null,
    refetch: () => setHomeReadFails(false),
  };
}
