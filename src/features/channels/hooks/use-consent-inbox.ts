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
 *
 * `refetchIntervalMs` adds a polling fallback for the known gap where
 * `channel_consent_requests` INSERTs are not delivered by Supabase Realtime, so
 * a pending request appears within a few seconds without a reload. Pass it ONLY
 * from the channels page (where the panel lives); leaving it undefined keeps the
 * always-mounted sidebar badge realtime-only so it never polls the workspace in
 * the background. When set, TanStack's default `refetchIntervalInBackground:
 * false` also pauses the poll while the browser tab is hidden.
 */
export function useConsentInbox(
  workspaceId: string | null | undefined,
  channelId?: string,
  refetchIntervalMs?: number
) {
  const query = useApiQuery<
    { requests: ChannelConsentRequest[] },
    ChannelConsentRequest[]
  >(workspaceId ? "/api/channels/consent" : null, {
    workspaceId: workspaceId ?? undefined,
    query: channelId ? { channelId } : undefined,
    select: selectRequests,
    staleTime: 0,
    refetchInterval: refetchIntervalMs,
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
