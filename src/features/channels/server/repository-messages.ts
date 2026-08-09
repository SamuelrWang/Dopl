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
  /**
   * Drop this author's rows. Only the await hold passes it (so a caller's own
   * posts cannot end its own wait); every other read leaves it unset and the
   * query is the one that always ran.
   *
   * NULL-SAFE SINCE C-17 (2026-08-08, F-171) — see {@link excludeAuthorFilter}.
   */
  excludeAuthor?: string;
  /**
   * Keep only the rows tagged for this thread (`metadata->>'taskId'`). A
   * FILTER, not a lookup: an id no message carries yields `[]`, never an
   * error, and nothing is validated against `channel_tasks` — legacy
   * `task-<channelId>-<seq>` ids are real `metadata.taskId` values too.
   *
   * Reconstructing one exchange used to mean paging the whole channel and
   * filtering client-side; a peer agent burned five paged reads over ~135
   * messages to isolate 14 of them, and the one-shot `limit=200` read that
   * would have avoided the paging blew its own output ceiling.
   */
  threadId?: string;
}

/**
 * THE AUTHOR-EXCLUSION PREDICATE, spelled once — `author_user_id IS NULL OR
 * author_user_id <> $1` (C-17, 2026-08-08, F-171).
 *
 * The plain `.neq("author_user_id", x)` this replaces silently dropped every
 * SYSTEM-AUTHORED row, because SQL `NULL <> x` is NULL, not true. ENGINEERING
 * §8's AUTHOR EXCLUSION note recorded that as an accepted consequence on the
 * grounds that "no writer produces them today" — and then the stale-thread
 * cron became exactly such a writer. Its 14-day close proposal rendered on the
 * web card and was INVISIBLE to any agent holding an await, which is the one
 * surface `dopl_channel` teaches every agent to keep armed.
 *
 * FIXED HERE RATHER THAN AT THE WRITER, and that is the load-bearing choice.
 * `excludeAuthor` means "ignore MY OWN posts, so my own traffic cannot end my
 * own wait" (a caller's own `task_progress` popped its own hold, twice, live).
 * A message with no author is by construction not the caller's own, so
 * dropping it was never the rule being expressed — it was the rule's SQL
 * leaking. Forging an author on the sweep instead would have been wrong twice
 * over: there is no honest candidate (stamping either party puts a close
 * proposal in the mouth of somebody who may disagree with it), and whichever
 * party was stamped would be the one member whose agent still could not see it.
 * A predicate fixed once here also covers every future system writer, which a
 * per-writer convention cannot.
 *
 * `excludeAuthor` is a uuid at every entry (`AwaitQuerySchema` z.string().uuid(),
 * and `opAwait`'s `selfUserId`), so it is safe to interpolate into PostgREST's
 * `or` grammar; nothing else may call this with unvalidated text.
 */
function excludeAuthorFilter(userId: string): string {
  return `author_user_id.is.null,author_user_id.neq.${userId}`;
}

/**
 * With a `since` cursor: messages with `seq > since`, ascending, capped at
 * `limit` — the incremental read for MCP / desktop consumers and the await
 * poll. WITHOUT a cursor: the LATEST `limit` messages, returned ascending —
 * so a channel with more than `limit` messages still surfaces its newest
 * posts. The former unconditional oldest-`limit` read silently hid every
 * message past the first page once a channel grew beyond `limit`.
 *
 * The two cursor modes differ ONLY in the `seq > since` predicate and which
 * end of the ordering the `limit` bites: the optional filters (author
 * exclusion, thread scope) are identical either way, so they are applied once
 * to one builder rather than duplicated per branch — a filter added to only
 * one of two near-identical queries is exactly the bug shape this avoids.
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
  // PostgREST's jsonb accessor: `metadata->>taskId` compares the key as TEXT,
  // so the stored value is matched verbatim (uuid or legacy string alike).
  if (opts.threadId !== undefined) {
    query = query.eq("metadata->>taskId", opts.threadId);
  }
  // Cursor read: oldest-first from the cursor. Cursorless: newest `limit`,
  // then flipped to ascending for display / cursor semantics.
  const cursored = opts.since !== undefined;
  const { data, error } = await query
    .order("seq", { ascending: cursored })
    .limit(opts.limit);
  if (error) throw error;
  const rows = (data ?? []) as ChannelMessageRow[];
  return cursored ? rows : rows.reverse();
}

/**
 * EXISTENCE probe for the await hold (Q8 egress diet): is there any message
 * past `since` in this channel? ONE row, ONE column, no ordering — this is
 * the query that repeats every `AWAIT_POLL_INTERVAL_MS` for the whole hold,
 * so it must never materialize a message body. The full rows are fetched by
 * `listMessages` exactly once, after this hits, right before the hold
 * returns them.
 *
 * Ordering is irrelevant to existence (we only ask "any?"), so this
 * deliberately does NOT sort: the plain btree index
 * `channel_messages_channel_seq_idx` on `(channel_id, seq)` answers it from
 * the index alone. (L4: it is NOT a partial index — the only partial one on
 * this table is `channel_messages_client_msg_key`, the idempotency unique on
 * `client_msg_id IS NOT NULL`. The distinction matters if anyone reasons about
 * which rows this probe can see: all of them.) With no cursor the question
 * degenerates to "does this channel have any message at all", which mirrors
 * the cursorless `listMessages` read that returns the newest page.
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
  // Must mirror `listMessages`: a probe that hits on a row the row read then
  // filters out spins the hold (fetch, empty, continue) once per tick. It also
  // has to mirror the NULL-safety — a probe that MISSES a system row the read
  // would have returned is the C-17 invisibility bug in its other half.
  if (excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(excludeAuthor));
  }
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * The newest `seq` in a thread that is NOT itself a close proposal, or 0 when
 * the thread has no such message (C-6, 2026-08-08, F-172).
 *
 * THIS NUMBER IS THE RE-PROPOSAL WINDOW. `proposeTaskClose`'s idempotency key
 * used to be `(thread, outcome)` and nothing else, so an agent's SECOND genuine
 * proposal — after the human said "keep open", after another hour of work — hit
 * `postMessage`'s `client_msg_id` short-circuit and was silently swallowed. The
 * agent's only terminal act was permanently consumed by its first use, and the
 * stale first prompt came back on every reload, forever. Meanwhile the client
 * was built on the opposite assumption: `readCloseProposal` returns the LATEST
 * proposal and `session-card.tsx` keeps its dismissal local precisely so "the
 * next real proposal" stays visible. Both were correct about a message the
 * server would never write.
 *
 * WHY THE ANCHOR EXCLUDES PROPOSALS, which is the entire trick. Keying on the
 * thread's plain newest seq would make every retry write a new row: a proposal
 * IS a message, so the moment one lands the anchor moves and the retry no
 * longer collides. Excluding proposals pins the anchor to the last piece of
 * REAL exchange, so:
 *   • retry of the same proposal (the response was lost, the session restarted,
 *     the agent is chatty) — nothing else has happened, same anchor, same key,
 *     dedupes exactly as before;
 *   • genuine re-proposal — the thread moved on, new anchor, new key, a new row
 *     the card renders as the live prompt;
 *   • "keep open" with nothing said after it — same anchor, dedupes. Correct:
 *     nothing about the thread changed, so it is the same proposal, and the
 *     original prompt is still standing in the UI.
 *
 * The `metadata->>` filters are NULL-safe by construction (`closeProposed` is
 * absent on ordinary messages, and `->>' '` yields NULL there), which is the
 * same trap `excludeAuthorFilter` documents one screen up.
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
