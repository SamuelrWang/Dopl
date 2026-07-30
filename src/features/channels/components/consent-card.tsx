"use client";

import {
  Check,
  Folder,
  FolderOpen,
  ShieldQuestion,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { AGENT_TOOL_PROFILE_LABELS } from "../constants";
import { useChannelFolder } from "../hooks/use-channel-folder";
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
 *
 * An inbound card also states WHERE the session would run (the channel's desktop
 * folder) and lets the operator change it before allowing — see
 * {@link RequestFolderRow}. That row is desktop-only; a plain browser shows no
 * folder line at all.
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
        <>
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
          <RequestFolderRow channelId={request.channelId} />
        </>
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
          {formatChannelTimestamp(request.createdAt)}
        </span>
      </div>
    </div>
  );
}

/**
 * The desktop-only "Runs in" row: which folder the session spawns into when the
 * operator clicks Allow, plus the affordance to change it before deciding. It
 * drives the SAME per-channel bridge as the header folder control
 * ({@link useChannelFolder}), so whatever this row shows is what the desktop
 * spawn uses, and a change made here shows up in the header too.
 *
 * Renders NOTHING outside the desktop shell (no bridge = no dead control), and
 * nothing on the first paint either, since the bridge is feature-detected after
 * mount to stay hydration-safe.
 */
export function RequestFolderRow({ channelId }: { channelId: string }) {
  const { bridge, label, busy, choose } = useChannelFolder(channelId);
  if (!bridge) return null;
  return (
    <RequestFolderRowView
      label={label}
      busy={busy}
      onChange={() => void choose()}
    />
  );
}

/**
 * The row's presentation, split from the bridge-gated wrapper so it renders (and
 * is tested) on its own. `label` null = the desktop default folder. Styling stays
 * inside the card's amber conventions: a quiet caption line, the folder itself
 * inked as primary, and a compact hover-only change affordance.
 */
export function RequestFolderRowView({
  label,
  busy,
  onChange,
}: {
  /** Abbreviated folder label, or null for the desktop default folder. */
  label: string | null;
  /** True while the native picker is open — the affordance disables. */
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-1.5 text-caption text-text-secondary">
      {label ? (
        <FolderOpen size={12} className="shrink-0" />
      ) : (
        <Folder size={12} className="shrink-0" />
      )}
      <span className="min-w-0 truncate">
        Runs in:{" "}
        <span className="font-medium text-text-primary">
          {label ?? "Default folder"}
        </span>
      </span>
      <button
        type="button"
        onClick={onChange}
        disabled={busy}
        aria-label="Change the folder this request runs in"
        className="shrink-0 rounded-[8px] px-1.5 py-0.5 text-micro font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-60"
      >
        {busy ? "Opening picker…" : "Change"}
      </button>
    </div>
  );
}
