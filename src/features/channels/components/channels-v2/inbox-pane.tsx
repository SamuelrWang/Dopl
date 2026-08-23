"use client";

/**
 * Channels v2 — THE INBOX, in the center column: every DRAFT this operator's own
 * agent is holding, waiting on their Send. The row BODY navigates to its channel,
 * and the row also DECIDES.
 *
 * ⚠ IT IS OUTBOUND-ONLY SINCE 2026-08-22 (Samuel): *"remove all the stuff about
 * declining and approving of threads — you have the thread, you open it, and
 * either you launch agent or you don't."* The INBOUND rows — a teammate's agent
 * asking to run here, Decline / Launch agent — are DELETED, along with the
 * transcript card's inline pair and `thread-consent.tsx › ThreadAwaitingStrip`.
 * **This pane no longer has a "last resort" job**, because the thing it was the
 * last resort FOR does not exist: an unplaceable inbound row was a hung agent
 * only while somebody had to answer it. What is left is one lane with one verb
 * pair, Cancel / Send.
 *
 * ⚠ THE SURVIVING LANE IS STILL A REAL DECISION SURFACE, and it is the LAST one.
 * An outbound row whose `message_seq` is absent — or whose triggering message is
 * below the transcript read's ceiling — cannot be placed on a thread by
 * `view-model-requested.ts › pendingOutboundByThread`, so the thread view's send
 * box never renders it. This pane is where those drafts are reachable, and a
 * draft nobody can send is an agent that never finishes. Same CAS'd
 * `PATCH /consent/[id]` as the send box.
 *
 * ⚠ NO LAUNCH SETTINGS ON THIS SURFACE, and none anywhere else either: the
 * single-use ARM the launch panel used to expand into is DELETED (2026-08-20).
 * What survives is the DURABLE launch posture on the channel's Settings tab
 * (`settings-agent.tsx`).
 *
 * ⚠ THIS IS THE OPERATOR'S OWN SIDE, and it is the only side that exists. A
 * consent read is scoped to `(operator, workspace)` with the operator always
 * `ctx.userId` (INVARIANTS §6). What is listed is what you owe a send on.
 *
 * ⚠ NO NEW READ. The rows are the page's existing `use-consent-inbox` result —
 * its `outbound` slice, the same array the sidebar's Inbox badge counts.
 * Deliberately WORKSPACE-WIDE, not scoped to the open channel: it is a landing
 * spot, and a pending draft may name any channel.
 */

import { Inbox, Send } from "lucide-react";
import type { ChannelConsentRequest } from "../../types";

export function ChannelsV2InboxPane({
  requests,
  onOpen,
  onDecide,
  busy = false,
}: {
  /** The viewer's pending OUTBOUND drafts, workspace-wide — the same array the
   *  sidebar's Inbox badge counts. */
  requests: ChannelConsentRequest[];
  /** Navigate to the row's channel (the row body's click). */
  onOpen: (channelId: string) => void;
  /** The CAS'd consent decision — the last-resort home for unplaceable drafts. */
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
              Nothing is waiting on you. Replies your agent drafts land here.
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
 * One waiting draft: the row BODY navigates, and the two buttons at its foot
 * DECIDE.
 *
 * ⚠ THE BUTTONS `stopPropagation`, AND THAT IS LOAD-BEARING. They sit inside the
 * `role="button"` row, so without it a Cancel would also navigate away from the
 * pane that was about to re-render one row shorter — the operator would land in
 * a channel they never asked for and could not tell whether the decision took.
 *
 * ⚠ ONE VERB PAIR, BECAUSE THERE IS ONE LANE (2026-08-22). This row branched on
 * `kind` and rendered Decline / Launch agent for an inbound ask; that half is
 * deleted with the rest of the inbound surfaces. `"deny"` / `"allow"` are still
 * the wire values — Cancel and Send are what they MEAN when the draft is the
 * operator's own.
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
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="flex w-full cursor-pointer items-start gap-3 rounded-[10px] border border-border-default bg-bg-inset px-3.5 py-2.5 text-left transition-colors hover:border-border-strong"
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-default bg-bg-inset text-text-secondary">
        <Send size={12} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-caption font-medium text-text-primary">
            Your agent wants to reply
          </span>
          <span className="inline-flex shrink-0 items-center rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium uppercase tracking-wide text-text-secondary">
            To send
          </span>
        </span>
        {request.summary ? (
          <span className="min-w-0 truncate text-caption text-text-secondary">
            {request.summary}
          </span>
        ) : null}
        {request.proposedReply ? (
          <span className="line-clamp-2 min-w-0 text-caption text-text-muted">
            {request.proposedReply}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onDecide(request.id, "deny"); }}
            className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onDecide(request.id, "allow"); }}
            className="auth-btn-3d h-7 shrink-0 rounded-[8px] px-3 text-caption font-medium text-white disabled:opacity-60"
          >
            Send
          </button>
        </span>
      </span>
    </div>
  );
}
