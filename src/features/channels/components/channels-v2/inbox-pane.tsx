"use client";

/**
 * Channels v2 — THE INBOX, in the center column. Every request still waiting on
 * THIS viewer renders as a ROW: the row BODY navigates to its channel, and the
 * row also DECIDES.
 *
 * ⚠ IT IS A DECISION SURFACE, AND SAYING OTHERWISE IS THE BUG THIS LINE EXISTS
 * TO PREVENT. It shipped on 2026-08-20 as a passive list (Samuel — that ruling
 * DEMOTED the Phase 8 launch-panel inbox), and the Decline / Launch agent pair
 * was RESTORED the same day at review. The reason is the join: the seq→thread
 * lookup cannot place every row (untagged triggers, aged-out pages, deliberately
 * seq-less outbound drafts), and a row no surface can decide is a hung agent —
 * so the Inbox is the DURABLE decision home of LAST RESORT. The transcript card
 * (`transcript.tsx › ThreadCardMessage`) and the thread strip
 * (`thread-consent.tsx › ThreadAwaitingStrip`) are the placed-row surfaces; this
 * one catches what they cannot reach. Same CAS'd `PATCH /consent/[id]`, all
 * three.
 *
 * ⚠ NO LAUNCH SETTINGS ON THIS SURFACE, and none anywhere else either: the
 * single-use ARM the launch panel used to expand into is DELETED (2026-08-20).
 * What survives is the DURABLE launch posture on the channel's Settings tab
 * (`settings-agent.tsx`), which governs the launches the OPERATOR starts — not
 * the one this row is allowing. A decision made here starts at the peer-request
 * default, manual/ask.
 *
 * ⚠ THIS IS THE ADDRESSEE'S SIDE, and it is the only side that exists. A
 * consent read is scoped to `(operator, workspace)` with the operator always
 * `ctx.userId` (INVARIANTS §6), so a REQUESTER cannot see their addressee's
 * state at all (F-206). What is listed is what you owe an answer or a send on;
 * a request you SENT never appears.
 *
 * ⚠ NO NEW READ. The rows are the page's existing `use-consent-inbox` result,
 * handed down — the same array the sidebar's Inbox badge counts. Deliberately
 * WORKSPACE-WIDE, not scoped to the open channel: it is a landing spot, and a
 * pending row may name any channel.
 */

import { Inbox, Send } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import type { ChannelConsentRequest } from "../../types";

export function ChannelsV2InboxPane({
  requests,
  onOpen,
  onDecide,
  busy = false,
}: {
  /** The viewer's pending requests, workspace-wide — the same array the
   *  sidebar's Inbox badge counts. */
  requests: ChannelConsentRequest[];
  /** Navigate to the row's channel (the row body's click). */
  onOpen: (channelId: string) => void;
  /** The CAS'd consent decision — the last-resort home for unplaceable rows. */
  onDecide: (id: string, decision: "allow" | "deny") => void;
  busy?: boolean;
}) {
  return (
    <section aria-label="Inbox" className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-4">
        <Inbox size={14} className="shrink-0 text-text-muted" />
        <span className="truncate text-body font-semibold text-text-primary">
          Inbox
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-caption text-text-muted">
          {requests.length === 0
            ? "Nothing waiting"
            : `${requests.length} waiting on you`}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[620px] flex-col gap-2">
          {requests.length === 0 ? (
            <p className="py-10 text-center text-caption text-text-muted">
              Nothing is waiting on you. Requests addressed to you land here.
            </p>
          ) : (
            requests.map((request) => (
              <InboxRow
                key={request.id}
                request={request}
                onOpen={() => onOpen(request.channelId)}
                onDecide={onDecide}
                busy={busy}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * One waiting item: the row BODY navigates, and the two buttons at its foot
 * DECIDE.
 *
 * ⚠ THE BUTTONS `stopPropagation`, AND THAT IS LOAD-BEARING. They sit inside the
 * `role="button"` row, so without it a Decline would also navigate away from the
 * pane that was about to re-render one row shorter — the operator would land in
 * a channel they never asked for and could not tell whether the decision took.
 *
 * ⚠ THE VERBS ARE THE OUTBOUND/INBOUND PAIR, not two labels for one act: an
 * outbound row is the viewer's OWN agent asking to send (Cancel / Send), an
 * inbound row is a teammate's agent asking to run here (Decline / Launch agent).
 * Both resolve to the same `"deny"` / `"allow"` consent decision.
 */
function InboxRow({
  request,
  onOpen,
  onDecide,
  busy,
}: {
  request: ChannelConsentRequest;
  onOpen: () => void;
  onDecide: (id: string, decision: "allow" | "deny") => void;
  busy: boolean;
}) {
  const outbound = request.kind === "outbound";
  const preview = outbound ? request.proposedReply : request.bodyPreview;
  const requester = request.requesterName ?? "A teammate";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="flex w-full cursor-pointer items-start gap-3 rounded-[10px] border border-border-default bg-bg-inset px-3.5 py-2.5 text-left transition-colors hover:border-border-strong"
    >
      {outbound ? (
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-inset text-text-secondary">
          <Send size={12} />
        </span>
      ) : (
        <Avatar
          person={{
            userId: request.requesterUserId ?? requester,
            email: null,
            displayName: requester,
            avatarUrl: request.requesterAvatarUrl,
          }}
          size="xs"
          className="mt-0.5 shrink-0"
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-caption font-medium text-text-primary">
            {outbound ? "Your agent wants to reply" : `${requester}'s agent is asking`}
          </span>
          <span className="inline-flex shrink-0 items-center rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
            {outbound ? "To send" : "Request"}
          </span>
        </span>
        {request.summary ? (
          <span className="min-w-0 truncate text-caption text-text-secondary">
            {request.summary}
          </span>
        ) : null}
        {preview ? (
          <span className="line-clamp-2 min-w-0 text-caption text-text-muted">
            {preview}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onDecide(request.id, "deny"); }}
            className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
          >
            {outbound ? "Cancel" : "Decline"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onDecide(request.id, "allow"); }}
            className="auth-btn-3d h-7 shrink-0 rounded-[8px] px-3 text-caption font-medium text-white disabled:opacity-60"
          >
            {outbound ? "Send" : "Launch agent"}
          </button>
        </span>
      </span>
    </div>
  );
}
