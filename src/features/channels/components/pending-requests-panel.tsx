"use client";

import { ShieldQuestion } from "lucide-react";
import type { AgentToolProfile, ChannelConsentRequest } from "../types";
import { ConsentCard } from "./consent-card";

interface Props {
  /** Pending consent requests (inbound + outbound) for THIS channel. */
  requests: ChannelConsentRequest[];
  /** The caller's own agent tool scope in this channel — what Allow runs with. */
  toolProfile: AgentToolProfile;
  /** Consent decisions with a write in flight, by request id. */
  busyIds: ReadonlySet<string>;
  /** Allow / Send = "allow"; Deny / Cancel = "deny". PATCHes the server row. */
  onDecide: (id: string, decision: "allow" | "deny") => void;
}

/** "N to approve" / "M to review" — only the non-zero halves, joined by "·". */
function buildBreakdown(inboundCount: number, outboundCount: number): string {
  const parts: string[] = [];
  if (inboundCount > 0) parts.push(`${inboundCount} to approve`);
  if (outboundCount > 0) parts.push(`${outboundCount} to review`);
  return parts.join(" · ");
}

/**
 * The operator's Pending Requests surface — a first-class, labelled list (not a
 * scattered stack of inline banners) pinned at the top of the channel thread.
 * It gathers every durable pending decision the operator can answer whenever:
 * INBOUND requests (a teammate's agent asking to run — Allow / Deny) and
 * OUTBOUND reviews (the operator's own drafted reply — Send / Cancel), each as
 * a {@link ConsentCard} showing the FULL request/reply body in a scroll well so
 * no irreversible decision is ever gated on clamped text.
 *
 * The header carries a count + an inbound/outbound breakdown so the operator
 * reads the queue at a glance; the workspace-wide sidebar badge is the sibling
 * surface that makes a pending decision visible from any page. The band is
 * bounded + independently scrollable so a long body (or several at once) can
 * never push the transcript away. Renders nothing when the queue is empty.
 */
export function PendingRequestsPanel({
  requests,
  toolProfile,
  busyIds,
  onDecide,
}: Props) {
  if (requests.length === 0) return null;

  const inboundCount = requests.filter((r) => r.kind === "inbound").length;
  const breakdown = buildBreakdown(inboundCount, requests.length - inboundCount);

  return (
    <section
      aria-label="Pending requests"
      className="shrink-0 border-b border-border-default px-14 py-3"
    >
      <div className="mx-auto max-w-[760px]">
        <div className="mb-2 flex items-center gap-2">
          <ShieldQuestion size={13} className="shrink-0 text-text-secondary" />
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            Pending requests
          </span>
          <span className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
            {requests.length}
          </span>
          {breakdown && (
            <span className="min-w-0 truncate text-caption text-text-muted">
              {breakdown}
            </span>
          )}
        </div>
        <div className="max-h-[42vh] space-y-2 overflow-y-auto overscroll-contain">
          {requests.map((request) => (
            <ConsentCard
              key={request.id}
              request={request}
              toolProfile={toolProfile}
              busy={busyIds.has(request.id)}
              onAllow={() => onDecide(request.id, "allow")}
              onDeny={() => onDecide(request.id, "deny")}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
