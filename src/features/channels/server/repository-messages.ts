import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "./dto";

/**
 * Pure data access for `channel_messages` — per-channel `seq` ordering, the
 * advisory-locked insert RPC, cursor reads. ⚠ Service-role admin client
 * (RLS-bypassing); visibility + authz live in the SERVICE layer.
 */

interface MessageReadOpts {
  since?: number;
  limit: number;
  /**
   * Drop this author's rows. Only the await hold passes it, so a caller's own
   * posts cannot end its own wait; every other read leaves it unset.
   * ⚠ Must stay NULL-safe — see {@link excludeAuthorFilter}.
   */
  excludeAuthor?: string;
  /**
   * Keep only rows tagged for this thread (`metadata->>'taskId'`). ⚠ A FILTER,
   * not a lookup: an unmatched id yields `[]`, never an error, and nothing is
   * validated against `channel_tasks` — legacy `task-<channelId>-<seq>` ids are
   * real `metadata.taskId` values too.
   */
  threadId?: string;
}

/**
 * THE AUTHOR-EXCLUSION PREDICATE, spelled once —
 * `author_user_id IS NULL OR author_user_id <> $1`.
 *
 * ⚠ A plain `.neq("author_user_id", x)` silently drops every SYSTEM-AUTHORED
 * row, because SQL `NULL <> x` is NULL, not true. The stale-thread cron is such
 * a writer: its close proposal renders on the web card and is INVISIBLE to any
 * agent holding an await — the one surface `dopl_channel` teaches agents to arm.
 *
 * ⚠ Fixed HERE, not at the writer. `excludeAuthor` means "ignore MY OWN posts";
 * an unauthored message is by construction not the caller's own, so dropping it
 * was the rule's SQL leaking, not the rule. Forging an author on the sweep has
 * no honest candidate, and whichever party was stamped is the one member whose
 * agent still could not see it. One predicate also covers future system writers.
 *
 * ⚠ `excludeAuthor` is a uuid at every entry (`AwaitQuerySchema`, `opAwait`'s
 * `selfUserId`), so it is safe to interpolate into PostgREST's `or` grammar.
 * Nothing else may call this with unvalidated text.
 */
function excludeAuthorFilter(userId: string): string {
  return `author_user_id.is.null,author_user_id.neq.${userId}`;
}

/**
 * With a `since` cursor: `seq > since`, ascending, capped at `limit` — the
 * incremental read for MCP / desktop and the await poll. Without: the LATEST
 * `limit`, returned ascending, so a long channel still surfaces its newest posts
 * (an unconditional oldest-`limit` read hides everything past the first page).
 *
 * ⚠ The two modes differ ONLY in the `seq > since` predicate and which end the
 * `limit` bites. Optional filters are applied ONCE to one builder rather than
 * duplicated per branch — a filter added to only one of two near-identical
 * queries is the exact bug shape this avoids.
 */
export async function listMessages(
  channelId: string,
  opts: MessageReadOpts
): Promise<ChannelMessageRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId);
  if (opts.since !== undefined) query = query.gt("seq", opts.since);
  if (opts.excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(opts.excludeAuthor));
  }
  // ⚠ `metadata->>taskId` compares as TEXT, so the stored value matches
  // verbatim — uuid or legacy string alike.
  if (opts.threadId !== undefined) {
    query = query.eq("metadata->>taskId", opts.threadId);
  }
  // Cursored: oldest-first from the cursor. Cursorless: newest `limit`, flipped
  // to ascending for display / cursor semantics.
  const cursored = opts.since !== undefined;
  const { data, error } = await query
    .order("seq", { ascending: cursored })
    .limit(opts.limit);
  if (error) throw error;
  const rows = (data ?? []) as ChannelMessageRow[];
  return cursored ? rows : rows.reverse();
}

/**
 * EXISTENCE probe for the await hold: any message past `since`? ⚠ ONE row, ONE
 * column, NO ordering — this repeats every `AWAIT_POLL_INTERVAL_MS` for the
 * whole hold and must never materialize a message body. `listMessages` fetches
 * the rows exactly once, after this hits.
 *
 * ⚠ Deliberately does NOT sort: `channel_messages_channel_seq_idx` on
 * `(channel_id, seq)` answers it from the index alone. That index is NOT partial
 * (the only partial one here is `channel_messages_client_msg_key`), so this
 * probe sees all rows.
 */
export async function hasMessagesAfter(
  channelId: string,
  since: number | undefined,
  excludeAuthor?: string
): Promise<boolean> {
  const db = supabaseAdmin();
  let query = db
    .from("channel_messages")
    .select("seq")
    .eq("channel_id", channelId);
  if (since !== undefined) query = query.gt("seq", since);
  // ⚠ Must mirror `listMessages` exactly. A probe hitting on a row the read then
  // filters out spins the hold (fetch, empty, continue) once per tick; a probe
  // MISSING a system row the read would return is the invisibility bug.
  if (excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(excludeAuthor));
  }
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Newest `seq` in a thread that is NOT itself a close proposal, or 0.
 * THIS NUMBER IS THE RE-PROPOSAL WINDOW — `proposeTaskClose` keys idempotency
 * on it. A `(thread, outcome)` key alone is one-shot forever: the agent's second
 * genuine proposal hits `postMessage`'s `client_msg_id` short-circuit and is
 * silently swallowed, while the client (`readCloseProposal` takes the LATEST,
 * `session-card.tsx` dismisses per message id) waits for a row never written.
 *
 * ⚠ THE ANCHOR MUST EXCLUDE PROPOSALS. A proposal IS a message, so keying on the
 * plain newest seq moves the anchor the moment one lands and every retry writes
 * a new row. Excluding them pins the anchor to the last REAL exchange:
 *   • retry — nothing else happened, same anchor, same key, dedupes;
 *   • genuine re-proposal — thread moved on, new anchor, new key, new prompt;
 *   • "keep open" with nothing said after — same anchor, dedupes (correct).
 *
 * ⚠ The `metadata->>` filters are NULL-safe by construction (`closeProposed` is
 * absent on ordinary messages), the same trap `excludeAuthorFilter` documents.
 */
export async function latestThreadActivitySeq(
  channelId: string,
  threadId: string
): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("seq")
    .eq("channel_id", channelId)
    .eq("metadata->>taskId", threadId)
    .or("metadata->>closeProposed.is.null,metadata->>closeProposed.neq.true")
    .order("seq", { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ seq: number }>;
  return rows.length > 0 ? Number(rows[0].seq) : 0;
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
 * One message by per-channel `seq`. Backs the LEGACY thread pair check: a
 * `task-<channelId>-<seq>` id names the opening request at that seq, and its
 * author + `metadata.to_user_id` are the exchange's two participants — ⚠ the
 * ONLY server-side record of who a legacy thread belongs to, since a legacy
 * exchange has no `channel_tasks` row to authorize against.
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
 * Insert via the `channel_message_insert` RPC. ⚠ It takes a per-channel advisory
 * xact lock BEFORE the IDENTITY `seq` is assigned, serializing seq assignment +
 * commit per channel — otherwise an await/read cursor advances past a
 * not-yet-visible lower seq and permanently misses it. A `client_msg_id`
 * unique-violation still surfaces as 23505 for the service layer's convergence.
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
  // ⚠ A single-composite RETURNS comes back as an object — normalize.
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
