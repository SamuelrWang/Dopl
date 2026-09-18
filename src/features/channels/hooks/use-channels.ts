"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { Channel } from "../types";

const selectChannels = (body: { channels: Channel[] }) => body.channels ?? [];

/**
 * Workspace channels the caller can see (public + their private ones).
 *
 * ⚠ **NO `includeArchived` SINCE 2026-09-17 (Samuel's ruling R-21).** It flipped
 * `?include=archived`, which re-keyed the cache so an ACTIVE-only list and an
 * everything list did not collide. There is no archived state now: the read
 * answers every live channel, and a channel that carries an old `archived_at`
 * stamp comes back as an ordinary channel like any other. ONE list, ONE key.
 */
export function useChannels(workspaceId: string) {
  const query = useApiQuery<{ channels: Channel[] }, Channel[]>(
    "/api/channels",
    { workspaceId, select: selectChannels }
  );
  return {
    channels: query.data ?? [],
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refetch: query.refetch,
  };
}
