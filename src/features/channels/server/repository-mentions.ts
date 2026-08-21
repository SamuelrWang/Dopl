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
 * §9): `client_msg_id` is an idempotency key and `workspace_id` is already
 * decided by the gate. `body` IS selected and IS the heavy field — it is also
 * the answer, since the row's whole point is a snippet; the SERVICE clips it.
 */
const CHANNEL_MENTION_MESSAGE_COLS =
  "id,seq,channel_id,author_user_id,author_kind,body,metadata,created_at";

export type MentionMessageRow = {
  id: string;
  seq: number;
  channel_id: string;
  author_user_id: string | null;
  author_kind: string;
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
 */
function mentionContainment(userId: string): [string, string] {
  return [`metadata->${MENTIONS_METADATA_KEY}`, JSON.stringify([userId])];
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
  const [column, value] = mentionContainment(userId);
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
  const [column, value] = mentionContainment(userId);
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
