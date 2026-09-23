"use client";

import type { TranscriptFilter } from "./transcript-filter";

/**
 * The transcript cross-fade's key (`fade-swap.tsx`): names the selection only, never the rows,
 * so a realtime push does not fade. Agent ids are sorted so one set has one spelling; the
 * channel id is part of the key because filters are stored per channel.
 */
export function transcriptFilterViewKey(
  channelId: string,
  filter: TranscriptFilter
): string {
  return `${channelId}:${filter.people ? "p" : "-"}:${[...filter.agentIds]
    .sort()
    .join(",")}`;
}

