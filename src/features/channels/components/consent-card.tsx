"use client";

import { Check, ShieldQuestion, Sparkles, TerminalSquare, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { AGENT_TOOL_PROFILE_LABELS } from "../constants";
import type { AgentToolProfile, ChannelConsentRequest } from "../types";

interface Props {
  request: ChannelConsentRequest;
  /** The caller's own agent tool scope in this channel — what Allow runs with. */
  toolProfile: AgentToolProfile;
  /** Allow (inbound) / Send (outbound). */
  onAllow: () => void;
  /** Deny (inbound) / Cancel (outbound). */
  onDeny: () => void;
  busy?: boolean;
}

/** Shown when a requester has no hydrated name — used for BOTH the avatar
 *  initial and the headline so they can never disagree (no "?" next to a
 *  named line). */
const UNKNOWN_REQUESTER = "A teammate";

/**
 * A pending human-in-the-loop decision. Inbound = a teammate's agent is asking
 * to run something on your machine (Allow / Deny before it spawns); outbound =
 * your own agent drafted a reply awaiting Send / Cancel before it leaves. The
 * verbatim summary + full body are shown so the decision is informed, never a
 * blind yes: the body sits in a scrollable well rather than a clamp, because
 * approving text you cannot read is not consent.
 */
export function ConsentCard({
  request,
  toolProfile,
  onAllow,
  onDeny,
  busy,
}: Props) {
  const isInbound = request.kind === "inbound";
  const requester = request.requesterName || UNKNOWN_REQUESTER;
  const preview = isInbound ? request.bodyPreview : request.proposedReply ?? "";

  return (
    <div className="rounded-[10px] border border-warning/25 bg-warning/10 px-3.5 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        {isInbound ? (
          <Avatar
            person={{
              userId: request.requesterUserId ?? requester,
              email: null,
              displayName: requester,
              avatarUrl: request.requesterAvatarUrl,
            }}
            size="xs"
          />
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-inset text-text-secondary">
            <Sparkles size={12} />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">
          {isInbound
            ? `${requester}'s agent is asking`
            : "Your agent wants to reply"}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
          <ShieldQuestion size={11} />
          {isInbound ? "Approve in" : "Approve out"}
        </span>
      </div>

      {request.summary && (
        <p className="mb-1 text-body leading-relaxed text-text-primary">
          {request.summary}
        </p>
      )}
      {preview && (
        <div className="concave-field mb-2 max-h-[200px] overflow-y-auto rounded-[8px] px-2.5 py-2">
          <p className="whitespace-pre-wrap break-words text-caption leading-relaxed text-text-secondary">
            {preview}
          </p>
        </div>
      )}

      {isInbound && (
        <p className="mb-2.5 flex items-start gap-1.5 text-caption leading-relaxed text-text-secondary">
          <TerminalSquare size={12} className="mt-0.5 shrink-0" />
          <span>
            Allowing runs a Claude session on this machine with your{" "}
            <span className="font-medium text-text-primary">
              {AGENT_TOOL_PROFILE_LABELS[toolProfile]}
            </span>{" "}
            tool scope for this channel.
          </span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onAllow}
          className={cn(
            "btn-light flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-small font-medium text-text-primary disabled:opacity-60"
          )}
        >
          <Check size={14} />
          {isInbound ? "Allow" : "Send"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDeny}
          className="flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-small font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-60"
        >
          <X size={14} />
          {isInbound ? "Deny" : "Cancel"}
        </button>
        <span className="flex-1" />
        <span className="shrink-0 text-micro text-text-muted">
          {formatRelativeTime(request.createdAt)}
        </span>
      </div>
    </div>
  );
}
