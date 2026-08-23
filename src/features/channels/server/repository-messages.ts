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
 * (the only partial one here is the idempotency index —
 * `channel_messages_client_msg_author_key` since 2026-08-22), so this probe sees
 * all rows.
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
 * ⚠ `latestThreadActivitySeq` USED TO LIVE HERE — the newest `seq` in a thread
 * that was not itself a close proposal. Its ONE caller was
 * `service-tasks-propose.ts › proposeTaskClose`, which keyed a re-proposal on
 * it; both are DELETED with thread closing (wiring plan Phase 4, 2026-08-18).
 *
 * ⚠ IT WAS THE PRODUCTION ORPHAN THIS PHASE ALMOST LEFT BEHIND, and the reason
 * is worth knowing: `npx knip` did NOT flag it, because its `.test.ts` still
 * imported it and knip counts a test as a consumer. **A test-only export is
 * invisible to the orphan check.** When a service goes, grep its repository
 * helpers by hand.
 *
 * Two rules it demonstrated survive it. **An idempotency anchor must EXCLUDE the
 * rows it keys** — a proposal is a message, so keying on the plain newest seq
 * moved the anchor the instant one landed and turned every retry into a new
 * row. And **a `metadata->>` filter is NULL-safe only by construction**: the key
 * is ABSENT on ordinary rows, so `->>` yields NULL and a bare `neq` drops every
 * real message — the same trap `excludeAuthorFilter` documents above.
 */

/**
 * ⚠ TWO READS OF (channel, client_msg_id), AND THE AUTHOR SCOPE IS THE WHOLE
 * DIFFERENCE — 2026-08-22. They are deliberately NOT merged and neither may be
 * substituted for the other.
 *
 * THIS one is CHANNEL-SCOPED and is a plain READ of a DERIVED key. Its only
 * caller is `service-tasks.ts › storedOpeningSeq`, where reading ACROSS authors
 * is the documented behaviour: a create that converged on somebody else's thread
 * posts nothing and reads the WINNER's opening seq
 * (`service-tasks.ts › convergeOnThread`). Author-scoping it would answer `null`
 * for exactly the case it exists to serve.
 *
 * ⚠ IT IS NOT AN IDEMPOTENCY PROBE, AND USING IT AS ONE IS THE SECURITY BUG THIS
 * SPLIT FIXES. See {@link findOwnMessageByClientId}.
 */
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
 * THE IDEMPOTENCY PROBE — (channel, AUTHOR, client_msg_id). `postMessage`'s
 * short-circuit and its lost-race repair, and nothing else.
 *
 * ⚠ WHY THE AUTHOR IS PART OF THE KEY, stated as the vulnerability it closes.
 * Idempotency is a SAME-AUTHOR RETRY contract: "I already sent this, give me
 * back what you stored". The probe used to be channel-scoped, which made it a
 * contract with the whole ROOM — so any channel member could pre-claim a
 * `client_msg_id` another member's agent was ABOUT to use and have the server
 * hand that agent back the attacker's row instead of writing its post. The keys
 * are not secret and they are not random: the desktop stamps
 * `agent-<agentId>-<n>` (`dopl-desktop-app/main/session-outbound-tag.js`), the
 * agent id is publicly readable off `channel_sessions.name`, and `n` counts from
 * 1 — so the next several keys of every visible agent are guessable. The victim
 * agent's reply returned `{ok}` with somebody else's message id and the peer
 * waiting on the thread got nothing, with no error on either side.
 *
 * ⚠ THE DATABASE AGREES WITH THIS FUNCTION, and it has to: the unique index is
 * `(channel_id, client_msg_id, author_user_id)`
 * (`supabase/migrations/20260822120000_channel_messages_author_scoped_idempotency.sql`).
 * Scoping only the READ would turn the swallow into a `23505` the caller sees as
 * a 500. Change one, change both.
 *
 * ⚠ COLUMN ORDER IN THAT INDEX IS `(channel_id, client_msg_id, author_user_id)`,
 * not the argument order here — the leading pair is what keeps
 * {@link findMessageByClientId} above index-served.
 */
