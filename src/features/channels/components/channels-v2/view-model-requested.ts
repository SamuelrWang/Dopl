/**
 * Channels v2 — WHICH THREADS THE VIEWER HAS BEEN ASKED ABOUT, and which ones
 * the sidebar tree therefore shows.
 *
 * Its own file because it has its own reason to change: `view-model.ts` derives
 * ROWS from reads, and this derives an ADMISSION RULE from a join between two
 * of them (the consent inbox and the transcript). It is also the one derivation
 * in this tree that is bounded by what the SERVER will show the caller rather
 * than by what the design asks for — see the asymmetry note below.
 */

import { SIDEBAR_THREAD_ACTIVE_WINDOW_MS } from "../../constants";
import { threadIdOf } from "./view-model";
import type {
  ChannelConsentRequest,
  ChannelMessage,
  ChannelThread,
} from "../../types";

/**
 * THREADS THIS VIEWER HAS BEEN ASKED ABOUT AND HAS NOT ANSWERED — the
 * `requested` state, derived rather than stored.
 *
 * There is no `requested` status on `channel_tasks` and there never was
 * (the port's intent doc § New agent thread, deleted at the Phase 12 cutover —
 * INVARIANTS §5). Server-side the state is: a thread whose
 * addressee's machine raised a consent request that is still `pending`
 * (INVARIANTS §6). This joins the two reads the page already has — the consent
 * inbox and the transcript — on the one column that links them, the triggering
 * message's `seq`.
 *
 * ⚠ ASYMMETRIC BY CONSTRUCTION, AND THAT IS THE FINDING, NOT A BUG HERE. A
 * consent read is scoped to `(operator, workspace)` and the operator is always
 * `ctx.userId` (INVARIANTS §6), so a REQUESTER cannot see whether their
 * addressee has answered — no projection exposes that, and inventing one from
 * "no pending row" would report never-asked as approved. So this returns the
 * threads addressed TO the viewer, and a request the viewer SENT carries no
 * requested state at all. See REFACTOR-FINDINGS F-206.
 *
 * ⚠ Matched on `(channelId, messageSeq)`, not on `messageSeq` alone. `seq` is
 * globally unique today (INVARIANTS §5), so the channel is redundant — and it
 * is exactly the kind of redundancy to keep, because the day it stops being
 * unique this read would silently mark the wrong thread.
 *
 * ⚠ THE SEQ IS COMPARED AS A NUMBER, NOT AS "NOT NULL". `message_seq` is a
 * NULLABLE bigint and the DTO types it `number | null` — but a wire row that
 * omits the key entirely arrives as `undefined`, which sails through a
 * `!== null` guard and then stringifies to the key `"ch-1:undefined"`. A
 * message whose own `seq` ever went absent would produce that SAME key and
 * self-match, marking a thread requested on the strength of two missing values
 * agreeing with each other. Both sides are therefore required to be finite
 * numbers before either is put in a key.
 */
export function requestedThreadIds(
  messages: ChannelMessage[],
  consentRequests: ChannelConsentRequest[]
): ReadonlySet<string> {
  const pending = consentRequests.filter(
    (r) => isPendingInbound(r) && isSeq(r.messageSeq)
  );
  if (pending.length === 0) return EMPTY_REQUESTED;
  const keys = new Set(pending.map((r) => `${r.channelId}:${r.messageSeq}`));
  const ids = new Set<string>();
  for (const message of messages) {
    const threadId = threadIdOf(message);
    if (!threadId) continue;
    if (!isSeq(message.seq)) continue;
    if (keys.has(`${message.channelId}:${message.seq}`)) ids.add(threadId);
  }
  return ids;
}

/**
 * THREAD → PENDING CONSENT-REQUEST ID, the join {@link requestedThreadIds}
 * makes, kept as a MAP so the transcript's request card can carry an inline
 * decision (Samuel, 2026-08-20 — the recipient had no accept affordance
 * anywhere but the Inbox pane, one unmarked nav hop away; F-214's fix).
 * Same seq-keyed join, same honesty rule: a seq-less row maps no thread.
 */
