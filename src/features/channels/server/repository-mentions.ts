import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";

/**
 * Pure data access for the MENTIONS INBOX — the messages of one channel that
 * tag one member, and that member's read-state rows in
 * `channel_mention_reads` (migration `20260818140000`).
 *
 * ⚠ Service-role admin client (RLS-bypassing) like every channels repository;
 * visibility and authz live in the SERVICE layer, which is therefore the fence
 * (INVARIANTS §2 — service role bypasses RLS entirely).
 */

/**
 * The columns the inbox reads off `channel_messages`. ⚠ Not `*` (INVARIANTS
 * §9): `workspace_id` is already decided by the gate. `body` IS selected and IS
 * the heavy field — it is also the answer, since the row's whole point is a
 * snippet; the SERVICE clips it.
 *
 * ⚠ THIS NOTE USED TO EXCLUDE `client_msg_id` AS "an idempotency key", which was
 * true and is no longer the whole truth: it is ALSO the older half of the agent
 * stamp, and the inbox now names the agent that tagged you. It is still never
 * read AS an identity — `authorAgentIdOf` is the one parser, and the value is
 * caller-supplied.
 */
// ⚠ `client_msg_id` JOINED THE LIST ON 2026-09-15 and it is not decoration: with
// `metadata` beside it, it is what `lib/agent-post-stamp.ts › authorAgentIdOf` needs to say
// WHICH of an operator's agents wrote the row. Without it a mention from an agent could only
// ever render the bare noun, which is the defect AGENT-BADGE-TRACE.md is about, one surface over.
const CHANNEL_MENTION_MESSAGE_COLS =
  "id,seq,channel_id,author_user_id,author_kind,client_msg_id,body,metadata,created_at";

export type MentionMessageRow = {
  id: string;
  seq: number;
  channel_id: string;
  author_user_id: string | null;
  author_kind: string;
  /** ⚠ CALLER-SUPPLIED and read ONLY through `authorAgentIdOf`, never trusted as identity. */
  client_msg_id: string | null;
  body: string;
  metadata: unknown;
  created_at: string;
};

/**
 * PostgREST containment against the stamped id set:
 * `metadata -> 'mentionedUserIds' @> '["<uid>"]'`.
 *
 * ⚠ A STRING, not an array. `postgrest-js`' `contains()` renders an ARRAY
 * argument as a PostgreSQL array literal (`{a,b}`), which is the wrong type
 * against a jsonb path; a STRING argument is emitted verbatim, so this is the
 * shape that produces jsonb containment. Answered by
 * `channel_messages_mentions_idx` (GIN, `jsonb_path_ops`, on that exact
 * expression).
 *
 * ⚠ **EXPORTED SINCE 2026-09-13, FOR /home's PER-CHANNEL MENTION TALLY**
 * (`features/home/server/repository-unread.ts`). It is the DEFINITION of "a
 * mention of me" and the two gotchas above are exactly the kind that get
 * retyped wrong — a second site spelling its own `contains()` argument would
 * either pass an array (a PostgreSQL array literal against a jsonb path, i.e.
 * no rows) or name the metadata key by hand. **One definition, two readers**:
 * the inbox, and {@link listMentionStamps} below it.
 */
export function mentionContainmentFilter(userId: string): [string, string] {
  return [`metadata->${MENTIONS_METADATA_KEY}`, JSON.stringify([userId])];
}

/**
 * WHEN the caller was tagged across these channels, newest first, bounded — the
 * raw material for the row badge `Channel.mentionCount` (R-28).
 *
 * 🔒 ⚠ **READ-STATE HERE IS THE WATERMARK, NOT `channel_mention_reads`, AND THAT
 * IS THE DECISION.** The inbox above marks mentions read ONE AT A TIME because
 * that list is picked over out of order. A row badge is ONE mark whose clearing
 * act is OPENING THE CHANNEL, so its boundary is `channel_members.last_read_at` —
 * the same watermark the dot beside it takes. **The consequence, stated rather
 * than discovered:** clicking one mention read in the inbox does not decrement the
 * badge, and scrolling the transcript does clear it.
 *
 * ⚠ **THE PER-CHANNEL CUTOFF IS APPLIED IN CODE** (`mention-tally.ts`): every
 * channel has its own watermark and PostgREST cannot express one cutoff per row's
 * channel. `since` is the OLDEST of them, a GLOBAL floor — every row it drops was
 * already read in its own channel, so the tally can only lose rows it would have
 * discarded. A MAXIMUM there would filter an earlier-read channel's unread
 * mentions out in SQL.
 *
 * ⚠ **THE LIMIT IS A NON-REPORTING CEILING** on §9's terms for this family: at the
 * ceiling the badge UNDER-counts rather than claiming there is nothing, and
 * `created_at DESC` makes the clip take the OLDEST stamps — the ones nearest their
 * watermark — rather than an arbitrary page.
 *
 * ⚠ TWO COLUMNS. The body, the author and the metadata are the INBOX's business;
 * a count that fetched message bodies would put a transcript scan behind a badge.
 */
