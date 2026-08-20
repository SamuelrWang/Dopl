"use client";

/**
 * INLINE CONSENT for the channels page (Samuel, 2026-08-20): one hook owning
 * the thread→pending-request join, the card/strip decision callback, and the
 * arrival pop-up's pick-and-dismiss state. Extracted from
 * `channels-v2-core.tsx` at the 500-line cap — a reason-to-change split: this
 * is the "answer an ask from wherever you are standing" concern, whole.
 *
 * ⚠ NO NEW WRITE PATH. `consent` is the caller's `useChannelPreferenceWrites`
 * mutation — the same CAS'd `PATCH /consent/[id]` every consent surface uses.
 */

import { useMemo, useState } from "react";
import type { ApiMutation } from "@/shared/hooks/use-api-mutation";
import { pendingRequestIdByThread } from "./view-model-requested";
import type {
  Channel,
  ChannelConsentRequest,
  ChannelMessage,
} from "../../types";

export function useInlineConsent({
  channel,
  messages,
  requests,
  consent,
}: {
  channel: Channel | null;
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

  // Arrival pop-up: first undismissed pending inbound ask in the OPEN channel.
  // Dismissal is per request id and session-local — a dismissed ask stays
  // decidable on the card, in the thread strip, and in the Inbox.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const arrivalAsk = channel
    ? requests.find(
        (r) =>
          r.kind === "inbound" &&
          r.status === "pending" &&
          r.channelId === channel.id &&
          !dismissed.has(r.id)
      ) ?? null
    : null;
  const arrivalThreadId = arrivalAsk
    ? ([...pendingByThread].find(([, rid]) => rid === arrivalAsk.id)?.[0] ??
      null)
    : null;
  const dismissAsk = (id: string) =>
    setDismissed((prev) => new Set(prev).add(id));

  return { decideThread, arrivalAsk, arrivalThreadId, dismissAsk };
}
