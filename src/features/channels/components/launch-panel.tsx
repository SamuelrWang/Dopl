"use client";

import { Check, ShieldQuestion, Sparkles, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { ChannelConsentRequest } from "../types";

interface Props {
  request: ChannelConsentRequest;
  /** Send. ⚠ The SAME consent decision the retired card's Allow made —
   *  `PATCH /consent/[id]` with `"allow"`. */
  onLaunch: () => void;
  /** Cancel — the `"deny"` decision. */
  onDecline: () => void;
  busy?: boolean;
}

/**
 * THE OUTBOUND SEND BOX: the operator's own agent has drafted a reply and a
 * human decides whether it leaves the machine.
 *
 * ⚠ THIS FILE WAS TWO PANELS AND IS NOW ONE (2026-08-20, F-233 + Samuel's
 * ruling). It carried an INBOUND arm as well — a requester avatar, "<name>'s
 * agent is asking", a "Launching runs a Claude session on this machine." line,
 * and a two-click disclosure that expanded into the launch settings before the
 * second click decided. **None of it had rendered since the 2026-08-18 consent
 * rewrite**: the panel's one consumer is `channels-v2/thread-consent.tsx ›
 * ThreadSendBox`, which always passes an OUTBOUND request, so
 * `request.kind === "inbound"` was never true in production. Measured, not
 * assumed — `grep -rn 'kind: "inbound"' src apps --glob '!*.test.*'` returned
 * zero, which is what F-233 records.
 *
 * ⚠ AN INBOUND DECISION IS STILL MADE, JUST NOT HERE. `thread-consent.tsx ›
 * ThreadAwaitingStrip`, `channels-v2/transcript.tsx › ThreadCardMessage` and
 * `channels-v2/inbox-pane.tsx › InboxRow` each render their own Launch agent /
 * Decline against the same consent row. The product was never broken; the ARM's
 * two controls were, and they went with it.
 *
 * ⚠ WHAT WENT WITH THE ARM, so nobody restores half of it: `LAUNCH_SETTINGS_HEADING`
 * ("For the next request you allow" — the only thing left saying the arm was an
 * arm), the `LaunchSettings` disclosure, `desktopLaunchSettingsExist`, the
 * `useSyncExternalStore` bridge probe, `components/permission-preset-row.tsx ›
 * RequestPermissionRow` and the whole of `components/request-folder-row.tsx`.
 * The DURABLE launch posture and the per-channel working folder both survive on
 * the Settings tab (`channels-v2/settings-agent.tsx`) — they are a different
 * record with a different consumer, and `main/channel-prefs.js` says why the two
 * must never merge.
 *
 * ⚠ IT TAKES A `ChannelConsentRequest`, NOT AN OUTBOUND-ONLY TYPE, deliberately.
 * The row shape is the server's and is shared with the inbound surfaces; a
 * narrowed prop type here would be a second statement of what a consent row is.
 */
export function LaunchPanel({ request, onLaunch, onDecline, busy }: Props) {
  const preview = request.proposedReply ?? "";

  return (
    <div className="rounded-[10px] border border-warning/25 bg-warning/10 px-3.5 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-inset text-text-secondary">
          <Sparkles size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-text-primary">
          Your agent wants to reply
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
          <ShieldQuestion size={11} />
          To send
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onLaunch}
          className={cn(
            "btn-light flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-small font-medium text-text-primary disabled:opacity-60"
          )}
        >
          <Check size={14} />
          Send
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-small font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-60"
        >
          <X size={14} />
          Cancel
        </button>
        <span className="flex-1" />
        <span className="shrink-0 text-micro text-text-muted">
          {formatChannelTimestamp(request.createdAt)}
        </span>
      </div>
    </div>
  );
}
