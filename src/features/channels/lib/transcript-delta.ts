import type { ChannelFoldedArtifact, ChannelMessage, ChannelReadEntry } from "../types";
import {
  isPendingId,
  reconcileMessage,
  type MessagesCache,
} from "./optimistic-cache";

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
 * The merged envelope, FIRST COPY WINNING on `artifact.id`.
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
  const seen = new Set(held.map((folded) => folded.artifact.id));
  for (const folded of artifactArms(delta)) {
    if (seen.has(folded.artifact.id)) continue;
    seen.add(folded.artifact.id);
    held.push(folded);
  }
  if (held.length === 0) return null;
  return held.map((folded) => ({ type: "artifact", folded }) as const);
}

/**
 * **FOLD A FORWARD `since=` PAGE INTO THE ENTRY ALREADY CACHED.**
 *
 * ⚠ **DEDUPED BY `reconcileMessage`, NOT BY `seq`.** A row can already be in the
 * cache under a PENDING id — the reader's own send, which the delta brings back
 * as the saved row — and seq-only dedupe would render that message twice. That
 * function is the one definition of "the saved row replaces its twin IN PLACE",
 * matched on `id` or `clientMsgId`, and a second one here is how a retry comes
 * to duplicate on one path and not the other.
 *
 * ⚠ **SORTED BY `seq` AFTER THE UPSERT.** `reconcileMessage` APPENDS a row with
 * no twin, so delta rows from other authors would otherwise land after the
 * reader's own pending row and the transcript would read out of order.
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
  if (rows.length === 0) {
    // Nothing arrived: same messages, same identity, so no memo below this moves.
    return { ...cached, entries };
  }
  let merged: MessagesCache = { messages: cached.messages };
  for (const row of rows) {
    // Defined in, defined out — `reconcileMessage` only passes `undefined` through.
    merged = reconcileMessage(merged, row) as MessagesCache;
  }
  return {
    ...cached,
    messages: [...merged.messages].sort(bySeqPendingLast),
    entries,
  };
}

/** `seq` ascending; an unacknowledged row loses the tie. */
function bySeqPendingLast(a: ChannelMessage, b: ChannelMessage): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return Number(isPendingId(a.id)) - Number(isPendingId(b.id));
}
