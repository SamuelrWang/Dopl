"use client";

/**
 * THE OUTBOUND SEND BOX'S WIRING: the thread→pending-draft join and the decision
 * callback the box's Send / Cancel fire.
 *
 * ⚠ IT WAS THE INBOUND HOOK UNTIL 2026-08-22 (Samuel): *"remove all the stuff
 * about declining and approving of threads — you have the thread, you open it,
 * and either you launch agent or you don't."* `decideThread` and the
 * `pendingRequestIdByThread` join it stood on are DELETED with the two surfaces
 * they fed (the transcript card's inline Decline / Launch agent, and
 * `thread-consent.tsx › ThreadAwaitingStrip`). **There is no inbound decision on
 * this page.** Launching an agent on a thread is a direct act — the card's
 * "Launch agent" calls `use-agents-panel.ts › launchAgent`, which spawns one on
 * that thread and answers to nobody's request.
 *
 * ⚠ WHAT IS LEFT IS ONE DIRECTION AND IT IS THE OPERATOR'S OWN. Their agent
 * drafted a reply, auto-send is off, and a human decides whether it leaves the
 * machine. That is still a `pending` consent row and still the CAS'd
 * `PATCH /consent/[id]`.
 *
 * ⚠ NO NEW WRITE PATH. `consent` is the caller's `useChannelPreferenceWrites`
 * mutation — the same CAS'd `PATCH /consent/[id]` the Inbox's outbound rows use.
 */

import { useMemo } from "react";
import type { ApiMutation } from "@/shared/hooks/use-api-mutation";
import { pendingOutboundByThread } from "./view-model-requested";
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
  // Thread → my own agent's draft awaiting my Send (the thread view's send box,
  // Samuel 2026-08-20). Seq-keyed join, outbound rows.
  const outboundByThread = useMemo(
    () => pendingOutboundByThread(messages, requests),
    [messages, requests]
  );

  const decideOutbound = (id: string, decision: "allow" | "deny") =>
    consent.mutate({ id, decision });

  return {
    outboundByThread,
    decideOutbound,
    consentBusy: consent.pending,
  };
}
