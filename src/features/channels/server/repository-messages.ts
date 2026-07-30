import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "./dto";

/**
 * Pure data access for `channel_messages`. Split out of `repository.ts` (§2
 * 500-line cap) — the transcript lane is its own reason to change (per-channel
 * `seq` ordering, the advisory-locked insert RPC, cursor reads), while
 * `repository.ts` keeps channels + members. Every function uses the
 * service-role admin client (RLS-bypassing); visibility + authz live in the
 * service layer.
 */

interface MessageReadOpts {
  since?: number;
  limit: number;
}

/**
 * With a `since` cursor: messages with `seq > since`, ascending, capped at
 * `limit` — the incremental read for MCP / desktop consumers and the await
 * poll. WITHOUT a cursor: the LATEST `limit` messages, returned ascending —
 * so a channel with more than `limit` messages still surfaces its newest
 * posts. The former unconditional oldest-`limit` read silently hid every
 * message past the first page once a channel grew beyond `limit`.
 */
export async function listMessages(
  channelId: string,
  opts: MessageReadOpts
): Promise<ChannelMessageRow[]> {
  const db = supabaseAdmin();
  if (opts.since !== undefined) {
    const { data, error } = await db
      .from("channel_messages")
      .select("*")
      .eq("channel_id", channelId)
      .gt("seq", opts.since)
      .order("seq", { ascending: true })
      .limit(opts.limit);
    if (error) throw error;
    return (data ?? []) as ChannelMessageRow[];
  }
  // Newest `limit`, then flip to ascending for display / cursor semantics.
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .order("seq", { ascending: false })
    .limit(opts.limit);
  if (error) throw error;
  return ((data ?? []) as ChannelMessageRow[]).reverse();
}

export async function findMessageByClientId(
  channelId: string,
  clientMsgId: string
): Promise<ChannelMessageRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("client_msg_id", clientMsgId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelMessageRow | null) ?? null;
}

/**
 * One message by its per-channel `seq`, or null. Backs the LEGACY thread pair
 * check: a legacy `task-<channelId>-<seq>` id names the opening request at that
 * seq, and that message's author + `metadata.to_user_id` are the exchange's two
 * participants — the only server-side record of who a legacy thread belongs to
 * (a legacy exchange has no `channel_tasks` row to authorize against).
 */
export async function findMessageBySeq(
  channelId: string,
  seq: number
): Promise<ChannelMessageRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("seq", seq)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelMessageRow | null) ?? null;
}

type MessageInsert = {
  channel_id: string;
  workspace_id: string;
  author_user_id: string | null;
  author_kind: string;
  kind: string;
  body: string;
  metadata: Record<string, unknown>;
  client_msg_id: string | null;
};

/**
 * Insert a message through the `channel_message_insert` RPC, which takes a
 * per-channel advisory xact lock BEFORE the IDENTITY `seq` is assigned. That
 * serializes seq assignment + commit per channel, so seq commit order is
 * monotonic per channel and an await/read cursor can't advance past a
 * not-yet-visible lower seq and permanently miss it. A unique-violation on
 * `client_msg_id` still surfaces as 23505 for the service layer's idempotency
 * convergence.
 */
export async function insertMessage(
  row: MessageInsert
): Promise<ChannelMessageRow> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channel_message_insert", {
    p_channel_id: row.channel_id,
    p_workspace_id: row.workspace_id,
    p_author_user_id: row.author_user_id,
    p_author_kind: row.author_kind,
    p_kind: row.kind,
    p_body: row.body,
    p_metadata: row.metadata,
    p_client_msg_id: row.client_msg_id,
  });
  if (error) throw error;
  // A single-composite RETURNS comes back as an object; normalize defensively.
  const out = Array.isArray(data) ? data[0] : data;
  return out as ChannelMessageRow;
}

/** Per-channel latest message (seq + created_at) via the bounded RPC. */
export async function lastMessages(
  channelIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channels_last_message", {
    p_channel_ids: channelIds,
  });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    channel_id: string;
    last_at: string;
  }>) {
    out.set(row.channel_id, row.last_at);
  }
  return out;
}
