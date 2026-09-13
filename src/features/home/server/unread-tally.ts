import type { HomeChannelRead, HomeMentionStamp } from "./repository-unread";

/**
 * The /home list's UNREAD ARITHMETIC — pure, and deliberately not inside
 * `service-reads.ts` (`overview-tally.ts` is the precedent in this same folder).
 * Three decisions live here and each of them is a sentence the row makes:
 * which instant a channel's marks are measured from, how far back the mention
 * scan has to reach, and how many of those stamps are still unread.
 *
 * ⚠ **INSTANTS, NEVER ISO STRINGS.** `lastMessageAt` and a mention's
 * `created_at` come from Postgres (`+00:00`, microseconds) while `last_read_at`
 * is written by JS `toISOString()` (`Z`, milliseconds) — so lexicographic `>`
 * is WRONG on this pair. This is the same trap `channels/server/dto.ts ›
 * mapChannelRow` names, and both sides of it compare `Date.parse`.
 */

/**
 * The instant a channel's unread marks are measured from: the caller's watermark,
 * or the container's birth when they have never read it.
 *
 * ⚠ **THE CONTAINER'S `created_at` IS A SOUND FLOOR AND NOT A GUESS.** A channel
 * is created INSIDE its container (`service-writes.ts › createHomeChannel`), so
 * no message in it can predate the container — a never-read channel's cutoff is
 * therefore "everything", and this is the earliest instant that expresses it
 * without being `null`. It exists so {@link mentionScanFloor} can still bound the
 * scan when one channel has never been opened.
 */
export function readCutoff(
  read: HomeChannelRead | undefined,
  containerCreatedAt: string
): string {
  return read?.lastReadAt ?? containerCreatedAt;
}

/**
 * The OLDEST cutoff across every channel on the page — the one `created_at >`
 * the mention scan may safely carry.
 *
 * ⚠ **IT MUST BE THE MINIMUM, and a maximum here would be a silent bug rather
 * than a slower query**: a channel read a month after its neighbour would have
 * that neighbour's unread mentions filtered out in SQL and its badge would read
 * zero. `null` for an empty page, which the repository takes as "no floor".
 */
export function mentionScanFloor(cutoffs: string[]): string | null {
  let floor: string | null = null;
  for (const at of cutoffs) {
    if (floor === null || Date.parse(at) < Date.parse(floor)) floor = at;
  }
  return floor;
}

/**
 * `channelId` → how many of these mention stamps are NEWER than that channel's
 * own cutoff.
 *
 * ⚠ A STAMP FOR A CHANNEL WITH NO CUTOFF IS DROPPED, NOT COUNTED. `cutoffs` has
 * an entry for every channel the page is rendering; anything else is a channel
 * this caller is not a member of, where there is no watermark a badge could ever
 * be cleared against (`repository-unread.ts › listMyChannelReads`).
 */
export function tallyUnreadMentions(
  stamps: HomeMentionStamp[],
  cutoffs: Map<string, string>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const stamp of stamps) {
    const cutoff = cutoffs.get(stamp.channelId);
    if (cutoff === undefined) continue;
    if (Date.parse(stamp.createdAt) <= Date.parse(cutoff)) continue;
    out.set(stamp.channelId, (out.get(stamp.channelId) ?? 0) + 1);
  }
  return out;
}

/**
 * Is there a message here newer than the caller's watermark?
 *
 * 🔒 **THE SAME RULE `Channel.unread` USES, MINUS ITS `isMember` CLAUSE — which
 * the CALLER supplies instead** (`service-reads.ts` passes `read: undefined` for
 * a non-member and gets `false`). Stated as one function so the home row and the
 * channels sidebar cannot come to disagree about what a dot means: a `null`
 * watermark over ANY message is unread, and the comparison is on instants.
 */
export function isChannelUnread(
  lastMessageAt: string | null,
  read: HomeChannelRead | undefined
): boolean {
  if (read === undefined || lastMessageAt === null) return false;
  if (read.lastReadAt === null) return true;
  return Date.parse(lastMessageAt) > Date.parse(read.lastReadAt);
}