export async function findOwnMessageByClientId(
  channelId: string,
  authorUserId: string,
  clientMsgId: string
): Promise<ChannelMessageRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("client_msg_id", clientMsgId)
    .eq("author_user_id", authorUserId)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelMessageRow | null) ?? null;
}

// ⚠ `findMessageAuthorBySeq` STOOD HERE AND IS DELETED (2026-08-22). Its ONE
// caller was `consent-service.ts › createConsentRequest`, deriving
// `requester_user_id` from the message that triggered an INBOUND consent
// request — the lane Samuel retired. It moved into this file from
// `repository-collab.ts` two days earlier, which is exactly the kind of history
// that makes a dead reader look live: it had a recent, deliberate-looking
// change and no callers behind it. {@link findMessageBySeq} below is the
// surviving (channel, seq) read and answers a different question — the LEGACY
// thread pair check needs the whole row, not just the author.

/**
 * One message by per-channel `seq`. Backs the LEGACY thread pair check: a
 * `task-<channelId>-<seq>` id names the opening request at that seq, and its
 * author + `metadata.to_user_id` are the exchange's two participants — ⚠ the
 * ONLY server-side record of who a legacy thread belongs to, since a legacy
 * exchange has no `channel_tasks` row to authorize against.
 */
/**
 * ⚠ TWO READS OF (channel, seq), AND THE PROJECTION IS THE WHOLE DIFFERENCE.
 * This one returns the ROW; {@link findMessageAuthorBySeq} below returns only
 * `author_user_id`. They are deliberately NOT merged — the consent path derives
 * a requester from a message whose body can be 16 KB, and paying for that body
 * to read one column is the cost the narrow select exists to avoid.
 * ⚠ They live in ONE file so a third copy has somewhere obvious to not be added.
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

/**
 * HARD-DELETE every message tagged for one thread, and hand back the `seq`s that
 * actually went — the first step of the thread cascade
 * (`service-tasks-delete.ts › deleteTask`).
 *
 * ⚠ THE TAG IS THE ONLY LINK. `channel_messages` has NO foreign key into
 * `channel_tasks` (INVARIANTS §5 — the transcript rides on `metadata.taskId`), so
 * deleting the thread row cascades NOTHING here. This statement IS the cascade,
 * and it has to run before the task row goes or the messages are orphaned onto an
 * id that resolves to nothing.
 *
 * ⚠ INDEXED, NOT A SCAN: `channel_messages_thread_activity_idx` on
 * `(channel_id, (metadata ->> 'taskId'))` (migration `20260807160000`) answers
 * exactly this predicate. Both terms are named, in that order.
 *
 * ⚠ `metadata->>taskId` compares as TEXT — same rule {@link listMessages}
 * follows, so a legacy `task-<channelId>-<seq>` tag is matched verbatim rather
 * than cast and lost.
 *
 * ⚠ THE RETURNED SEQS ARE THE CONSENT CASCADE'S KEY. `channel_consent_requests`
 * points at its trigger through `message_seq` with no FK, so the only honest way
 * to find the rows a deletion just stranded is to be told which seqs left. `seq`
 * is a TABLE-wide identity (§5), so the numbers are globally unique and need no
 * channel qualifier downstream.
 *
 * ⚠ `channel_mention_reads` needs NO statement here: its `message_id` FK is
 * `ON DELETE CASCADE` (`20260818140000`), so the read-state rows go with these
 * rows inside the same statement.
 */
export async function deleteMessagesByThread(
  channelId: string,
  threadId: string
): Promise<number[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .delete()
    .eq("channel_id", channelId)
    .eq("metadata->>taskId", threadId)
    .select("seq");
  if (error) throw error;
  return ((data ?? []) as Array<{ seq: number }>).map((r) => r.seq);
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
