import type { ChannelFoldedArtifact, ChannelMessage, ChannelReadEntry } from "../types";
import { isPendingId } from "./optimistic-cache";

/**
 * **THE SWITCH-IN DELTA: what a `since=` page does to the transcript cache
 * entry already on screen** (2026-10-10, option A of KB `dopl-development ›
 * Channel Switch Latency 2026-10-10`).
 *
 * ⚠ **PURE, NO REACT, NO NETWORK.** `hooks/use-channel-messages.ts` owns WHEN a
 * delta is fetched and what to do when one cannot be merged; this file owns the
 * MERGE, which is the half that can silently duplicate or lose a message.
 *
 * ⚠ **THE SHAPES HERE ARE RAW RESPONSE BODIES**, because that is what
 * `useApiQuery` stores and what the optimistic writes patch — the same rule
 * `lib/optimistic-cache.ts` states.
 *
 * ⚠ **A DELTA IS NOT A REVALIDATION, AND THE HOOK MUST NOT TREAT IT AS ONE.** A
 * forward read from `since` can only ADD rows: it never sees an older row that
 * was edited or deleted while the reader was away. That is why the realtime
 * doorbell stays a FULL refetch ("refetch, don't merge") and the delta is
 * switch-in only.
 */

/** The transcript cache entry — `messages` plus the two keys added 2026-09-08. */
export interface TranscriptCacheBody {
  messages: ChannelMessage[];
  entries?: ChannelReadEntry[] | null;
  hasMore?: boolean;
}

/**
 * THE CURSOR A DELTA READS FROM: the highest `seq` the cache holds, or `null`
 * when it holds nothing to read forward from.
 *
 * ⚠ **A MAX, NEVER `messages.at(-1)`.** The array is ascending by `seq` as the
 * server returns it, but an optimistic pending row is appended with a SYNTHETIC
 * `seq` (`optimistic-cache.ts › buildPendingMessage` takes `max + 1`), so the
 * last element can be a row the server has never seen. Reading `since` from a
 * synthetic seq would skip every real message between the last saved row and it.
 */
export function newestCachedSeq(
  messages: readonly ChannelMessage[] | undefined
): number | null {
  if (!messages || messages.length === 0) return null;
  let newest: number | null = null;
  for (const message of messages) {
    // A pending row has a seq no server assigned; it is not a cursor.
    if (isPendingId(message.id)) continue;
    if (newest === null || message.seq > newest) newest = message.seq;
  }
  return newest;
}

/**
 * THE CARDS out of an envelope, artifact arms only.
 *
 * ⚠ Local rather than `message-window.ts › foldedArtifactsOf` because that one
 * returns a shared-empty whose identity is load-bearing for a memo downstream;
 * this one is building a cache body, not a render input.
 */
function artifactArms(
  entries: readonly ChannelReadEntry[] | null | undefined
): ChannelFoldedArtifact[] {
  if (!entries) return [];
  const out: ChannelFoldedArtifact[] = [];
  for (const entry of entries) {
    if (entry.type === "artifact") out.push(entry.folded);
  }
  return out;
}

/**
 * The merged envelope, **THE DELTA'S COPY WINNING on `artifact.id`** and the
 * CACHED ORDER kept.
 *
 * ⚠ **FIRST COPY WINNING WAS WRONG ACROSS TIME, WHICH IS THE ONLY DIRECTION THIS
 * FUNCTION RUNS IN (fixed 2026-10-11).** The justification it borrowed from
 * `message-window.ts › addArtifacts` — "two pages' copies of one card are
 * IDENTICAL" — is a claim about TWO PAGES OF ONE READ. These two copies are from
 * reads minutes apart: `count`, `firstSeq` and `lastSeq` are channel-wide facts
 * that MOVE as the room talks, and `count` is rendered. Preferring the held copy
 * made every switch-back paint a card whose member count had been stale since
 * the reader left.
 *
 * ⚠ **IN PLACE, NEVER APPENDED.** The replacement keeps the slot the cached copy
 * held, so a refreshed card does not jump to the end of the envelope.
 *
 * ⚠ **ARTIFACT ARMS ONLY, AND THE MESSAGE ARMS ARE DROPPED ON PURPOSE.** The
 * envelope in this cache entry is read for exactly one thing — the page's folded
 * CARDS (`use-channel-messages.ts › pageArtifacts`) — and the hook rebuilds the
 * message arms over the MERGED list (`message-window.ts › mergeEntries`), since
 * the array it renders is the page plus history plus every optimistic patch.
 * Carrying a page's message arms forward would describe a page that no longer
 * exists.
 *
 * ⚠ `null` means "nothing on this entry is in an artifact", the same thing it
 * means on the wire — never "this server cannot fold".
 */
function mergeArtifactEnvelope(
  cached: readonly ChannelReadEntry[] | null | undefined,
  delta: readonly ChannelReadEntry[] | null | undefined
): ChannelReadEntry[] | null {
  const held = artifactArms(cached);
  const slotOf = new Map<string, number>();
  held.forEach((folded, index) => slotOf.set(folded.artifact.id, index));
  for (const folded of artifactArms(delta)) {
    const slot = slotOf.get(folded.artifact.id);
    if (slot !== undefined) {
      held[slot] = folded;
      continue;
    }
    slotOf.set(folded.artifact.id, held.length);
    held.push(folded);
  }
  if (held.length === 0) return null;
  return held.map((folded) => ({ type: "artifact", folded }) as const);
}

