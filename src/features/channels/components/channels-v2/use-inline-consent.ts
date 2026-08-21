"use client";

/**
 * INLINE CONSENT for the channels page (Samuel, 2026-08-20): one hook owning
 * the thread→pending-request join and the card/strip decision callback.
 * Extracted from `channels-v2-core.tsx` at the 500-line cap — a
 * reason-to-change split: this is the "answer an ask from wherever you are
 * standing" concern, whole.
 *
 * ⚠ THE ARRIVAL POP-UP IS GONE (Samuel, 2026-08-20, second ruling of the day
 * — it shipped that morning). NOTHING FLOATS OVER THE PAGE: a decision is made
 * where the row already is. The transcript card and the thread strip are the two
 * surfaces THIS hook feeds, and they are the ones a placed row reaches.
 *
 * ⚠ THEY ARE NOT THE ONLY DECISION SURFACES — `inbox-pane.tsx › InboxRow`
 * decides too, on the same CAS'd mutation, and it is not wired through here. Its
 * job is the rows the seq→thread join below CANNOT place (untagged triggers,
 * aged-out pages, seq-less outbound drafts), which is exactly the set this hook
 * returns nothing for. Do not "consolidate" the Inbox into this join: the rows it
 * exists for are the ones the join has already failed on, and a hung agent is
 * what a row nobody can decide becomes.
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
