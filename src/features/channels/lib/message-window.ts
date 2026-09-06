import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";

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
 *
 * ⚠ **AND SINCE 2026-09-06 IT ALSO CARRIES THE ARTIFACT ENVELOPE'S CLIENT-SIDE
 * INVARIANT: `entries` MUST BE TOTAL OVER THE `messages` ARRAY IT IS PASSED
 * BESIDE** ({@link mergeEntries}). The server guarantees that PER PAGE —
 * `readTranscript` folds the page it just read — and this file is where the
 * guarantee is re-established over an array the server never saw: the newest
 * page, plus N pages of history, plus whatever the optimistic writes have
 * patched in. Read {@link mergeEntries} before touching anything here.
 */

/**
 * ⚠ A SHARED FROZEN EMPTY, not a fresh `[]`. The merge below is memoised on this
 * array's identity, so a new one per render would rebuild the transcript's rows
 * on every keystroke in the composer.
 */
const NO_MESSAGES: readonly ChannelMessage[] = Object.freeze([]);

/** The same trick, for the same reason, on {@link MessageWindow.artifacts}. */
const NO_ARTIFACTS: readonly ChannelFoldedArtifact[] = Object.freeze([]);

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
  /**
   * EVERY FOLDED ARTIFACT THE HISTORY PAGES DESCRIBED, deduped by artifact id.
   *
   * ⚠ **THE CARDS ARE KEPT AND THE PAGES' MESSAGE ARMS ARE NOT, AND THAT
   * ASYMMETRY IS THE WHOLE TOTALIZING RULE** ({@link mergeEntries}). A card is a
   * fact about the CHANNEL — `count`, `firstSeq` and `lastSeq` are channel-wide
   * by `ChannelFoldedArtifact`'s own contract, never per page — so one page's
   * copy is interchangeable with another's and survives a merge unchanged. A
   * message arm is a fact about ONE page's array and cannot survive being stood
   * beside another page's at all.
   */
  readonly artifacts: readonly ChannelFoldedArtifact[];
}

