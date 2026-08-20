"use client";

/**
 * EVERY member's agent-session STATE in one channel — the Agents tab's peer
 * cards (Samuel, 2026-08-20). Read of `GET /api/channels/[channelId]/sessions`
 * (state projection only; the desktop's push writes it). `channel_sessions` is
 * deliberately unpublished (INVARIANTS §7), so this POLLS while mounted — the
 * panel mounts it only while the Agents tab is open.
 */

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelSessionState } from "../types";

export type ChannelPeerSession = ChannelSessionState & { userId: string };

const select = (data: { sessions: ChannelPeerSession[] }) => data.sessions;

export function useChannelAgentSessions(
  channelId: string | null,
  workspaceId: string | null | undefined,
  refetchIntervalMs?: number
) {
  const query = useApiQuery<{ sessions: ChannelPeerSession[] }, ChannelPeerSession[]>(
    channelId && workspaceId ? `/api/channels/${channelId}/sessions` : null,
    {
      workspaceId: workspaceId ?? undefined,
      select,
      staleTime: 0,
      refetchInterval: refetchIntervalMs,
    }
  );
  return { sessions: query.data ?? [], refetch: query.refetch };
}
