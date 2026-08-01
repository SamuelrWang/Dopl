"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { toast } from "@/shared/ui/toast";
import {
  ChannelApiError,
  createChannelAgent,
  disengageChannelAgent,
  renameChannelAgent,
  setChannelAgentStatus,
} from "../client/api";
import { useChannelAgentsRealtime } from "../client/realtime";
import type { AgentStatus, ChannelAgent } from "../types";

const selectAgents = (body: { agents: ChannelAgent[] }) => body.agents ?? [];

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_AGENTS: ChannelAgent[] = [];

/** The list path — also the query key prefix the mutations invalidate. */
function agentsPath(channelId: string): string {
  return `/api/channels/${encodeURIComponent(channelId)}/agents`;
}

/**
 * What the roster actually hands back.
 *
 * Deliberately NOT here: `loading`, `busy`, and `refetch`. Nothing consumed
 * them — the chips bar renders an empty roster the same way it renders a
 * loading one, write failures surface as toasts from inside this hook, and
 * refetching is already driven by realtime + the mutations' own invalidation.
 * An unused knob on a public interface is a contract someone eventually wires
 * a spinner to; add one back when a caller needs it.
 */
export interface ChannelAgentsState {
  /** Every agent in the channel, dismissed rows included (attribution needs them). */
  agents: ChannelAgent[];
  /** Summon an agent. Omit the name to take the next handle from the pool. */
  createAgent: (name?: string) => Promise<ChannelAgent>;
  /** Rename an agent (owner-only, server-enforced). */
  renameAgent: (agentId: string, name: string) => Promise<ChannelAgent>;
  /** Park / resume / dismiss an agent (owner-only, server-enforced). */
  setAgentStatus: (agentId: string, status: AgentStatus) => Promise<ChannelAgent>;
  /** Stop an agent listening to this channel (owner-only, server-enforced). */
  disengageAgent: (agentId: string) => Promise<ChannelAgent>;
}

/**
 * The channel's AGENT ROSTER — the list plus its four writes.
 *
 * Server state per §7: `useApiQuery` over `apiRequest` for the read (workspace
 * header included), TanStack mutations over the typed client for the writes,
 * each invalidating the list key so the chips bar re-renders from the server's
 * answer rather than a locally merged guess. Realtime does the same job for
 * writes that happen ELSEWHERE — the peer summoning their own agent, a desktop
 * session flipping one to `active` — through `useChannelAgentsRealtime`, which
 * refetches (never merges the payload, so RLS stays authoritative).
 *
 * Disabled until a channel is selected, and skippable via `enabled` for a
 * channel the caller isn't a member of (the route would 403 and the chips bar
 * has nothing to draw).
 */
export function useChannelAgents(
  channelId: string | null,
  workspaceId: string,
  opts: { enabled?: boolean } = {}
): ChannelAgentsState {
  const enabled = opts.enabled ?? true;
  const path = channelId && enabled ? agentsPath(channelId) : null;
  const queryClient = useQueryClient();

  const query = useApiQuery<{ agents: ChannelAgent[] }, ChannelAgent[]>(path, {
    workspaceId,
    select: selectAgents,
    keepPreviousData: true,
  });

  const refetch = query.refetch;
  useChannelAgentsRealtime(enabled ? workspaceId : null, () => void refetch());

  // One invalidation for every write: the list is the only cache entry
  // agent state lives in, and the server's row is the authority on the result
  // (a rename is normalized, a status flip may be refused).
  const invalidate = useCallback(() => {
    if (path) void queryClient.invalidateQueries({ queryKey: [path] });
  }, [queryClient, path]);

  // A refused write is the one thing the chips bar cannot show on its own (the
  // affordances live in a popover that closes), so every failure toasts with
  // the server's own message — a duplicate handle, a lost membership, a 403 on
  // someone else's agent — rather than looking like nothing happened.
  const onError = useCallback((err: unknown, fallback: string) => {
    toast({ title: err instanceof ChannelApiError ? err.message : fallback });
  }, []);

  const create = useMutation({
    mutationFn: (name?: string) =>
      createChannelAgent(channelId as string, name, workspaceId),
    onSuccess: invalidate,
    onError: (err) => onError(err, "Couldn't summon the agent"),
  });

  const rename = useMutation({
    mutationFn: (vars: { agentId: string; name: string }) =>
      renameChannelAgent(
        channelId as string,
        vars.agentId,
        vars.name,
        workspaceId
      ),
    onSuccess: invalidate,
    onError: (err) => onError(err, "Couldn't rename the agent"),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { agentId: string; status: AgentStatus }) =>
      setChannelAgentStatus(
        channelId as string,
        vars.agentId,
        vars.status,
        workspaceId
      ),
    onSuccess: invalidate,
    onError: (err) => onError(err, "Couldn't update the agent"),
  });

  // Same invalidation as the other three: `engagedAt` lives on the agent row,
  // so the list read is where the chip learns it went idle.
  const disengage = useMutation({
    mutationFn: (agentId: string) =>
      disengageChannelAgent(channelId as string, agentId, workspaceId),
    onSuccess: invalidate,
    onError: (err) => onError(err, "Couldn't disengage the agent"),
  });

  const createAgent = useCallback(
    (name?: string) => create.mutateAsync(name),
    [create]
  );
  const renameAgent = useCallback(
    (agentId: string, name: string) => rename.mutateAsync({ agentId, name }),
    [rename]
  );
  const setAgentStatus = useCallback(
    (agentId: string, status: AgentStatus) =>
      setStatus.mutateAsync({ agentId, status }),
    [setStatus]
  );
  const disengageAgent = useCallback(
    (agentId: string) => disengage.mutateAsync(agentId),
    [disengage]
  );

  return {
    agents: query.data ?? NO_AGENTS,
    createAgent,
    renameAgent,
    setAgentStatus,
    disengageAgent,
  };
}