export const EMPTY_MESSAGE_WINDOW: MessageWindow = Object.freeze({
  older: NO_MESSAGES,
  boundarySeq: null,
  exhausted: false,
  artifacts: NO_ARTIFACTS,
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
 *
 * ⚠ `entries` IS THE PAGE'S ENVELOPE AND DEFAULTS TO `null`, which is both the
 * ordinary answer ("nothing on this page is folded") and the answer from a build
 * that cannot fold at all. Only its CARDS are kept — see
 * {@link MessageWindow.artifacts}.
 */
export function appendOlderPage(
  window: MessageWindow,
  page: readonly ChannelMessage[],
  requestedBefore: number,
  limit: number,
  entries: readonly ChannelReadEntry[] | null = null
): MessageWindow {
  return {
    older: page.length === 0 ? window.older : [...page, ...window.older],
    boundarySeq: window.boundarySeq ?? requestedBefore,
    exhausted: window.exhausted || page.length < limit,
    artifacts: addArtifacts(window.artifacts, foldedArtifactsOf(entries)),
  };
}

/**
 * The CARDS out of one page's envelope, in order — `null` in, nothing out.
 *
 * ⚠ RETURNS THE SHARED EMPTY when nothing folded, so an ordinary channel hands
 * {@link mergeEntries} the same array identity on every render and the memo above
 * it never moves. That is the common case and it must stay free.
 */
export function foldedArtifactsOf(
  entries: readonly ChannelReadEntry[] | null
): readonly ChannelFoldedArtifact[] {
  if (entries === null) return NO_ARTIFACTS;
  const out: ChannelFoldedArtifact[] = [];
  for (const entry of entries) {
    if (entry.type === "artifact") out.push(entry.folded);
  }
  return out.length === 0 ? NO_ARTIFACTS : out;
}

/**
 * Fold a page's cards into the ones already held, FIRST COPY WINNING.
 *
 * ⚠ Returns the SAME array when nothing is new, for `dropThreadFromWindow`'s
 * identity reason: the entry merge downstream is memoised on it.
 */
function addArtifacts(
  held: readonly ChannelFoldedArtifact[],
  incoming: readonly ChannelFoldedArtifact[]
): readonly ChannelFoldedArtifact[] {
  if (incoming.length === 0) return held;
  const seen = new Set(held.map((f) => f.artifact.id));
  const added = incoming.filter((f) => !seen.has(f.artifact.id));
  return added.length === 0 ? held : [...held, ...added];
}

/**
 * 🔒 **THE ENVELOPE FOR THE MERGED TRANSCRIPT — the one function that makes
 * `entries` TOTAL over the `messages` array it is passed beside** (A4, ruled
 * option (a): totalize and dedupe).
 *
 * The server folds ONE page and its `entries` describes exactly that page. The
 * transcript renders the newest page PLUS every scrolled-back history page PLUS
 * whatever the optimistic writes have patched in, and
 * `channels-v2/derivations.ts` builds its ordinary rows from the message arms
 * ALONE. So handing it any single page's envelope beside that array drops every
 * row the envelope does not mention. This rebuilds the envelope over the array
 * that is actually being rendered.
 *
 * ⚠ **THE MESSAGE ARMS ARE SYNTHESIZED FROM `messages`, NEVER CARRIED FROM A
 * PAGE, AND THAT IS THE DEVIATION FROM THE RULING WORTH RATIFYING.** The ruled
 * rule was per-page `entries ?? messages.map(→ message arm)` concatenated, with
 * the optimistic patch family maintaining the newest page's arms. That family is
 * BIGGER than the calls the ruling named — `appendPendingMessage`,
 * `reconcileMessage`, `retagPendingMessage` and `dropThreadMessages` in
 * `optimistic-cache.ts`, plus `use-escalation-writes.ts › reconcileAnswer`, a
 * local copy outside that file entirely — so maintaining the arms means five
 * places that must each stay in step forever, and the fifth is outside this
 * slice's scope. Synthesizing them instead makes the invariant hold BY
 * CONSTRUCTION for any `messages` array whatsoever, including one no patch
 * author remembered this rule existed for. Same output on a page the server
 * folded; no halves to keep in step.
 *
 * ⚠ **THE DEDUPE IS SAFE FOR A REASON THAT MUST BE RECORDED RATHER THAN
 * ASSUMED** (the ruling's own instruction): two pages' `ChannelFoldedArtifact`
 * for one artifact are IDENTICAL — `count`, `firstSeq` and `lastSeq` are
 * channel-wide by that type's contract, "never over the page" — and
 * `view-model-artifacts.ts › artifactRowFor` recomputes the card's MEMBERS off
 * the merged `messages` anyway. So this is a de-duplication, not a
 * reconciliation, and there is nothing for a first-copy-wins rule to lose.
 *
 * ⚠ **A MESSAGE IS FOLDED IFF ITS `artifactId` NAMES A CARD WE ACTUALLY HOLD** —
 * never merely because the field is set. That is the server's own DEGRADE rule
 * (`server/service-artifacts.ts`: a span whose card row is missing degrades to a
 * message, never to a dropped row) restated on the client, and it is why a page
 * that arrives with `entries: null` while its rows carry `artifactId` renders
 * every one of them as an ordinary message.
 *
 * ⚠ **`null` OUT MEANS "NOTHING HERE IS FOLDED" AND IS THE ORDINARY CASE**, byte
 * for byte the behaviour that shipped before artifacts existed. It is also the
 * answer when every member of every known card has left `messages` — a thread
 * delete taking the last one with it — which is how the delete reaches BOTH
 * halves of the state without the patch family learning a second key: no member,
 * no card, no ghost.
 */
export function mergeEntries(
  messages: readonly ChannelMessage[],
  windowArtifacts: readonly ChannelFoldedArtifact[],
  pageArtifacts: readonly ChannelFoldedArtifact[]
): ChannelReadEntry[] | null {
  if (windowArtifacts.length === 0 && pageArtifacts.length === 0) return null;
  const byId = new Map<string, ChannelFoldedArtifact>();
  for (const folded of windowArtifacts) {
    if (!byId.has(folded.artifact.id)) byId.set(folded.artifact.id, folded);
  }
  for (const folded of pageArtifacts) {
    if (!byId.has(folded.artifact.id)) byId.set(folded.artifact.id, folded);
  }

  // ⚠ THE CARD'S POSITION IS ITS LOWEST MEMBER ON THE MERGED ARRAY, which is the
  // same rule `artifactRowFor` applies and the reason the card does not park at
  // the top of a back-page. Entry ORDER is not load-bearing for the card itself
  // (`withArtifactCards` re-sorts by seq), but it IS for the message arms, which
  // `unfoldedMessages` hands to `channelRows` in the order it finds them.
  const anchors = new Map<string, number>();
  const arms: Array<{ seq: number; entry: ChannelReadEntry }> = [];
  for (const message of messages) {
    const id = message.artifactId ?? null;
    const folded = id === null ? undefined : byId.get(id);
    if (folded === undefined) {
      arms.push({ seq: message.seq, entry: { type: "message", message } });
      continue;
    }
    const anchored = anchors.get(id as string);
    if (anchored === undefined || message.seq < anchored) {
      anchors.set(id as string, message.seq);
    }
  }
  if (anchors.size === 0) return null;
  for (const [id, seq] of anchors) {
    const folded = byId.get(id) as ChannelFoldedArtifact;
    arms.push({ seq, entry: { type: "artifact", folded } });
  }
  return arms.sort((a, b) => a.seq - b.seq).map((arm) => arm.entry);
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
 *
 * ⚠ **IT DOES NOT PRUNE `artifacts`, AND IT MUST NOT.** A card whose last member
 * left the transcript stops being emitted by {@link mergeEntries} on its own —
 * the card is derived from members PRESENT, not from a list kept in step — so
 * pruning here would be a second rule saying the same thing, free to disagree.
 */
export function dropThreadFromWindow(
  window: MessageWindow,
  threadId: string
): MessageWindow {
  const kept = window.older.filter((m) => m.metadata?.taskId !== threadId);
  if (kept.length === window.older.length) return window;
  return { ...window, older: kept };
}
