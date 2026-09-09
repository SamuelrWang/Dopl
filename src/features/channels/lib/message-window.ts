import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";

/**
 * THE TRANSCRIPT'S SCROLL-BACK WINDOW, as pure data — split from
 * `hooks/use-channel-messages.ts` so these rules are testable with no React, no
 * DOM and no network.
 *
 * ⚠ **THE HISTORY LIVES HERE, NOT IN THE QUERY CACHE, AND THE REASON IS §8.** A
 * `?before=` cache entry per page sits under the SAME prefix key the optimistic
 * writes patch (`use-thread-writes-shared.ts › messagesKey` is
 * `channelKeys.messages(id).all`, matched by array prefix), so every send would
 * append its pending row into every loaded page, at a `nextSeq` derived from THAT
 * page's maximum — the message you just typed rendered in the middle of last week.
 * ⚠ THE COST: a patch that reaches the cache entry does NOT reach this window, so
 * the thread DELETE calls {@link dropThreadFromWindow} explicitly and anything
 * added to that family needs the same treatment.
 *
 * ⚠ **SINCE 2026-09-06 IT ALSO CARRIES THE ARTIFACT ENVELOPE'S CLIENT-SIDE
 * INVARIANT: `entries` MUST BE TOTAL OVER THE `messages` ARRAY IT IS PASSED
 * BESIDE** ({@link mergeEntries} — read it before touching anything here). The
 * server guarantees that PER PAGE; this file re-establishes it over an array the
 * server never saw.
 */

/**
 * ⚠ A SHARED FROZEN EMPTY, not a fresh `[]`. The merge below is memoised on this
 * array's identity; a new one per render would rebuild the transcript's rows on
 * every keystroke in the composer.
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
  /**
   * THE SERVER SAID THERE IS NOTHING OLDER: the channel's oldest message is
   * loaded.
   *
   * ⚠ **DERIVED FROM THE ROUTE'S `hasMore`, NEVER FROM `page.length` (2026-09-08)**
   * — the transcript pages by an ESTIMATED-LINE budget (`constants.ts ›
   * CHANNEL_TRANSCRIPT_LINE_BUDGET`), so a page is SHORT BY DESIGN. See
   * {@link appendOlderPage}.
   */
  readonly exhausted: boolean;
  /**
   * EVERY FOLDED ARTIFACT THE HISTORY PAGES DESCRIBED, deduped by artifact id.
   *
   * ⚠ **THE CARDS ARE KEPT AND THE PAGES' MESSAGE ARMS ARE NOT, AND THAT
   * ASYMMETRY IS THE WHOLE TOTALIZING RULE** ({@link mergeEntries}). A card is a
   * fact about the CHANNEL — `count`, `firstSeq` and `lastSeq` are channel-wide
   * by `ChannelFoldedArtifact`'s own contract — so one page's copy survives a
   * merge unchanged; a message arm is a fact about ONE page's array and does not.
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
 * on every realtime doorbell, so its `min` walks FORWARD. Land more than a page
 * between two paints — a working agent posting `task_progress` will — and
 * `page.min` steps past the boundary; concatenating anyway renders the gap as two
 * adjacent rows, minutes apart, with nothing saying so.
 *
 * ⚠ **A `seq` GAP IS NOT EVIDENCE OF A MISSING ROW** — `channel_messages.seq` is
 * a TABLE-wide identity (INVARIANTS §5), which is why the witness is a REMEMBERED
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
 * ⚠ THE PAGE WINS ON PURPOSE: it is the entry the optimistic writes patch and the
 * doorbell refetches, so its copy is the fresher one. A duplicate arises only
 * when a `before` page overlapped the newest page — a message landing between the
 * cursor being read and the request going out.
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
 * ⚠ **`hasMore` IS THE SERVER'S, AND THAT IS THE WHOLE CHANGE OF 2026-09-08** —
 * `exhausted` came from `page.length < limit` until paging moved to ESTIMATED
 * LINES (`lib/transcript-line-budget.ts`), which made a short page the NORMAL
 * page and reported a channel of long messages as exhausted after its first
 * screen. The route says so directly now (`server/service-reads.ts ›
 * readTranscript`).
 *
 * ⚠ **AN EMPTY PAGE EXHAUSTS THE WINDOW WHATEVER `hasMore` SAYS** — only reachable
 * from a pre-flag payload, where the `?? true` fallback would otherwise re-ask for
 * the same empty page forever. ⚠ `exhausted` LATCHES: a later page cannot
 * un-run-out.
 *
 * ⚠ `entries` DEFAULTS TO `null` — both the ordinary answer ("nothing on this page
 * is folded") and a build that cannot fold. Only its CARDS are kept
 * ({@link MessageWindow.artifacts}).
 */