export function pendingRequestIdByThread(
  messages: ChannelMessage[],
  consentRequests: ChannelConsentRequest[]
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const pending = consentRequests.filter(
    (r) => isPendingInbound(r) && isSeq(r.messageSeq)
  );
  if (pending.length === 0) return map;
  const byKey = new Map(
    pending.map((r) => [`${r.channelId}:${r.messageSeq}`, r.id])
  );
  for (const message of messages) {
    const threadId = threadIdOf(message);
    if (!threadId) continue;
    if (!isSeq(message.seq)) continue;
    const id = byKey.get(`${message.channelId}:${message.seq}`);
    if (id) map.set(threadId, id);
  }
  return map;
}

/**
 * THREAD → PENDING OUTBOUND REVIEW, the send-box join (Samuel, 2026-08-20):
 * when this operator's own agent has drafted a reply awaiting their Send, the
 * THREAD VIEW is where the send box renders — the outbound row's `messageSeq`
 * is the TRIGGERING ask's seq, so the same seq-keyed join places it on the
 * thread the reply belongs to. Same honesty rule: a seq-less row maps no
 * thread and stays reachable from the Inbox list only.
 */
export function pendingOutboundByThread(
  messages: ChannelMessage[],
  consentRequests: ChannelConsentRequest[]
): ReadonlyMap<string, ChannelConsentRequest> {
  const map = new Map<string, ChannelConsentRequest>();
  const pending = consentRequests.filter(
    (r) => r.kind === "outbound" && r.status === "pending" && isSeq(r.messageSeq)
  );
  if (pending.length === 0) return map;
  const byKey = new Map(
    pending.map((r) => [`${r.channelId}:${r.messageSeq}`, r])
  );
  for (const message of messages) {
    const threadId = threadIdOf(message);
    if (!threadId) continue;
    if (!isSeq(message.seq)) continue;
    const request = byKey.get(`${message.channelId}:${message.seq}`);
    if (request && !map.has(threadId)) map.set(threadId, request);
  }
  return map;
}

/** A pending INBOUND consent row — the only kind that says "you have been asked
 *  and have not answered". An outbound review is about this operator's own
 *  reply, and a decided row is answered. */
function isPendingInbound(r: ChannelConsentRequest): boolean {
  return r.kind === "inbound" && r.status === "pending";
}

/** A usable `seq`. ⚠ Never `!= null`: `undefined` passes that and then
 *  stringifies into a key that matches another absence. */
