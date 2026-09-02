import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * DATA ACCESS FOR `channel_pings` — THE "NEEDS YOU" SIGNAL's storage
 * (2026-09-01, `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT**, and not for
 * convenience: `20260907130000_channel_pings.sql` REVOKEs INSERT/UPDATE/DELETE
 * from `authenticated` and `anon` and carries no write policy at all, so there is
 * no other way to write it. That makes the `senderUserId` / `recipientUserId`
 * arguments below THE ENTIRE FENCE, and both come from the authenticated context
 * in `service-pings.ts`. ⚠ **Never read either out of a payload.**
 *
 * 🔒 **THE READS CARRY BOTH FENCES AT ONCE — PARTY *AND* CHANNEL MEMBERSHIP —
 * BECAUSE THE RLS POLICY DOES** (`channel_pings_party_select`). A ping targets
 * exactly one recipient — that is the property the table exists to have and the
 * reason it is not a `channel_messages` row — so a read without
 * `recipient_user_id` would publish every ping to the room and make this a worse
 * message table. And `channel_ids` is the second half: the admin client bypasses
 * RLS, so a recipient-only read here would deliver pings about rooms the caller
 * has been REMOVED from, which the client lane refuses. ⚠ **`channelIds` MUST be
 * a set the request PROVED** (`repository-await-workspace.ts ›
 * listMemberChannelRefs` is the only legitimate source); never build it from
 * anything a caller sent. There is deliberately no read here that answers for a
 * SENDER:
 * no statement needs one, and the migration's own note ("NO INDEX ON
 * `sender_user_id`, DELIBERATELY") is the storage half of the same decision.
 *
 * ⚠ `seq` IS A SEPARATE CURSOR SPACE FROM `channel_messages.seq`. Nothing here
 * may be handed a message cursor and nothing here may hand one out; a caller that
 * crosses the two reads a plausible, wrong page rather than an error.
 */

/** One ping row. Column names, because this is what the database stores. */
export type ChannelPingRow = {
  id: string;
  /** THE PING CURSOR — table-global, monotonic, and GAPPY for any one reader. */
  seq: number;
  workspace_id: string;
  channel_id: string;
  /** Wire/storage name `task` == domain name `thread`. `ON DELETE SET NULL`. */
  task_id: string | null;
  /** ⚠ ALWAYS `ctx.userId`, never a request field. */
  sender_user_id: string;
  /** ⚠ A CAPTION AND NOTHING ELSE (`types-ping.ts › ChannelPing.senderAgentId`).
   *  Optional on the type as well as nullable, so a row read by a server whose
   *  migration has not replayed yet is `undefined` rather than a type error. */
  sender_agent_id?: string | null;
  recipient_kind: string;
  /** ⚠ WHOSE INBOX. Stamped `ctx.userId` for `agent` and `desktop`. */
  recipient_user_id: string;
  recipient_agent_id: string | null;
  kind: string;
  body: string;
  created_at: string;
  /**
   * ⚠ **NOT A COLUMN.** The channel's slug, attached by the SERVICE from the
   * membership proof it already holds (`service-pings.ts › listPings`) so a
   * reader can build a link without a second round trip. ⚠ There is deliberately
   * NO hydration read here: the proof that fences the query carries the labels,
   * and a second `channels` read would be one more way for the two to disagree.
   * `undefined` rather than `null` when nothing attached it — `toPing`'s
   * `?? null` is what collapses the two.
   */
  channel_slug?: string | null;
};

/** What a create supplies. ⚠ `sender_user_id` is ABSENT ON PURPOSE — it is a
 *  separate argument so no caller can pass one inside an object it built from a
 *  request body. Same discipline as `AgentDirectionInsert`. */
export type ChannelPingInsert = {
  workspace_id: string;
  channel_id: string;
  task_id: string | null;
  /** ⚠ **NOT CALLER-SUPPLIED.** Derived by the SERVICE from the transport's
   *  `X-Dopl-Session-Id` (`service-directions.ts › senderAgentIdFrom`), so the
   *  "no schema on this path accepts an identity" rule stays intact. */
  sender_agent_id: string | null;
  /** ⚠ STAMPED BY THE SERVICE from WHICH argument the caller used, never sent. */
  recipient_kind: string;
  /** 🔒 WHOSE INBOX, and the loop brake lives here: for `agent` and `desktop` the
   *  service writes `ctx.userId` and there is no request field that could say
   *  otherwise, so an agent can never ping another member's agent. */
  recipient_user_id: string;
  recipient_agent_id: string | null;
  kind: string;
  body: string;
};

const TABLE = "channel_pings";

export async function insertPing(
  senderUserId: string,
  input: ChannelPingInsert
): Promise<ChannelPingRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from(TABLE)
    // ⚠ THE STAMP GOES LAST so no key inside `input` can shadow it. The type
    // above already refuses such a field; spreading first makes that belt hold
    // even if a future edit widens the type or a caller casts around it.
    .insert({ ...input, sender_user_id: senderUserId })
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelPingRow;
}

/**
 * ONE PAGE OF A RECIPIENT'S INBOX — `seq > since` for THIS person, ASCENDING.
 *
 * ⚠ ASCENDING BY `seq`, which is what makes the cursor work: a caller that
 * advances to the highest seq on the page has provably seen everything below it,
 * and a page clipped by `limit` is resumed rather than skipped. ⚠ Never reorder
 * this to newest-first for a UI's convenience — a UI reverses a page, a cursor
 * cannot un-skip a row.
 *
 * ⚠ `workspace_id` IS A SECOND PREDICATE, NOT A SUBSTITUTE FOR THE FIRST. A
 * device token is workspace-bound; the recipient predicate is what makes the
 * answer one person's.
 */
export async function listPingsForRecipient(
  recipientUserId: string,
  workspaceId: string,
  channelIds: string[],
  opts: { since?: number; limit: number }
): Promise<ChannelPingRow[]> {
  // ⚠ AN EMPTY PROOF IS AN EMPTY ANSWER, never an unfenced query. PostgREST's
  // `in.()` on an empty list is a grammar the server need not be asked to parse.
  if (channelIds.length === 0) return [];
  const db = supabaseAdmin();
  let query = db
    .from(TABLE)
    .select("*")
    // 🔒 BOTH FENCES. This runs on the admin client, so the arguments ARE the security.
    .eq("recipient_user_id", recipientUserId)
    .eq("workspace_id", workspaceId)
    .in("channel_id", channelIds);
  if (opts.since !== undefined) query = query.gt("seq", opts.since);
  const { data, error } = await query
    .order("seq", { ascending: true })
    .limit(opts.limit);
  if (error) throw error;
  return (data ?? []) as ChannelPingRow[];
}

/**
 * IS ANYTHING PAST `since` IN THIS PERSON'S INBOX — the existence probe behind
 * one tick of the ping hold.
 *
 * ⚠ **ONE COLUMN ONLY.** `select("id").limit(1)` is the whole point of a probe:
 * a hold armed continuously is a structurally growing egress consumer, and a tick
 * that fetched a page to learn a boolean would pay for that page every interval,
 * forever.
 *
 * ⚠ **ITS FILTERS MUST MIRROR {@link listPingsForRecipient} FILTER FOR FILTER**,
 * and that is `service-await-workspace.ts`'s rule restated for this fence: a
 * probe that HITS on a row the read then drops spins the hold
 * fetch-empty-continue, one extra pair of queries per tick; a probe that MISSES a
 * row the read would return is the invisibility bug — a signal that never wakes
 * anybody, which is the exact failure this table exists to fix. The two filter
 * sets are `recipient_user_id`, `workspace_id`, the PROVEN `channel_id` set and
 * `seq > since`, and they change together or not at all.
 */
export async function hasPingForRecipient(
  recipientUserId: string,
  workspaceId: string,
  channelIds: string[],
  since: number | undefined
): Promise<boolean> {
  if (channelIds.length === 0) return false;
  const db = supabaseAdmin();
  let query = db
    .from(TABLE)
    .select("id")
    .eq("recipient_user_id", recipientUserId)
    .eq("workspace_id", workspaceId)
    .in("channel_id", channelIds);
  if (since !== undefined) query = query.gt("seq", since);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