export function appendOlderPage(
  window: MessageWindow,
  page: readonly ChannelMessage[],
  requestedBefore: number,
  hasMore: boolean,
  entries: readonly ChannelReadEntry[] | null = null
): MessageWindow {
  return {
    older: page.length === 0 ? window.older : [...page, ...window.older],
    boundarySeq: window.boundarySeq ?? requestedBefore,
    exhausted: window.exhausted || !hasMore || page.length === 0,
    artifacts: addArtifacts(window.artifacts, foldedArtifactsOf(entries)),
  };
}

/**
 * The CARDS out of one page's envelope, in order — `null` in, nothing out.
 *
 * ⚠ RETURNS THE SHARED EMPTY when nothing folded, so an ordinary channel hands
 * {@link mergeEntries} the same array identity every render — the common case,
 * and it must stay free.
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
 * The server folds ONE page; the transcript renders that page PLUS history PLUS
 * every optimistic patch, and `channels-v2/derivations.ts` builds its rows from
 * the message arms ALONE — so one page's envelope beside that array drops every
 * row it does not mention.
 *
 * ⚠ **THE MESSAGE ARMS ARE SYNTHESIZED FROM `messages`, NEVER CARRIED FROM A
 * PAGE — THE DEVIATION FROM THE RULING WORTH RATIFYING.** The ruled rule had the
 * optimistic patch family maintain the arms; that family is five call sites (four
 * in `optimistic-cache.ts`, plus `use-escalation-writes.ts › reconcileAnswer`
 * outside this slice) that would each have to stay in step forever. Synthesizing
 * makes the invariant hold BY CONSTRUCTION, with the same output on a folded page.
 *
 * ⚠ **THE DEDUPE IS SAFE FOR A REASON THAT MUST BE RECORDED RATHER THAN
 * ASSUMED** (the ruling's own instruction): two pages' `ChannelFoldedArtifact`
 * for one artifact are IDENTICAL — `count`, `firstSeq` and `lastSeq` are
 * channel-wide by that type's contract — and `view-model-artifacts.ts ›
 * artifactRowFor` recomputes the card's MEMBERS off the merged `messages` anyway.
 *
 * ⚠ **A MESSAGE IS FOLDED IFF ITS `artifactId` NAMES A CARD WE ACTUALLY HOLD** —
 * never merely because the field is set. The server's own DEGRADE rule
 * (`server/service-artifacts.ts`), restated on the client.
 *
 * ⚠ **`null` OUT MEANS "NOTHING HERE IS FOLDED" AND IS THE ORDINARY CASE.** It is
 * also the answer when every member of every known card has left `messages` (a
 * thread delete taking the last one), which is how that delete reaches BOTH halves
 * of the state without the patch family learning a second key.
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

  // ⚠ THE CARD'S POSITION IS ITS LOWEST MEMBER ON THE MERGED ARRAY — the rule
  // `artifactRowFor` applies, and why the card does not park at the top of a
  // back-page. Entry ORDER is not load-bearing for the card (`withArtifactCards`
  // re-sorts by seq) but IS for the message arms, which `unfoldedMessages` hands
  // to `channelRows` in the order it finds them.
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
 * ⚠ BOTH HALVES OR NEITHER: the server deletes the thread's whole transcript in
 * one call, and a reader scrolled back would otherwise keep rendering the deleted
 * rows until they switched channels.
 *
 * ⚠ THE TAG IS READ FROM THE WIRE KEY `metadata.taskId`, exactly as the server
 * matches it — never from a domain field, because there is not one.
 *
 * ⚠ Returns the SAME window when nothing matched, so a delete in an unrelated
 * thread does not invalidate the merge memo.
 *
 * ⚠ **IT DOES NOT PRUNE `artifacts`, AND IT MUST NOT.** A card whose last member
 * left stops being emitted by {@link mergeEntries} on its own, so pruning here
 * would be a second rule saying the same thing, free to disagree.
 */
export function dropThreadFromWindow(
  window: MessageWindow,
  threadId: string
): MessageWindow {
  const kept = window.older.filter((m) => m.metadata?.taskId !== threadId);
  if (kept.length === window.older.length) return window;
  return { ...window, older: kept };
}
