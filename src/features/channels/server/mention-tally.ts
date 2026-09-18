/**
 * THE ROW BADGE'S ARITHMETIC — pure, and the ONE rule behind `@ N` on every
 * channel row of both scopes (Samuel's ruling R-28, 2026-09-17).
 *
 * ⚠ **IT MOVED HERE FROM `home/server/unread-tally.ts` (Wave 3)** — the badge is a
 * field of `Channel` now and `channels → home` is forbidden (§1). `isChannelUnread`
 * did NOT come with it: the dot is `dto.ts › mapChannelRow`'s `unread` and always
 * was, so /home's copy is deleted rather than moved.
 *
 * ⚠ **INSTANTS, NEVER ISO STRINGS.** `created_at` comes from Postgres (`+00:00`,
 * microseconds) and `last_read_at` from JS `toISOString()` (`Z`, milliseconds), so
 * lexicographic `>` is WRONG on this pair. Both sides compare `Date.parse`.
 */

/** When one message tagging the caller landed, and where. */
export interface MentionStamp {
  channelId: string;
  createdAt: string;
}

/**
 * The instant a channel's mention badge is measured from: the caller's watermark,
 * or the channel's own birth when they have never read it.
 *
 * ⚠ **THE CHANNEL'S `created_at` IS A SOUND FLOOR, NOT A GUESS** — no message in a
 * channel can predate the channel — so a never-read channel's cutoff is
 * "everything", expressed as the earliest instant that is not `null`. It exists so
 * {@link mentionScanFloor} can still bound the scan when one channel has never
 * been opened.
 */
export function mentionCutoff(
  lastReadAt: string | null,
  channelCreatedAt: string
): string {
  return lastReadAt ?? channelCreatedAt;
}

/**
 * The OLDEST cutoff across every channel on the page — the one `created_at >` the
 * scan may safely carry.
 *
 * ⚠ **IT MUST BE THE MINIMUM. A MAXIMUM HERE IS A SILENT BUG, NOT A SLOWER
 * QUERY**: a channel read a month after its neighbour would have that neighbour's
 * unread mentions filtered out in SQL, where no tally could recover them, and its
 * badge would read zero. `null` for an empty page — the repository takes that as
 * "no floor".
 */
export function mentionScanFloor(cutoffs: string[]): string | null {
  let floor: string | null = null;
  for (const at of cutoffs) {
    if (floor === null || Date.parse(at) < Date.parse(floor)) floor = at;
  }
  return floor;
}

/**
 * `channelId` → how many of these stamps are NEWER than that channel's own cutoff.
 *
 * ⚠ **A STAMP FOR A CHANNEL WITH NO CUTOFF IS DROPPED, NOT COUNTED.** `cutoffs`
 * has an entry for every channel the caller is a MEMBER of; anything else is a
 * channel where there is no watermark a badge could ever be cleared against, which
 * is the `isMember` clause `Channel.unread` carries, in this shape.
 */
export function tallyMentions(
  stamps: MentionStamp[],
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
