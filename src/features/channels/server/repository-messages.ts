import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "./dto";
// ⚠ SPLIT ON THE 500-LINE CAP (2026-09-05): the two bounded recent-activity reads.
export {
  listRecentRoomAgentPosts,
  listRecentRoomTagsBy,
  type RecentAgentPostRow,
  type RecentAuthorTagRow,
} from "./repository-messages-recent";
// ⚠ SAME SPLIT, SAME REASON (2026-09-05, task 13b): the two reads that find the
// typist's most recent OPEN decision card. Re-exported so the service layer
// keeps one `repoMessages.*` namespace and existing mocks keep covering them.
export {
  listRecentEscalations,
  listAnsweredEscalationIds,
  ESCALATION_SCAN_LIMIT,
} from "./repository-messages-escalations";

/**
 * Pure data access for `channel_messages` — per-channel `seq` ordering, the
 * advisory-locked insert RPC, cursor reads. ⚠ Service-role admin client
 * (RLS-bypassing); visibility + authz live in the SERVICE layer.
 */

interface MessageReadOpts {
  since?: number;
  /**
   * BACKWARD KEYSET CURSOR — `seq < before`, the page of history immediately
   * OLDER than the caller's current window. It is what the transcript's
   * scroll-up paging asks for, and it is a CURSOR, never an offset: the
   * predicate rides `channel_messages_channel_seq_idx` on `(channel_id, seq)`,
   * so page N costs the same as page 1 and a message inserted mid-scroll cannot
   * shift a row across a page boundary the way `OFFSET` does.
   *
   * ⚠ IT DECIDES WHICH END THE `limit` BITES, not just which rows qualify — see
   * {@link listMessages}. `before` without that flip would hand back the OLDEST
   * `limit` rows in the channel on every page, which is the same page forever.
   */
  before?: number;
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
 * THREE MODES, ONE BUILDER, and the only thing that varies is which end the
 * `limit` bites:
 *
 *  - **FORWARD** (`since`, no `before`): `seq > since`, ascending, capped at
 *    `limit` — the incremental read for MCP / desktop and the await poll.
 *  - **BACKWARD** (`before`): `seq < before`, the `limit` rows NEAREST that
 *    ceiling, returned ascending — the transcript's scroll-up page. It composes
 *    with `since` as a bounded window rather than fighting it.
 *  - **NEWEST** (neither): the LATEST `limit`, returned ascending, so a long
 *    channel still surfaces its newest posts (an unconditional oldest-`limit`
 *    read hides everything past the first page).
 *
 * ⚠ ONLY `forward` READS ASCENDING FROM THE DATABASE. The other two take the
 * newest qualifying rows (descending + `limit`) and flip them for display; a
 * `before` page read ascending would return the channel's oldest `limit` rows
 * every time, i.e. the same page forever.
 *
 * ⚠ Optional filters are applied ONCE to one builder rather than duplicated per
 * branch — a filter added to only one of three near-identical queries is the
 * exact bug shape this avoids.
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
  if (opts.before !== undefined) query = query.lt("seq", opts.before);
  if (opts.excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(opts.excludeAuthor));
  }
  // ⚠ `metadata->>taskId` compares as TEXT, so the stored value matches
  // verbatim — uuid or legacy string alike.
  if (opts.threadId !== undefined) {
    query = query.eq("metadata->>taskId", opts.threadId);
  }
  // FORWARD: oldest-first from the cursor. BACKWARD / NEWEST: the newest
  // qualifying `limit`, flipped to ascending for display / cursor semantics.
  const forward = opts.since !== undefined && opts.before === undefined;
  const { data, error } = await query
    .order("seq", { ascending: forward })
    .limit(opts.limit);
  if (error) throw error;
  const rows = (data ?? []) as ChannelMessageRow[];
  return forward ? rows : rows.reverse();
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

// ⚠ `findMessageByClientId` — the CHANNEL-SCOPED read of (channel,
// client_msg_id) — STOOD HERE AND IS DELETED (2026-09-02). Its one caller was
// `service-tasks.ts › storedOpeningSeq`, the arm a create took when it converged
// on SOMEBODY ELSE's thread. Author-scoping the thread probe
// (`repository-tasks.ts › findOwnTaskByClientId`) removed that arm: a colliding
// key from another member yields a separate thread instead of converging, so
// nothing reads across authors any more. Deleted with its caller rather than
// left exported — an orphan repository helper is invisible to the orphan check
// and reads as a live door.

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
 * not the argument order here. When it was chosen, the leading pair kept a
 * CROSS-author read index-served; that read is gone (see the note above) and the
 * order is kept because re-creating an index is a data question, not a cleanup.
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

