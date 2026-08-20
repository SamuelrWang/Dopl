"use client";

/**
 * INLINE CONSENT for the channels page (Samuel, 2026-08-20): one hook owning
 * the thread→pending-request join and the card/strip decision callback.
 * Extracted from `channels-v2-core.tsx` at the 500-line cap — a
 * reason-to-change split: this is the "answer an ask from wherever you are
 * standing" concern, whole.
 *
 * ⚠ THE ARRIVAL POP-UP IS GONE (Samuel, 2026-08-20, second ruling of the day
 * — it shipped that morning). The transcript card and the thread strip are
 * the ONLY inbound decision surfaces; nothing floats over the page.
 *
 * ⚠ NO NEW WRITE PATH. `consent` is the caller's `useChannelPreferenceWrites`
 * mutation — the same CAS'd `PATCH /consent/[id]` every consent surface uses.
 */

import { useMemo } from "react";
import type { ApiMutation } from "@/shared/hooks/use-api-mutation";
import {
  pendingOutboundByThread,
  pendingRequestIdByThread,
} from "./view-model-requested";
import type { ChannelConsentRequest, ChannelMessage } from "../../types";

export function useInlineConsent({
  messages,
  requests,
  consent,
}: {
  messages: ChannelMessage[];
  requests: ChannelConsentRequest[];
  consent: ApiMutation<
    { id: string; decision: "allow" | "deny" },
    { request: ChannelConsentRequest }
  >;
}) {
  // Thread → pending consent-request id, the seq-keyed join.
  const pendingByThread = useMemo(
    () => pendingRequestIdByThread(messages, requests),
    [messages, requests]
  );

  const decideThread = (threadId: string, decision: "allow" | "deny") => {
    const id = pendingByThread.get(threadId);
    if (id) consent.mutate({ id, decision });
  };

  // Thread → my own agent's draft awaiting my Send (the thread view's send
  // box, Samuel 2026-08-20). Same seq-keyed join, outbound rows.
  const outboundByThread = useMemo(
    () => pendingOutboundByThread(messages, requests),
    [messages, requests]
  );

  const decideOutbound = (id: string, decision: "allow" | "deny") =>
    consent.mutate({ id, decision });

  return {
    decideThread,
    outboundByThread,
    decideOutbound,
    consentBusy: consent.pending,
  };
}
