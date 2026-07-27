"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelConsentRequest } from "../types";
import { useConsentRealtime } from "../client/realtime";

const selectRequests = (body: { requests: ChannelConsentRequest[] }) =>
  body.requests ?? [];

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_REQUESTS: ChannelConsentRequest[] = [];

/**
 * The caller's pending consent inbox (both inbound + outbound), refetched live
 * on any consent event. RLS scopes the stream to the operator's own rows, and
 * the service returns only `pending` rows (a decision on another surface
 * removes it here on the next refetch). Pass a `channelId` to scope the server
 * query, or omit it (sidebar badge) for the whole workspace.
 */
export function useConsentInbox(
  workspaceId: string | null | undefined,
  channelId?: string
) {
  const query = useApiQuery<
    { requests: ChannelConsentRequest[] },
    ChannelConsentRequest[]
  >(workspaceId ? "/api/channels/consent" : null, {
    workspaceId: workspaceId ?? undefined,
    query: channelId ? { channelId } : undefined,
    select: selectRequests,
    staleTime: 0,
  });

  useConsentRealtime(workspaceId, () => void query.refetch());

  // Memoized: these feed the view's `useMemo`s, and a fresh array identity per
  // render would recompute every consent-derived view on every keystroke.
  const requests = query.data ?? NO_REQUESTS;
  const inbound = useMemo(
    () => requests.filter((r) => r.kind === "inbound"),
    [requests]
  );
  const outbound = useMemo(
    () => requests.filter((r) => r.kind === "outbound"),
    [requests]
  );

  return { requests, inbound, outbound, refetch: query.refetch };
}
