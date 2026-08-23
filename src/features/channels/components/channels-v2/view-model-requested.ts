/**
 * Channels v2 — THE OUTBOUND SEND-BOX JOIN: which open thread, if any, is
 * holding a draft this operator's own agent wants to send.
 *
 * Its own file because it has its own reason to change: `view-model.ts` derives
 * ROWS from reads, and this derives a PLACEMENT from a join between two of them
 * (the consent inbox and the transcript).
 *
 * ⚠ THE INBOUND HALF OF THIS FILE IS DELETED (Samuel, 2026-08-22): *"remove all
 * the stuff about declining and approving of threads — you have the thread, you
 * open it, and either you launch agent or you don't."* `requestedThreadIds`,
 * `pendingRequestIdByThread`, `pendingAsksByChannel` and `consentExemptThreadIds`
 * went with the surfaces they fed — the transcript card's Decline / Launch agent
 * pair, `thread-consent.tsx › ThreadAwaitingStrip`, the Inbox's inbound rows, the
 * sidebar's `Clock` glyph and its per-channel ask badge. **There is no
 * `requested` state anywhere in this tree any more**, derived or otherwise, and a
 * reader must not re-derive one: an inbound ask is no longer a thing the operator
 * answers, so nothing may render as if it were. Launching an agent on a thread is
 * a direct act (`use-agents-panel.ts › launchAgent`), not a reply to a request.
 *
 * ⚠ WHAT SURVIVES IS THE OUTBOUND LANE, WHOLE. This operator's OWN agent
 * drafting a reply and waiting on their Send is a different question with a
 * different answer, it is still `pending` on `channel_consent_requests`, and
 * `thread-consent.tsx › ThreadSendBox` still renders it.
 */

import { SIDEBAR_THREAD_ACTIVE_WINDOW_MS } from "../../constants";
import { threadIdOf } from "./view-model";
import type {
  ChannelConsentRequest,
  ChannelMessage,
  ChannelThread,
} from "../../types";

/**
 * THE SEQ-KEYED JOIN ITSELF — thread → the pending consent row that belongs on it.
 *
 * ⚠ FIRST WINS. `messages` arrives in ascending `seq`, so first is the OLDEST
 * unsent draft — the one that has been waiting. Last-wins would silently move the
 * send box onto whichever row arrived most recently, so a Send would dispatch a
 * different draft than the one whose text is on screen.
 *
 * ⚠ BOTH SIDES MUST BE FINITE NUMBERS BEFORE EITHER GOES IN A KEY. `message_seq`
 * is a NULLABLE bigint and a wire row that omits it entirely arrives as
 * `undefined`, which sails through a `!== null` guard and stringifies to
 * `"ch-1:undefined"` — and a message whose own `seq` went missing produces the
 * SAME key and self-matches, placing a draft on a thread because two absences
 * agreed with each other.
 *
 * ⚠ Matched on `(channelId, messageSeq)`, not on `messageSeq` alone. `seq` is
 * globally unique today (INVARIANTS §5), so the channel is redundant — and it is
 * exactly the kind of redundancy to keep, because the day it stops being unique
 * this read would silently place the draft on the wrong thread.
 */
function joinRequestsToThreads(
  messages: ChannelMessage[],
  consentRequests: ChannelConsentRequest[],
  accept: (r: ChannelConsentRequest) => boolean
): ReadonlyMap<string, ChannelConsentRequest> {
  const map = new Map<string, ChannelConsentRequest>();
  const pending = consentRequests.filter((r) => accept(r) && isSeq(r.messageSeq));
  if (pending.length === 0) return map;
  const byKey = new Map(pending.map((r) => [`${r.channelId}:${r.messageSeq}`, r]));
  for (const message of messages) {
    const threadId = threadIdOf(message);
    if (!threadId) continue;
    if (!isSeq(message.seq)) continue;
    const request = byKey.get(`${message.channelId}:${message.seq}`);
    // FIRST wins — see the tie-break note above.
    if (request && !map.has(threadId)) map.set(threadId, request);
  }
  return map;
}

