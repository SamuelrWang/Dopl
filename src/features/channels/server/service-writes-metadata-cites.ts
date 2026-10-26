import "server-only";

import type { CiteInput } from "../schema-cites";
import type { ResolvedCite } from "../lib/cites";
import {
  ChannelCiteNumberUnavailableError,
  ChannelCiteUnresolvedError,
} from "./errors";
import * as repoMessages from "./repository-messages";

/**
 * **CITATIONS, RESOLVED ONCE, AT THE WRITE** (grammar B, Samuel's card #4401,
 * 2026-10-12).
 *
 * Every entry the caller named becomes a MESSAGE ID before the row is stored, or
 * the send is refused. ⚠ **That is the entire reason this feature has no cutover
 * date and no namespace ambiguity at read time:** by the time any renderer sees a
 * citation it is a row id, so nothing downstream has to decide whether a digit
 * meant a per-channel number or a table-wide `seq`.
 *
 * ⚠ **REFUSES, NEVER DROPS** (`ChannelCiteUnresolvedError`). The nearest
 * precedent in this file's family goes the other way deliberately — a `threadId`
 * that is not the poster's exchange is silently stripped, because a mistagged
 * post is still a post worth keeping. A citation is different in kind: it is the
 * message's argument, and storing the prose while quietly discarding what it
 * pointed at leaves the author believing a reference landed.
 *
 * ⚠ **THE FENCE IS THE CHANNEL, AND IT IS THE `eq("channel_id")` IN THE
 * REPOSITORY, NOT A CHECK HERE.** The caller is already proved a member of this
 * channel, so a citation naming a row in another room resolves to nothing and is
 * refused as unresolvable — which is also why cross-channel citations are not a
 * feature in v1: there is no second membership proof to stand on.
 */
export async function resolveCites(
  channelId: string,
  cites: readonly CiteInput[] | undefined
): Promise<ResolvedCite[]> {
  if (cites === undefined || cites.length === 0) return [];

  // ⚠ **`no` IS REFUSED, NOT QUIETLY TREATED AS `seq`.** The two namespaces
  // disagree by the gap between a channel's own count and the table's, so
  // falling back would resolve — to the wrong message, in some other room, with
  // a pill confidently pointing at it. The column arrives with
  // `supabase/migrations-held/20261122120000`; flipping this on is a change HERE
  // plus a per-channel finder, and nothing else in the lane moves.
  for (const entry of cites) {
    if (entry.no !== undefined) {
      throw new ChannelCiteNumberUnavailableError(entry.no);
    }
  }

  // ⚠ DEDUPED BY `seq` BEFORE THE READ: citing the same message twice is not an
  // error (an author may name it in two sentences), but it is one row and one
  // lookup. Order of first mention is preserved — the stored list is read back as
  // the author's own ordering.
  const wanted: number[] = [];
  for (const entry of cites) {
    const seq = entry.seq;
    if (seq !== undefined && !wanted.includes(seq)) wanted.push(seq);
  }

  const rows = await repoMessages.findMessageRefsBySeqs(channelId, wanted);
  const bySeq = new Map(rows.map((row) => [Number(row.seq), row]));

  const resolved: ResolvedCite[] = [];
  const seen = new Set<number>();
  for (const entry of cites) {
    const seq = entry.seq as number;
    if (seen.has(seq)) continue;
    seen.add(seq);

    const row = bySeq.get(seq);
    if (row === undefined) throw new ChannelCiteUnresolvedError(entry);

    // The cited row's own thread, read from the tag the transcript rides on.
    const meta =
      row.metadata !== null && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const threadId = typeof meta.threadId === "string" ? meta.threadId : null;

    // ⚠ A SUPPLIED `thread` IS A CLAIM TO CHECK, NOT A FILTER TO APPLY. The
    // caller said "this message, in that thread"; if the row is somewhere else
    // the caller's model of the transcript is wrong, and resolving it anyway
    // would hand back a pill that contradicts the sentence around it.
    if (entry.thread !== undefined && entry.thread !== threadId) {
      throw new ChannelCiteUnresolvedError(entry);
    }

    resolved.push({
      messageId: row.id,
      seq,
      // ⚠ `null` UNTIL THE HELD MIGRATION LANDS, and stored as `null` rather than
      // omitted so a reader can tell "this row has no per-channel number" from
      // "this citation predates the field".
      no: null,
      thread: threadId,
    });
  }
  return resolved;
}
