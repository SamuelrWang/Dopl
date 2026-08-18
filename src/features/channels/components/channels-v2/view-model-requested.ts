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
 * (MAPPING.md § New agent thread). Server-side the state is: a thread whose
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
 * requested state at all. See REFACTOR-FINDINGS F-203.
 *
 * ⚠ Matched on `(channelId, messageSeq)`, not on `messageSeq` alone. `seq` is
 * globally unique today (INVARIANTS §5), so the channel is redundant — and it
 * is exactly the kind of redundancy to keep, because the day it stops being
 * unique this read would silently mark the wrong thread.
 */
export function requestedThreadIds(
  messages: ChannelMessage[],
  consentRequests: ChannelConsentRequest[]
): ReadonlySet<string> {
  const pending = consentRequests.filter(
    (r) => r.kind === "inbound" && r.status === "pending" && r.messageSeq !== null
  );
  if (pending.length === 0) return EMPTY_REQUESTED;
  const keys = new Set(pending.map((r) => `${r.channelId}:${r.messageSeq}`));
  const ids = new Set<string>();
  for (const message of messages) {
    const threadId = threadIdOf(message);
    if (!threadId) continue;
    if (keys.has(`${message.channelId}:${message.seq}`)) ids.add(threadId);
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
 */
export function sidebarThreads(
  threads: ChannelThread[],
  requested: ReadonlySet<string> = EMPTY_REQUESTED,
  now: number = Date.now()
): ChannelThread[] {
  return threads.filter((thread) => {
    if (requested.has(thread.id)) return true;
    if (!thread.lastActivityAt) return false;
    const ts = new Date(thread.lastActivityAt).getTime();
    if (Number.isNaN(ts)) return false;
    return now - ts < SIDEBAR_THREAD_ACTIVE_WINDOW_MS;
  });
}