/**
 * THREAD → PENDING OUTBOUND REVIEW, the send-box join (Samuel, 2026-08-20):
 * when this operator's own agent has drafted a reply awaiting their Send, the
 * THREAD VIEW is where the send box renders — the outbound row's `messageSeq`
 * is the TRIGGERING ask's seq, so the seq-keyed join places it on the thread the
 * reply belongs to. A seq-less row maps no thread and stays reachable from the
 * Inbox list only.
 */
export function pendingOutboundByThread(
  messages: ChannelMessage[],
  consentRequests: ChannelConsentRequest[]
): ReadonlyMap<string, ChannelConsentRequest> {
  const joined = joinRequestsToThreads(messages, consentRequests, isPendingOutbound);
  return joined.size === 0 ? EMPTY_OUTBOUND : joined;
}

/**
 * A pending OUTBOUND review — this operator's own agent has drafted a reply and
 * is waiting on their Send.
 *
 * ⚠ IT RE-STATES THE SERVER'S OWN `pending` FILTER rather than trusting it
 * (INVARIANTS §6 — the list read returns pending rows only), for the same reason
 * the seq check does not trust `!= null`.
 *
 * ⚠ IT HAD AN INBOUND TWIN UNTIL 2026-08-22 and deliberately does not any more.
 * `kind === "inbound"` is not a state this tree renders: the addressee's decision
 * lane is deleted, and a helper for it left standing is an invitation to
 * reintroduce the surface.
 */
function isPendingOutbound(r: ChannelConsentRequest): boolean {
  return r.kind === "outbound" && r.status === "pending";
}

/** A usable `seq`. ⚠ Never `!= null`: `undefined` passes that and then
 *  stringifies into a key that matches another absence. */
function isSeq(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Stable identity for the common empty case — this feeds `useMemo` chains, and a
 * fresh `Map` per call is a new reference each render, which is exactly what a
 * downstream `useMemo` dependency compares. The derivation is cheap; the churn it
 * caused downstream was not.
 */
const EMPTY_OUTBOUND: ReadonlyMap<string, ChannelConsentRequest> = new Map<
  string,
  ChannelConsentRequest
>();

/**
 * The threads the SIDEBAR TREE shows: active inside
 * {@link SIDEBAR_THREAD_ACTIVE_WINDOW_MS}.
 *
 * ⚠ THE "OR REQUESTED" ARM IS DELETED (Samuel, 2026-08-22), and so is the
 * seq-less `exempt` arm beside it. Both existed to keep an UNANSWERED ASK
 * reachable past the 24h window — the one thread the operator most needed a way
 * back to while a `pending` inbound row was still live. With no inbound decision
 * to make, there is nothing to keep reachable for: a thread the operator wants is
 * a thread they open, and the window is the only rule left. **Do not restore
 * either arm without restoring the lane they were built for.**
 *
 * ⚠ CLIENT-SIDE arithmetic over `lastActivityAt`, exactly as presence is over
 * `lastSeenAt` (INVARIANTS §5) — the repository read is one plain bounded,
 * activity-ordered list and knows nothing about this window. ABSENT
 * `lastActivityAt` means the read did not derive it, never "no activity", so it
 * reads INACTIVE here: the same fail-safe direction presence has.
 *
 * ⚠ ORDER IS PRESERVED, never re-sorted: the server clipped its page against
 * the activity order, so a re-sorted page is the wrong rows in a plausible
 * order (INVARIANTS §5).
 */
export function sidebarThreads(
  threads: ChannelThread[],
  now: number = Date.now()
): ChannelThread[] {
  return threads.filter((thread) => {
    if (!thread.lastActivityAt) return false;
    const ts = new Date(thread.lastActivityAt).getTime();
    if (Number.isNaN(ts)) return false;
    return now - ts < SIDEBAR_THREAD_ACTIVE_WINDOW_MS;
  });
}