function isSeq(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * THREADS A SEQ-LESS PENDING ASK MAKES REACHABLE — the sidebar's window
 * exemption for the requests {@link requestedThreadIds} cannot place.
 *
 * ⚠ WHY THIS IS A SECOND FUNCTION AND NOT A WIDENING OF THE FIRST. A consent
 * row carries NO thread reference of any kind — the table is
 * `(channel_id, workspace_id, operator_user_id, requester_user_id, kind,
 * message_seq, …)` and nothing else links it to `channel_tasks` (migration
 * `20260726100000`). A seq-less row is LEGAL: the de-dupe index is partial on
 * `message_seq IS NOT NULL` precisely because a request raised without a
 * triggering seq has no trigger identity (migration `20260726140000`). So for
 * such a row there is no honest way to say WHICH thread is waiting — and
 * {@link requestedThreadIds} keeps dropping it, because its answer wears the
 * Clock glyph and the words "awaiting your approval", which are an assertion
 * about one thread.
 *
 * ⚠ BUT DROPPING IT TWICE WAS THE BUG. The same set also drives the sidebar's
 * 24h-window exemption, and there the cost of the drop is that the operator has
 * a live pending ask with NO ROW ANYWHERE to walk into once the thread ages
 * out. That is a reachability question, not an assertion, so it can be answered
 * by the join that IS possible: the row names a CHANNEL, a REQUESTER, and the
 * OPERATOR who must decide — and a thread is one requester + one target
 * (INVARIANTS §5). Threads in that channel that this requester opened AND
 * addressed to this operator are the candidate set. It may admit more than one
 * thread, which is exactly why it is kept out of the glyph: showing a reader a
 * row they can open over-claims nothing, and calling that row "awaiting your
 * approval" would.
 *
 * ⚠ A NULL `requesterUserId` (the requester's account was deleted) joins to
 * nothing and is dropped — matching every thread with no `createdBy` is not a
 * join, it is a wildcard.
 */
export function consentExemptThreadIds(
  threads: ChannelThread[],
  consentRequests: ChannelConsentRequest[]
): ReadonlySet<string> {
  const seqless = consentRequests.filter(
    (r) => isPendingInbound(r) && !isSeq(r.messageSeq) && r.requesterUserId !== null
  );
  if (seqless.length === 0) return EMPTY_REQUESTED;
  const ids = new Set<string>();
  for (const thread of threads) {
    const named = seqless.some(
      (r) =>
        r.channelId === thread.channelId &&
        r.requesterUserId === thread.createdBy &&
        r.operatorUserId === thread.targetUserId
    );
    if (named) ids.add(thread.id);
  }
  return ids;
}

/** Stable identity for the common empty case — these feed `useMemo` chains. */
const EMPTY_REQUESTED: ReadonlySet<string> = new Set<string>();

/**
 * The threads the SIDEBAR TREE shows: active inside
 * {@link SIDEBAR_THREAD_ACTIVE_WINDOW_MS} **OR requested** (Samuel,
 * 2026-08-18 — the ruling's full text).
 *
 * ⚠ CLIENT-SIDE arithmetic over `lastActivityAt`, exactly as presence is over
 * `lastSeenAt` (INVARIANTS §5) — the repository read is one plain bounded,
 * activity-ordered list and knows nothing about this window. ABSENT
 * `lastActivityAt` means the read did not derive it, never "no activity", so it
 * reads INACTIVE here: the same fail-safe direction presence has.
 *
 * ⚠ THE REQUESTED ARM IS WHAT KEEPS AN UNANSWERED ASK REACHABLE. A request
 * raised more than 24h ago that the viewer never answered would otherwise fall
 * out of the tree while its consent row is still live — the one thread they
 * most need a way back to. It is derived from the viewer's OWN consent inbox
 * ({@link requestedThreadIds}), so it only ever admits threads addressed to
 * them; a request they SENT ages out on the window alone.
 *
 * ⚠ ORDER IS PRESERVED, never re-sorted: the server clipped its page against
 * the activity order, so a re-sorted page is the wrong rows in a plausible
 * order (INVARIANTS §5).
 *
 * ⚠ `exempt` IS THE SAME ARM WITH A WEAKER CLAIM ({@link consentExemptThreadIds}):
 * a seq-less pending ask cannot name its thread, so those threads are made
 * REACHABLE here without being marked requested anywhere the reader can see. It
 * is deliberately a separate argument rather than unioned into `requested` by
 * the caller — the union would put a Clock glyph on every candidate.
 */
export function sidebarThreads(
  threads: ChannelThread[],
  requested: ReadonlySet<string> = EMPTY_REQUESTED,
  now: number = Date.now(),
  exempt: ReadonlySet<string> = EMPTY_REQUESTED
): ChannelThread[] {
  return threads.filter((thread) => {
    if (requested.has(thread.id)) return true;
    if (exempt.has(thread.id)) return true;
    if (!thread.lastActivityAt) return false;
    const ts = new Date(thread.lastActivityAt).getTime();
    if (Number.isNaN(ts)) return false;
    return now - ts < SIDEBAR_THREAD_ACTIVE_WINDOW_MS;
  });
}
