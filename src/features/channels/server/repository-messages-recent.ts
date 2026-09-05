import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "./dto";

/**
 * THE TWO BOUNDED "WHAT HAPPENED RECENTLY IN THIS ROOM" READS, split out of
 * `repository-messages.ts` on 2026-09-05 for the 500-line cap (ENGINEERING.md §2).
 *
 * ⚠ THEY ARE ONE FAMILY AND THAT IS WHY THEY MOVED TOGETHER: same window, same limit, same
 * `thread IS NULL` expression, and they are read by the same caller — the wake verdict's arm 3.
 * One answers "which agents POSTED", the other "which agents this AUTHOR tagged"; the second
 * replaced the first as arm 3's feed and the first survives for its other reader.
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
 * ⚠ Same bound, same window, same `thread IS NULL` expression and same 50-row limit as the read it
 * replaces — none of those reasons changed.
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
  authorUserId: string,
  sinceIso: string
): Promise<RecentAuthorTagRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("seq, created_at, author_user_id, recipient_agent_ids, metadata")
    .eq("channel_id", channelId)
    .eq("author_user_id", authorUserId)
    .is("metadata->>taskId", null)
    .gt("created_at", sinceIso)
    .order("seq", { ascending: false })
    .limit(RECENT_AGENT_POSTS_LIMIT);
  if (error) throw error;
  return (data ?? []) as RecentAuthorTagRow[];
}