/**
 * THE TWIN KEY — `clientMsgId` **SCOPED TO ITS AUTHOR**, or `null` for a row that
 * carries no idempotency key and therefore has no twin.
 *
 * ⚠ **THE AUTHOR TERM IS THE WHOLE POINT, AND WITHOUT IT A MESSAGE VANISHES
 * (fixed 2026-10-11).** `channel_messages.client_msg_id` is unique per *(channel,
 * client_msg_id, AUTHOR)* by design, it is on every peer's DTO, and desktop keys
 * are shaped `agent-<publicAgentId>-<n>` — so two authors sharing one key is a
 * shape the product produces, not a coincidence. Matching on the key alone made
 * the delta REPLACE the older author's row IN PLACE and the transcript simply
 * lost a message, silently, with no duplicate or gap to notice.
 *
 * ⚠ `\u0000` SEPARATES, so no author id can run into a key and forge a twin, and
 * a `null` author is its own bucket rather than fusing with the empty string.
 */
function twinKey(message: ChannelMessage): string | null {
  if (message.clientMsgId === null) return null;
  return `${message.authorUserId ?? ""}\u0000${message.clientMsgId}`;
}

/**
 * **FOLD A FORWARD `since=` PAGE INTO THE ENTRY ALREADY CACHED.**
 *
 * ⚠ **DEDUPED BY `id` OR BY AN AUTHOR-SCOPED {@link twinKey}, NOT BY `seq`.** A
 * row can already be in the cache under a PENDING id — the reader's own send,
 * which the delta brings back as the saved row — and seq-only dedupe would render
 * that message twice: the pending seq is SYNTHETIC (`max + 1`), so the two match
 * on the key and on nothing else.
 *
 * ⚠ **IT IS `optimistic-cache.ts › reconcileMessage`'S RULE PLUS THE AUTHOR
 * TERM, AND THE DIVERGENCE IS DELIBERATE** (2026-10-11). That function's one
 * input is the POST's answer to the CALLER'S OWN send, where the author cannot
 * differ and the term would be dead weight; this is the first path to run the
 * rule over OTHER AUTHORS' rows, where dropping it loses a message (above). The
 * ideal is one author-aware definition there, which is a change to a file this
 * one does not own.
 *
 * ⚠ **INDEXED ONCE, UPSERTED, SORTED ONCE.** `reconcileMessage` slices the whole
 * array per row, so 59 delta rows into a 100-row entry allocated 59 full copies
 * and re-sorted the lot; the index makes the merge one pass over each side.
 *
 * ⚠ **SORTED BY `seq` AFTER THE UPSERT.** A row with no twin is APPENDED, so
 * delta rows from other authors would otherwise land after the reader's own
 * pending row and the transcript would read out of order.
 *
 * ⚠ **A PENDING ROW LOSES EVERY TIE, and the tie is not hypothetical.** Its seq
 * is `max + 1` of the cache it was built against, which is exactly the seq the
 * server then gives the NEXT message anyone sends — so a peer's row and the
 * reader's unsent one arrive sharing a number. The unacknowledged one belongs at
 * the bottom; the hook's cursor already assumes pending rows sort last. The sort
 * is otherwise stable, so two pending rows keep the order they were composed in.
 *
 * ⚠ **`hasMore` IS THE CACHED ANSWER, NEVER THE DELTA'S.** They answer different
 * questions: the cached one is "is there older HISTORY", the delta's is "did this
 * forward read come back at its own ceiling". Overwriting the first with the
 * second would latch `exhausted` and hide the channel's history.
 */
export function mergeDeltaPage(
  cached: TranscriptCacheBody,
  delta: { messages?: ChannelMessage[] | null; entries?: ChannelReadEntry[] | null }
): TranscriptCacheBody {
  const rows = delta.messages ?? [];
  const entries = mergeArtifactEnvelope(cached.entries, delta.entries);
  // ⚠ `?? []` — THE §8 STALE-CACHE RULE, as every sibling on this path states it:
  // an entry written by a build that had no `messages` key would otherwise throw
  // inside the hook's `.then`, where the trailing `.catch` converts the throw
  // into a silent full refetch — the cost option A exists to avoid, paid on
  // every switch and attributed to nothing.
  const held = cached.messages ?? [];
  if (rows.length === 0) {
    // Nothing arrived: same messages, same identity, so no memo below this moves.
    return { ...cached, messages: held, entries };
  }
  const merged = held.slice();
  const slotById = new Map<string, number>();
  const slotByTwin = new Map<string, number>();
  const remember = (message: ChannelMessage, slot: number) => {
    slotById.set(message.id, slot);
    const twin = twinKey(message);
    if (twin !== null) slotByTwin.set(twin, slot);
  };
  merged.forEach(remember);
  for (const row of rows) {
    const twin = twinKey(row);
    // ⚠ `??`, NEVER `||`: slot 0 is a real slot.
    const slot =
      slotById.get(row.id) ?? (twin === null ? undefined : slotByTwin.get(twin));
    if (slot === undefined) {
      merged.push(row);
      remember(row, merged.length - 1);
      continue;
    }
    // IN PLACE, so the message keeps its position and the transcript does not
    // jump; and re-indexed, because the saved row's id is new to this entry.
    merged[slot] = row;
    remember(row, slot);
  }
  return { ...cached, messages: merged.sort(bySeqPendingLast), entries };
}

/**
 * `seq` ascending; an unacknowledged row loses the tie.
 *
 * ⚠ **ONE ORDERING RULE, TWO COMPARATORS — `message-window.ts › mergeWindow`
 * SORTS THE SAME ARRAY WITH `(a, b) => a.seq - b.seq`, WITHOUT THE TIEBREAK.**
 * The merged render order is only correct because V8's sort is stable and this
 * one runs first. It should be ONE exported comparator used by both; folding them
 * means editing `message-window.ts`, which this change does not own, so it is
 * reported rather than done.
 */
function bySeqPendingLast(a: ChannelMessage, b: ChannelMessage): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return Number(isPendingId(a.id)) - Number(isPendingId(b.id));
}
