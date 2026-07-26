"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { Channel } from "../types";

const selectChannels = (body: { channels: Channel[] }) => body.channels ?? [];

/**
 * Workspace channels the caller can see (public + their private ones).
 * `includeArchived` flips the `?include=archived` query param, which also
 * re-keys the cache so the two lists don't collide.
 */
export function useChannels(workspaceId: string, includeArchived: boolean) {
  const query = useApiQuery<{ channels: Channel[] }, Channel[]>(
    "/api/channels",
    {
      workspaceId,
      query: includeArchived ? { include: "archived" } : undefined,
      select: selectChannels,
    }
  );
  return {
    channels: query.data ?? [],
    loading: query.isPending,
    error: query.error ? query.error.message : null,
    refetch: query.refetch,
  };
}