export async function listMentionStamps(
  channelIds: string[],
  userId: string,
  since: string | null,
  limit: number
): Promise<Array<{ channelId: string; createdAt: string }>> {
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

/**
 * One channel's messages that tag `userId`, NEWEST FIRST, bounded.
 *
 * ⚠ ORDERED BY `seq DESC`, which is the per-channel monotonic identity — never
 * `created_at`, whose ties a LIMIT would break nondeterministically. The LIMIT
 * clips against THIS order, so nothing downstream may re-sort the page
 * (INVARIANTS §5/§9): a re-sorted page is the wrong rows in a plausible order.
 *
 * `truncated` is `rows.length >= limit` — AT the ceiling counts as clipped,
 * because at is indistinguishable from over.
 */
export async function listMentionMessages(
  channelId: string,
  userId: string,
  limit: number
): Promise<{ rows: MentionMessageRow[]; truncated: boolean }> {
  const db = supabaseAdmin();
  const [column, value] = mentionContainmentFilter(userId);
  const { data, error } = await db
    .from("channel_messages")
    .select(CHANNEL_MENTION_MESSAGE_COLS)
    .eq("channel_id", channelId)
    .contains(column, value)
    .order("seq", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as MentionMessageRow[];
  return { rows, truncated: rows.length >= limit };
}

/**
 * The subset of `messageIds` that really are messages IN THIS CHANNEL tagging
 * `userId`. ⚠ THE WRITE PATH'S WHOLE AUTHORIZATION: without it a caller could
 * write read-state rows for arbitrary message ids, which is a cheap way to
 * probe which ids exist and a free way to litter another channel's table.
 * Same containment filter as the read, so the two cannot disagree about what
 * counts as "a mention of me".
 */
export async function findMentionMessageIds(
  channelId: string,
  userId: string,
  messageIds: string[]
): Promise<string[]> {
  if (messageIds.length === 0) return [];
  const db = supabaseAdmin();
  const [column, value] = mentionContainmentFilter(userId);
  const { data, error } = await db
    .from("channel_messages")
    .select("id")
    .eq("channel_id", channelId)
    .in("id", messageIds)
    .contains(column, value);
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/**
 * Which of `messageIds` this member has already read. ⚠ Bounded by its
 * ARGUMENT, never by a `limit` — the caller passes at most one clipped page of
 * ids, so the read is the size of the answer it feeds.
 */
export async function listMentionReads(
  userId: string,
  channelId: string,
  messageIds: string[]
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_mention_reads")
    .select("message_id")
    .eq("user_id", userId)
    .eq("channel_id", channelId)
    .in("message_id", messageIds);
  if (error) throw error;
  return new Set(
    ((data ?? []) as Array<{ message_id: string }>).map((row) => row.message_id)
  );
}

export type MentionReadInsert = {
  user_id: string;
  message_id: string;
  channel_id: string;
  workspace_id: string;
};

/**
 * Mark rows read. ⚠ IDEMPOTENT BY CONSTRUCTION AND BY CHOICE OF CONFLICT
 * ACTION: `ignoreDuplicates` is `ON CONFLICT DO NOTHING` on the
 * `(user_id, message_id)` primary key, so a second mark is a no-op that keeps
 * the ORIGINAL `read_at`. An upsert that overwrote it would make "read 3 days
 * ago" drift forward every time the list re-rendered — the timestamp records
 * when you first saw it, not when you last looked.
 */
export async function insertMentionReads(
  rows: MentionReadInsert[]
): Promise<void> {
  if (rows.length === 0) return;
  const db = supabaseAdmin();
  const { error } = await db
    .from("channel_mention_reads")
    .upsert(rows, { onConflict: "user_id,message_id", ignoreDuplicates: true });
  if (error) throw error;
}
