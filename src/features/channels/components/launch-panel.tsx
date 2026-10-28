"use client";

import { Check, ShieldQuestion, Sparkles, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { StreamProse } from "./agent-stream-prose";
import { TextOnlyLinks } from "./message-markdown";
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
 * rewrite**: the panel's one consumer is `channels/components/thread-consent.tsx ›
 * ThreadSendBox`, which always passes an OUTBOUND request, so
 * `request.kind === "inbound"` was never true in production. Measured, not
 * assumed — `grep -rn 'kind: "inbound"' src apps --glob '!*.test.*'` returned
 * zero, which is what F-233 records.
 *
 * ⚠ THAT PARAGRAPH'S SUCCESSOR — "an inbound decision is still made, just not
 * here", naming `thread-consent.tsx › ThreadAwaitingStrip`, `channels/components/
 * transcript.tsx › ThreadCardMessage` and the Inbox pane's `InboxRow` — IS
 * ITSELF EXPIRED. There is no inbound decision anywhere (2026-08-22), and the
 * Inbox pane is deleted (2026-08-25, INVARIANTS §6).
 *
 * ⚠ THIS PANEL IS THE THREAD VIEW'S SEND BOX AND NOTHING ELSE, and it is now the
 * only surface in the product carrying a **Cancel**. The work stream's held-draft
 * card (`channels/components/agent-stream.tsx › SentToChannelBox`) is the other outbound
 * review surface and it has ONE button, Post — Samuel's ruling. **Do not add a
 * Cancel there, and do not remove this one**: a draft whose `message_seq` places
 * it on a thread is reachable here even after its agent's session (and its
 * narration ring) is gone.
 *
 * ⚠ WHAT WENT WITH THE ARM, so nobody restores half of it: `LAUNCH_SETTINGS_HEADING`
 * ("For the next request you allow" — the only thing left saying the arm was an
 * arm), the `LaunchSettings` disclosure, `desktopLaunchSettingsExist`, the
 * `useSyncExternalStore` bridge probe, `components/permission-preset-row.tsx ›
 * RequestPermissionRow` and the whole of `components/request-folder-row.tsx`.
 * The DURABLE launch posture and the per-channel working folder both survive on
 * the Settings tab (`channels/components/settings-agent.tsx`) — they are a different
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
    <div className="rounded-lg border border-warning/25 bg-warning/10 px-3.5 py-2.5">
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

      {/* ⚠ **THE AGENT'S OWN PROSE, THROUGH THE AGENT WINDOW'S OWN RENDERER**
          (2026-10-10, #3128). Both of these are text this operator's agent wrote, and
          both printed their `**asterisks**` raw — so the operator approved a draft full of
          markup and then watched the SAME string render bold in the transcript a second
          later. `StreamProse` is what `agent-stream-sent-box.tsx` mounts for exactly this
          text, so what is approved here and what is posted there are one rendering.
          ⚠ **BLOCK ARM, NOT INLINE, AND THE SCROLL BOX IS WHY.** This preview is the whole
          draft — lists and fences and all — in a `max-h` box that SCROLLS rather than
          clamps, which is the one place in this surface where block structure both fits
          and matters (`message-markdown-inline.tsx` rule 2 is about the clamped lanes).
          ⚠ **`whitespace-pre-wrap` IS GONE FROM THE BODY AND MUST BE.** The renderer makes
          the newlines into real blocks; keeping the rule on top of it would pay for every
          blank line twice.
          🔒 **AND NOTHING IN HERE IS AN ANCHOR** ({@link TextOnlyLinks}, 2026-10-11). This
          is the last gate before a machine speaks for a human, and the operator is
          approving BYTES: an agent-authored `[tap me](https://…)` rendered as a live
          `target="_blank"` link turns the approve/decline card itself into a destination —
          a press that leaves the app instead of deciding, inside the one surface in the
          product whose whole job is a decision. The URL still shows, as its own characters,
          which is MORE of what will post rather than less. */}
      {request.summary && (
        <TextOnlyLinks>
          <StreamProse
            text={request.summary}
            className="mb-1"
            textClassName="text-body leading-relaxed text-text-primary"
          />
        </TextOnlyLinks>
      )}
      {preview && (
        <div className="concave-field mb-2 max-h-50 overflow-y-auto rounded-md px-2.5 py-2">
          <TextOnlyLinks>
            <StreamProse
              text={preview}
              textClassName="text-caption leading-relaxed text-text-secondary"
            />
          </TextOnlyLinks>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onLaunch}
          className={cn(
            "btn-light flex h-8 items-center gap-1.5 rounded-md px-3 text-small font-medium text-text-primary disabled:opacity-60"
          )}
        >
          <Check size={14} />
          Send
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDecline}
          className="flex h-8 items-center gap-1.5 rounded-md px-3 text-small font-medium text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-60"
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
