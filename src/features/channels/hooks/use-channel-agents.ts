"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelAgent } from "../types";

const selectAgents = (body: { agents: ChannelAgent[] }) => body.agents ?? [];

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_AGENTS: ChannelAgent[] = [];

/**
 * The channel's HISTORICAL agent roster — a read, and nothing else.
 *
 * It used to be the roster PLUS its four writes (summon / rename / set status /
 * disengage), with a realtime binding that refetched when a peer summoned one or
 * a session flipped one to `active`. Named agents are gone (rollback §1), so
 * every write went, and so did the realtime binding: nothing changes these rows
 * any more, which makes a live subscription to them pure cost.
 *
 * WHY THE READ SURVIVES: stored messages carry `metadata.author_agent_id`, and
 * the transcript resolves it to a handle through this list
 * (`lib/agent-display.ts`). Without it, every message an agent posted before the
 * rollback loses its name. Dismissed rows are included by the server for exactly
 * that reason.
 *
 * Disabled until a channel is selected, and skippable via `enabled` for a
 * channel the caller isn't a member of (the route would 403).
 */
export function useChannelAgents(
  channelId: string | null,
  workspaceId: string,
  opts: { enabled?: boolean } = {}
): ChannelAgent[] {
  const enabled = opts.enabled ?? true;
  const path =
    channelId && enabled
      ? `/api/channels/${encodeURIComponent(channelId)}/agents`
      : null;

  const query = useApiQuery<{ agents: ChannelAgent[] }, ChannelAgent[]>(path, {
    workspaceId,
    select: selectAgents,
    keepPreviousData: true,
  });

  return query.data ?? NO_AGENTS;
}
