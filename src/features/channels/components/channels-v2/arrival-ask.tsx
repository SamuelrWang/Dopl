"use client";

/**
 * THE ARRIVAL POP-UP (Samuel, 2026-08-20): the decision panel, floated over
 * the channels page when the OPEN channel carries a pending inbound ask.
 *
 * The desktop notification's navigation lands the operator on the channel
 * (wiring plan Phase 9); this is what meets them there — and it meets plain
 * browsing identically, because "how did you get here" is not something the
 * decision should depend on. Same `LaunchPanel`, same consent mutation, same
 * CAS and gate as the Inbox pane; this surface adds only WHERE the decision
 * is offered, never a second write path.
 *
 * Dismissal is per request id and session-local — a dismissed ask stays
 * decidable on the transcript card, in the thread view's strip, and in the
 * Inbox. Nothing here is the only door.
 */

import { X } from "lucide-react";
import { LaunchPanel } from "../launch-panel";
import { IconButton } from "./bits";
import type { ChannelConsentRequest } from "../../types";

export function ChannelsV2ArrivalAsk({
  ask,
  threadId,
  busy,
  onDecide,
  onOpenThread,
  onDismiss,
}: {
  ask: ChannelConsentRequest;
  /** The thread the ask maps to, when the seq join can place one. */
  threadId: string | null;
  busy: boolean;
  onDecide: (decision: "allow" | "deny") => void;
  onOpenThread: (threadId: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-x-0 top-14 z-30 mx-auto w-[420px] max-w-[90%]">
      <div className="bento bg-white p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
            New agent thread
          </span>
          <span className="flex-1" />
          {threadId && (
            <button
              type="button"
              onClick={() => onOpenThread(threadId)}
              className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
            >
              Open thread
            </button>
          )}
          <IconButton
            icon={X}
            label="Dismiss"
            size={14}
            className="h-6 w-6"
            onClick={onDismiss}
          />
        </div>
        <LaunchPanel
          request={ask}
          busy={busy}
          onLaunch={() => onDecide("allow")}
          onDecline={() => onDecide("deny")}
        />
      </div>
    </div>
  );
}
