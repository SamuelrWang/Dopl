"use client";

/**
 * THE THREAD VIEW'S SEND BOX (Samuel, 2026-08-20), split out of
 * `message-pane.tsx` at the 500-line cap — one file per reason to change: this
 * is "the open thread is holding something of mine that has not gone out yet",
 * whole.
 *
 * The operator's OWN agent drafted a reply on this thread and auto-send is off —
 * the draft + Send / Cancel, `launch-panel.tsx › LaunchPanel` in the outbound
 * mode that is now its only mode, deciding on the first click.
 *
 * ⚠ `ThreadAwaitingStrip` STOOD HERE AND IS DELETED (Samuel, 2026-08-22): *"remove
 * all the stuff about declining and approving of threads — you have the thread,
 * you open it, and either you launch agent or you don't."* It was the INBOUND
 * half — "This request is awaiting your answer", Decline / Launch agent under the
 * thread header — and it went with the transcript card's inline pair and the
 * Inbox's inbound rows. **The open thread offers no decision about being asked.**
 * A thread is a thread; the operator either launches an agent on it (the
 * composer's and the Agents tab's direct launch) or does not.
 *
 * ⚠ THE TWO DIRECTIONS WERE NEVER SYMMETRIC AND THAT IS WHY ONE SURVIVED. An
 * inbound ask was somebody else's agent wanting to run on this machine, and
 * Samuel's ruling is that the operator simply decides that by launching or not
 * launching. An OUTBOUND draft is words about to leave under the operator's own
 * name — the last gate before a machine speaks for a human, and nothing about
 * this ruling touches it.
 */

import { LaunchPanel } from "../launch-panel";
import type { ChannelConsentRequest, ChannelThread } from "../../types";

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
