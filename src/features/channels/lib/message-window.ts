import type { ChannelMessage } from "../types";

/**
 * THE TRANSCRIPT'S SCROLL-BACK WINDOW, as pure data — what "the newest page plus
 * N pages of history" is, how a fetched page joins it, and the one question that
 * decides whether the join is still honest.
 *
 * Split from `hooks/use-channel-messages.ts` for the reason `optimistic-cache.ts`
 * is split from the write hooks: these are the rules that decide whether the
 * reader sees a HOLE in their own history, and they are testable with no React,
 * no DOM and no network.
 *
 * ⚠ **THE HISTORY LIVES HERE, NOT IN THE QUERY CACHE, AND THE REASON IS §8.**
 * The obvious shape — one `?before=` cache entry per page under the messages
 * path — puts every page under the SAME prefix key the optimistic writes patch
 * (`use-thread-writes-shared.ts › messagesKey` is `channelKeys.messages(id).all`,
 * and TanStack matches by array prefix). Every send would then append its pending
 * row into every loaded page of history, at a `nextSeq` derived from THAT page's
 * maximum — i.e. the message you just typed rendered in the middle of last
 * week. The newest page stays the one cache entry; history is immutable and is
 * carried beside it.
 *
 * ⚠ THE COST OF THAT CHOICE, STATED: a patch that reaches the cache entry does
 * NOT reach this window. The one that matters is the thread DELETE
 * (`optimistic-cache.ts › dropThreadMessages`), so {@link dropThreadFromWindow}
 * exists and the delete write calls it. Anything else added to that family needs
 * the same treatment or it will be half-applied.
 */

/**
 * ⚠ A SHARED FROZEN EMPTY, not a fresh `[]`. The merge below is memoised on this
 * array's identity, so a new one per render would rebuild the transcript's rows
 * on every keystroke in the composer.
 */
const NO_MESSAGES: readonly ChannelMessage[] = Object.freeze([]);

export interface MessageWindow {
  /** Pages older than {@link boundarySeq}, ascending, oldest page first. */
  readonly older: readonly ChannelMessage[];
  /**
   * THE SEQ THE FIRST OLDER PAGE WAS REQUESTED `before` — i.e. where the newest
   * page's oldest row stood at that moment. `null` while no history is loaded.
   *
   * ⚠ IT IS THE CONTIGUITY WITNESS, and it is why the window remembers a number
   * it never renders. See {@link isContiguous}.
   */
  readonly boundarySeq: number | null;
  /** A page came back SHORT: the channel's oldest message is loaded. */
  readonly exhausted: boolean;
}

export const EMPTY_MESSAGE_WINDOW: MessageWindow = Object.freeze({
  older: NO_MESSAGES,
  boundarySeq: null,
  exhausted: false,
});

/** The lowest `seq` in an ascending page, or `null` for an empty one. */
export function oldestSeq(page: readonly ChannelMessage[]): number | null {
  let min: number | null = null;
  for (const message of page) {
    if (min === null || message.seq < min) min = message.seq;
  }
  return min;
}

/**
 * IS THE LOADED SET STILL ONE UNBROKEN STRETCH?
 *
 * The window covers everything below `boundarySeq`; the newest page covers
 * `[page.min, page.max]`. They join iff the page still reaches back AT LEAST to
 * where the boundary was drawn — `page.min <= boundarySeq`.
 *
 * ⚠ **THE FAILING CASE IS REAL, NOT THEORETICAL.** The newest page is refetched
 * on every realtime doorbell and always returns the newest `limit` rows, so its
 * `min` walks FORWARD as messages arrive. Land more than a page of messages
 * between two paints — a working agent posting `task_progress` will do it — and
 * `page.min` steps past the boundary, leaving messages that neither half holds.
 * Concatenating anyway renders that gap as if it were not there: two adjacent
 * rows, minutes apart, with the conversation between them missing and nothing
 * saying so.
 *
 * ⚠ **A `seq` GAP IS NOT EVIDENCE OF A MISSING ROW** — `channel_messages.seq` is
 * a TABLE-wide identity (INVARIANTS §5), so consecutive posts in one channel are
 * never consecutive numbers. That is exactly why the witness is a REMEMBERED
 * cursor rather than arithmetic over the rows on hand.
 */
export function isContiguous(
  window: MessageWindow,
  page: readonly ChannelMessage[]
): boolean {
  if (window.boundarySeq === null) return true;
  const min = oldestSeq(page);
  // An empty newest page cannot have outrun anything.
  return min === null || min <= window.boundarySeq;
}

/**
 * The rows to render: history, then the newest page, deduplicated by id with the
 * PAGE's copy winning.
 *
 * ⚠ THE PAGE WINS ON PURPOSE. It is the entry the optimistic writes patch and
 * the doorbell refetches, so its copy of a row is the fresher one; a duplicate
 * can only arise when a `before` page overlapped the newest page, which happens
 * whenever a message lands between the cursor being read and the request going
 * out.
 *
 * ⚠ ASCENDING BY `seq`, and pending rows sort LAST by construction —
 * `optimistic-cache.ts › buildPendingMessage` stamps `max(seq) + 1` over the
 * whole cache entry.
 */
export function mergeWindow(
  window: MessageWindow,
  page: readonly ChannelMessage[]
): ChannelMessage[] {
  if (window.older.length === 0) return page.slice();
  const byId = new Map<string, ChannelMessage>();
  for (const message of window.older) byId.set(message.id, message);
  for (const message of page) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Fold one fetched `before` page into the window.
 *
 * `requestedBefore` is the cursor the page was asked for and becomes the
 * boundary witness on the FIRST page only — later pages extend the window
 * downward and must not move a witness that describes its TOP edge.
 *
 * ⚠ `exhausted` LATCHES. A page shorter than what was asked for means the
 * channel ran out; a later page cannot un-run-out.
 */
export function appendOlderPage(
  window: MessageWindow,
  page: readonly ChannelMessage[],
  requestedBefore: number,
  limit: number
): MessageWindow {
  return {
    older: page.length === 0 ? window.older : [...page, ...window.older],
    boundarySeq: window.boundarySeq ?? requestedBefore,
    exhausted: window.exhausted || page.length < limit,
  };
}

/**
 * Drop every history row tagged for one thread — the window's half of the thread
 * DELETE's optimistic patch (`optimistic-cache.ts › dropThreadMessages` is the
 * cache entry's half).
 *
 * ⚠ BOTH HALVES OR NEITHER, for the same reason that function's docblock gives:
 * the server deletes the thread's whole transcript in one call, and a reader
 * scrolled back through history would otherwise keep rendering the deleted rows
 * under a card that no longer exists until they switched channels.
 *
 * ⚠ THE TAG IS READ FROM THE WIRE KEY `metadata.taskId`, exactly as the server
 * matches it — never from a domain field, because there is not one.
 *
 * ⚠ Returns the SAME window when nothing matched, so a delete in an unrelated
 * thread does not invalidate the merge memo.
 */
export function dropThreadFromWindow(
  window: MessageWindow,
  threadId: string
): MessageWindow {
  const kept = window.older.filter((m) => m.metadata?.taskId !== threadId);
  if (kept.length === window.older.length) return window;
  return { ...window, older: kept };
}
