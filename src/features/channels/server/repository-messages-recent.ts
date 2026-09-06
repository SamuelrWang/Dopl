import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "./dto";

/**
 * THE TWO BOUNDED "WHAT HAPPENED RECENTLY IN THIS ROOM" READS, split out of
 * `repository-messages.ts` on 2026-09-05 for the 500-line cap (ENGINEERING.md §2).
 *
 * ⚠ THEY ARE ONE FAMILY AND THAT IS WHY THEY MOVED TOGETHER: same limit, same `thread IS NULL`
 * expression, same `seq` ordering, and they are read by the same caller — the wake verdict's arm 3.
 * One answers "which agents POSTED", the other "which agents this AUTHOR tagged"; the second
 * replaced the first as arm 3's feed and the first survives for its other reader.
 *
 * ⚠ **THEY NO LONGER SHARE A WINDOW, AND THE DIFFERENCE IS THE POINT** (2026-09-06). The POSTS
 * read is still time-bounded because freshness is what it measures; the TAGS read is bounded by
 * the row limit alone, because author stickiness has no expiry (Samuel's ruling — see below).
 */

/**
 * **RR3 ARM 3's ONE READ** (2026-09-04): the newest MAIN-ROOM messages in this
 * channel written by an AGENT, inside the resilience window — the raw material
 * `lib/agent-post-stamp.ts › recentAgentPosters` turns into "who spoke here
 * last".
 *
 * ⚠ **ISSUED LAZILY AND ALMOST NEVER** — only when a PERSON addressed nobody,
 * the room holds MORE THAN ONE live agent, and the channel has no configured
 * responder; the settled cases return before `defaultResponder` asks for it.
 * ⚠ **PROJECTED TO THE FIVE COLUMNS THE RULE READS**, not `*`: bodies are the
 * large half of this table and the answer is an id list. Bounded at
 * {@link RECENT_AGENT_POSTS_LIMIT} — the window bounds it in TIME, and a busy
 * room can still put thousands of rows inside 15 minutes.
 * ⚠ **`thread IS NULL` IS SPELLED `metadata->>taskId IS NULL`**, the expression
 * `findLastRoomAddressToAgent` and `listMessages` already use.
 */
const RECENT_AGENT_POSTS_LIMIT = 50;

export type RecentAgentPostRow = Pick<
  ChannelMessageRow,
  "seq" | "created_at" | "author_kind" | "client_msg_id" | "metadata"
>;

export async function listRecentRoomAgentPosts(
  channelId: string,
  sinceIso: string
): Promise<RecentAgentPostRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("seq, created_at, author_kind, client_msg_id, metadata")
    .eq("channel_id", channelId)
    .eq("author_kind", "agent")
    .is("metadata->>taskId", null)
    .gt("created_at", sinceIso)
    .order("seq", { ascending: false })
    .limit(RECENT_AGENT_POSTS_LIMIT);
  if (error) throw error;
  return (data ?? []) as RecentAgentPostRow[];
}

/**
 * **THE ROWS WHERE THIS AUTHOR TAGGED AN AGENT IN THIS ROOM** — RR3 arm 3's read since
 * 2026-09-04, replacing {@link listRecentRoomAgentPosts}.
 *
 * ⚠ **THE ARM CHANGED FROM "who posted" TO "who THIS PERSON addressed"** (Samuel): an agent
 * addressing another agent used to re-point the room's default responder, so the operator watched
 * it wander with nothing they did. The predicate that reads these rows is
 * `lib/agent-post-stamp.ts › isAuthorTypedAgentTag`, and it needs `recipient_agent_ids` (who the
 * row reached) AND `metadata` (whether `wake_reason` is present, i.e. whether the SERVER chose
 * rather than the author) — which is why the projection carries both.
 * ⚠ **`author_user_id`, NOT `author_kind`.** The old read filtered to agent authors; this one
 * filters to ONE PERSON, because the rule is per-author stickiness.
 *
 * ⚠ **NO `sinceIso`, AND THE PARAMETER IS GONE RATHER THAN DEFAULTED** (Samuel, 2026-09-06).
 * It took `now - RESILIENCE_WINDOW_MS` until then, which is the read half of the bug: the rule
 * above it has no expiry, so a read that dropped everything older than fifteen minutes made the
 * rule expire anyway, invisibly and from underneath. An optional argument would have left the
 * window a call site away from coming back; there is nothing to pass now.
 * ⚠ **{@link RECENT_AGENT_POSTS_LIMIT} IS THE WHOLE BOUND, AND IT IS THE RIGHT SHAPE OF ONE.**
 * The rows are ONE PERSON'S OWN main-room posts, newest `seq` first, and the walk stops at the
 * first tag naming an agent that is still live — so fifty is deep enough for any real stickiness,
 * and an author whose last fifty room posts named no live agent has none to honour. A TIME bound
 * could not make that promise: it drops rows the rule needs while keeping rows it does not.
 * ⚠ Same projection, same `thread IS NULL` expression, same 50-row limit and same `seq` ordering
 * as the read it replaces — only the time bound changed.
 *
 * ⚠ {@link listRecentRoomAgentPosts} IS LEFT IN PLACE DELIBERATELY, and is now unused by the arm.
 * Its own tests still drive it; deleting it is a follow-up for whoever runs the suite green, not a
 * blind edit from a session that cannot run one.
 */
export type RecentAuthorTagRow = Pick<
  ChannelMessageRow,
  "seq" | "created_at" | "author_user_id" | "recipient_agent_ids" | "metadata"
>;

export async function listRecentRoomTagsBy(
  channelId: string,
  authorUserId: string
): Promise<RecentAuthorTagRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("seq, created_at, author_user_id, recipient_agent_ids, metadata")
    .eq("channel_id", channelId)
    .eq("author_user_id", authorUserId)
    .is("metadata->>taskId", null)
    .order("seq", { ascending: false })
    .limit(RECENT_AGENT_POSTS_LIMIT);
  if (error) throw error;
  return (data ?? []) as RecentAuthorTagRow[];
}
