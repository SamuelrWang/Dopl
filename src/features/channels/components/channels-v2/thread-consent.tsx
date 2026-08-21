"use client";

/**
 * THE THREAD VIEW'S TWO CONSENT SURFACES (Samuel, 2026-08-20), split out of
 * `message-pane.tsx` at the 500-line cap — one file per reason to change:
 * this is "the open thread owes or offers a decision", whole.
 *
 * - **The awaiting strip** (under the header): the viewer was ASKED on this
 *   thread and has not answered — Launch agent / Decline, the same CAS'd
 *   consent mutation the transcript card uses. Nothing FLOATS: the arrival
 *   pop-up is deleted, so a decision is made where the thread already is.
 * - **The send box** (above the composer): this operator's OWN agent drafted
 *   a reply on this thread and auto-send is off — the draft + Send/Cancel,
 *   the Inbox's old `LaunchPanel` in its outbound mode, deciding on the
 *   first click.
 *
 * ⚠ THESE TWO ARE NOT THE ONLY DECISION SURFACES. `inbox-pane.tsx › InboxRow`
 * decides as well, on the same CAS'd `PATCH /consent/[id]`, and it has to: both
 * surfaces here need a row the seq→thread join could PLACE onto this open
 * thread, and the Inbox is the durable home of last resort for the ones it could
 * not (untagged triggers, aged-out pages, seq-less outbound drafts). It is not a
 * passive list. A row no surface can decide is a hung agent, which is the whole
 * reason the third one exists.
 */

import { LaunchPanel } from "../launch-panel";
import type { ChannelConsentRequest, ChannelThread } from "../../types";

export function ThreadAwaitingStrip({
  thread,
  requested,
  onDecideThread,
}: {
  thread: ChannelThread | null;
  requested: ReadonlySet<string>;
  onDecideThread: (threadId: string, decision: "allow" | "deny") => void;
}) {
  if (!thread || !requested.has(thread.id)) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-card-surface-subtle px-6 py-1.5">
      <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
        This request is awaiting your answer.
      </span>
      <button
        type="button"
        onClick={() => onDecideThread(thread.id, "deny")}
        className="btn-light shrink-0 rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary"
      >
        Decline
      </button>
      <button
        type="button"
        onClick={() => onDecideThread(thread.id, "allow")}
        className="auth-btn-3d h-7 shrink-0 rounded-[8px] px-3 text-caption font-medium text-white"
      >
        Launch agent
      </button>
    </div>
  );
}

export function ThreadSendBox({
  thread,
  outboundAsk,
  busy,
  onDecide,
}: {
  thread: ChannelThread | null;
  outboundAsk: ChannelConsentRequest | null;
  busy: boolean;
  onDecide: (id: string, decision: "allow" | "deny") => void;
}) {
  if (!thread || !outboundAsk) return null;
  return (
    <div className="shrink-0 border-t border-border-subtle px-8 py-3">
      <LaunchPanel
        request={outboundAsk}
        busy={busy}
        onLaunch={() => onDecide(outboundAsk.id, "allow")}
        onDecline={() => onDecide(outboundAsk.id, "deny")}
      />
    </div>
  );
}