/**
 * ONE MESSAGE BY ID, SCOPED TO ITS CHANNEL.
 *
 * ⚠ **THE `channel_id` PREDICATE IS THE FENCE, NOT A NARROWING.** `id` is a
 * uuid and unique on its own, so the extra `eq` looks redundant and is the whole
 * authorization: the caller has already been proved a member of THIS channel,
 * and without it an escalation answer could name a message in a room the caller
 * has never been in. It is why this is not `findMessageById(id)`.
 *
 * ⚠ `select("*")` because the one reader needs the METADATA, the AUTHOR and the
 * `client_msg_id` — the three columns a narrow select would have had to name
 * anyway, plus a body it ignores. `findMessageBySeq` above makes the opposite
 * trade for the opposite reason; both live here so a third copy has somewhere
 * obvious to not be added.
 */
export async function findMessageById(
  channelId: string,
  id: string
): Promise<ChannelMessageRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelMessageRow | null) ?? null;
}

// ⚠ **THE DELIVERY COLUMN'S TWO STATEMENTS LIVE IN `repository-delivery.ts`**
// (split 2026-09-02 at the 500-line cap; §1's rule is "split, do not squeeze").
// The seam is real rather than arithmetic: everything here is about WRITING and
// READING a message, and those two are about the ack lane's own column — one
// monotonic UPDATE and the read that answers "who was this for". They move
// together because `service-writes-delivery.ts` is the only caller of either.

type MessageInsert = {
  channel_id: string;
  workspace_id: string;
  author_user_id: string | null;
  author_kind: string;
  kind: string;
  body: string;
  metadata: Record<string, unknown>;
  client_msg_id: string | null;
  // ── THE DELIVERY KEYSTONE (20260912120000) ──────────────────────────────
  // ⚠ WRITTEN THROUGH THE RPC, not by a second statement afterwards. The RPC
  // holds the per-channel advisory lock, so a follow-up UPDATE would open a
  // window in which a realtime subscriber sees the row without its verdict.
  wake_verdict: string | null;
  recipient_user_ids: string[] | null;
  recipient_agent_ids: string[] | null;
  delivery: string | null;
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
    p_wake_verdict: row.wake_verdict,
    p_recipient_user_ids: row.recipient_user_ids,
    p_recipient_agent_ids: row.recipient_agent_ids,
    p_delivery: row.delivery,
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
/**
 * **RR2's ONE READ** (2026-09-02, v2 wave B slice B4 — ruling B1): the newest
 * MAIN-ROOM message in this channel, inside the resilience window, whose STORED
 * recipient set names this agent. `null` when nobody has addressed it there
 * lately.
 *
 * ⚠ **IT READS THE STORED RESOLUTION, NEVER THE BODY.** `recipient_agent_ids` is
 * what `service-wake-verdict.ts` wrote at the time, so this asks "who addressed
 * this agent" in exactly the vocabulary the server itself used — a body re-parse
 * here would be a fifth spelling of the addressing rule and would disagree with
 * the row it is reading.
 *
 * ⚠ **`seq` IS THE ORDER AND `seq` IS UNIQUE PER CHANNEL**
 * (`channel_messages_channel_seq_idx`, and the advisory-locked insert RPC makes
 * commit order monotonic). So "the highest one" is TOTAL: no tie is
 * representable and there is no tie-break to get wrong. Ordering by `created_at`
 * instead would reintroduce one, because two rows can share a timestamp.
 *
 * ⚠ **`thread IS NULL` IS SPELLED `metadata->>taskId IS NULL`** — the same
 * expression `listMessages`' `threadId` filter uses, and the thread tag has no
 * column of its own. A row tagged into a thread is RR1's business, never RR2's.
 *
 * ⚠ NO INDEX ON `recipient_agent_ids`, deliberately — the migration's section 3
 * records why, and the measurement to record if that ever changes.
 */
export async function findLastRoomAddressToAgent(
  channelId: string,
  agentId: string,
  sinceIso: string
): Promise<ChannelMessageRow | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .is("metadata->>taskId", null)
    .gt("created_at", sinceIso)
    .contains("recipient_agent_ids", [agentId])
    .order("seq", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as ChannelMessageRow | undefined) ?? null;
}


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
