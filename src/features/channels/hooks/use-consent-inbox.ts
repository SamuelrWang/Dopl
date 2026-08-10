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
 * on any consent event. The SERVICE scopes the read to `(operator, workspace)`
 * and returns only `pending` rows (a decision on another surface removes it
 * here on the next refetch). Pass a `channelId` to scope the server query, or
 * omit it (sidebar badge) for the whole workspace.
 *
 * ⚠ This used to say "RLS scopes the stream to the operator's own rows", which
 * was wrong twice and is why the badge counted other workspaces' requests until
 * 2026-08-10: the list read runs under the service-role client so RLS does not
 * apply at all, and operator-scoping was never workspace-scoping. The bound
 * lives in `repository-collab.listConsentRequests`, which now requires a
 * `workspaceId`. Do not restate a filter's location from memory — the one in
 * this comment did not exist.
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
