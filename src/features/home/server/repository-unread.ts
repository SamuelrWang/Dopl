import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { mentionContainmentFilter } from "@/features/channels/server/repository-mentions";

/**
 * Data access for the /home list's UNREAD MARKS — the viewer's own read
 * watermark on each home channel, and the timestamps of the messages in those
 * channels that tag them (Samuel, 2026-09-13: the channel row shows "some
 * notification system for new @s" instead of the last message).
 *
 * ⚠ **ITS OWN FILE, AND THE REASON IS THE SPLIT ALREADY MADE IN THIS FOLDER**
 * (INVARIANTS §1, one reason to change): `repository.ts` holds the LINK half and
 * `repository-containers.ts` the CONTAINER half. These two reads change when the
 * unread RULE changes, which is neither. **`repository.ts` re-exports this file
 * too**, so `import * as repo from "./repository"` and the suites'
 * `vi.mock("./repository")` keep working unchanged.
 *
 * ⚠ **BOTH READS ARE KEYED ON THE CALLER AND CARRY A BOUND** (§9). Neither is a
 * per-row query: one `.in()` over at most `HOME_CHANNEL_LIMIT` containers each.
 *
 * 🔒 **THE MENTION PREDICATE IS IMPORTED, NEVER RETYPED** —
 * `channels/server/repository-mentions.ts › mentionContainmentFilter`, the same
 * definition the Tags inbox filters on. Its docblock carries the two ways a
 * hand-written copy gets it wrong (an array argument renders a PostgreSQL array
 * literal against a jsonb path and matches nothing; the metadata key is a
 * storage-boundary name).
 *
 * ⚠ **WHAT "UNREAD" MEANS HERE IS THE WATERMARK, NOT `channel_mention_reads` —
 * AND THAT IS THE DECISION, NOT AN OVERSIGHT (Desktop Agent's design,
 * 2026-09-13).** The Tags inbox marks mentions read ONE AT A TIME
 * (`channel_mention_reads`, a row per read) because that list is picked over out
 * of order. The /home row is not a list of mentions — it is one badge saying
 * "there are @s here you have not got to", and the act that clears it is OPENING
 * THE CHANNEL. So the boundary is `channel_members.last_read_at`, the SAME
 * watermark the dot beside it reads and the same one
 * `channels/server/dto.ts › mapChannelRow` compares for `Channel.unread`. One
 * watermark, one clearing act. ⚠ A consequence to state out loud: clicking a
 * single mention read in the Tags inbox does NOT decrement this badge, and
 * scrolling the transcript does clear it.
 */

/** The viewer's own membership of one home channel — the watermark, and the
 *  fact that the row EXISTS at all. */
export interface HomeChannelRead {
  channelId: string;
  /** null = never read. */
  lastReadAt: string | null;
  /**
   * 🔒 **WHEN THE CALLER PINNED THIS CHANNEL — `channel_members.favorited_at`,
   * null when they have not (2026-09-15).** ⚠ **THE PIN AND THE BOOKMARK ARE ONE
   * FACT** (Samuel: *"replace the bookmark icon next to the channel name with the
   * pin icon"*), so this is the column the channels header's own toggle writes
   * (`channels/server/service-writes-members.ts › updateMyMemberSettings`) and
   * NOT a second per-device store. ⚠ An absent ROW still means "no pin", exactly
   * as it means "no marks" — a non-member has nothing pinned.
   */
  favoritedAt: string | null;
}

/**
 * The caller's `channel_members` row for every channel inside these containers.
 *
 * ⚠ **KEYED ON `workspace_id`, NOT ON CHANNEL IDS, AND THAT IS WHAT KEEPS THE
 * HOME READ AT TWO TIERS.** `channel_members` carries `workspace_id` (the
 * consistency guard trigger in `20260725130000_channels_rls_hardening.sql`
 * exists precisely because it does), and a container holds exactly ONE channel
 * (`repository-containers.ts › listContainerChannels`) — so this can run in the
 * FIRST `Promise.all`, beside the peers/channels/links fan, instead of waiting
 * for the channel ids that fan resolves. A third tier on the page's one round
 * trip would be a measurable regression for a badge.
 *
 * ⚠ **AN ABSENT ROW IS AN ANSWER.** The map has no entry for a container whose
 * channel the caller is not a member of, and the service reads that as "no marks"
 * — the same `isMember` clause `mapChannelRow` puts on `Channel.unread`. There is
 * no watermark to advance for a non-member, so a badge there could never clear.
 */
export async function listMyChannelReads(
  workspaceIds: string[],
  userId: string
): Promise<Map<string, HomeChannelRead>> {
  const out = new Map<string, HomeChannelRead>();
  if (workspaceIds.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .from("channel_members")
    // ⚠ `favorited_at` RIDES THIS READ AND ADDS NO QUERY (2026-09-15, Samuel's
    // *"replace the bookmark icon next to the channel name with the pin icon"*):
    // the pin IS the favourite, it lives on the SAME `channel_members` row this
    // already selects for the watermark, and a second round trip for a second
    // column of one row is the cost this file exists to avoid.
    .select("channel_id, last_read_at, favorited_at")
    .in("workspace_id", workspaceIds)
    .eq("user_id", userId);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    channel_id: string;
    last_read_at: string | null;
    favorited_at: string | null;
  }>) {
    out.set(row.channel_id, {
      channelId: row.channel_id,
      lastReadAt: row.last_read_at,
      favoritedAt: row.favorited_at,
    });
  }
  return out;
}

/** When one message tagging the caller landed, and where. */
export interface HomeMentionStamp {
  channelId: string;
  createdAt: string;
}

/**
 * WHEN the caller was tagged in these channels, newest first, bounded — the
 * badge's raw material. The per-channel cutoff is applied in CODE
 * (`unread-tally.ts`), because every channel has its own watermark and PostgREST
 * has no way to express one cutoff per row's channel.
 *
 * ⚠ **`since` IS A GLOBAL FLOOR AND IT IS WHAT MAKES THE SCAN SMALL.** It is the
 * OLDEST of the per-channel cutoffs (`unread-tally.ts › mentionScanFloor`), so
 * every row this drops was already read in its own channel — the tally can only
 * lose rows it would have discarded. Without it a busy account would scan its
 * whole mention history to count a handful of unread ones.
 *
 * ⚠ **THE LIMIT IS A NON-REPORTING CEILING, on the same terms §9 already
 * sanctions for this page** (`HOME_CHANNEL_LIMIT` / `HOME_LINK_LIMIT`): the badge
 * is a nudge, not a ledger, and at the ceiling it under-counts rather than
 * lying about there being nothing. ⚠ `created_at DESC` is what makes the clip
 * take the OLDEST rows — the ones nearest their watermark — rather than an
 * arbitrary page.
 *
 * ⚠ SELECTS TWO COLUMNS. The body, the author and the metadata are the INBOX's
 * business; a count that fetched message bodies would put a transcript scan
 * behind a badge.
 */
export async function listMyMentionStamps(
  channelIds: string[],
  userId: string,
  since: string | null,
  limit: number
): Promise<HomeMentionStamp[]> {
  if (channelIds.length === 0) return [];
  const [column, value] = mentionContainmentFilter(userId);
  let query = supabaseAdmin()
    .from("channel_messages")
    .select("channel_id, created_at")
    .in("channel_id", channelIds)
    .contains(column, value);
  if (since !== null) query = query.gt("created_at", since);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Array<{ channel_id: string; created_at: string }>).map(
    (row) => ({ channelId: row.channel_id, createdAt: row.created_at })
  );
}
