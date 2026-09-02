import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * DATA ACCESS FOR `channel_pings` — THE "NEEDS YOU" SIGNAL's storage
 * (2026-09-01, `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT**, and not for
 * convenience: `20260907120000_channel_pings.sql` REVOKEs INSERT/UPDATE/DELETE
 * from `authenticated` and `anon` and carries no write policy at all, so there is
 * no other way to write it. That makes the `senderUserId` / `recipientUserId`
 * arguments below THE ENTIRE FENCE, and both come from the authenticated context
 * in `service-pings.ts`. ⚠ **Never read either out of a payload.**
 *
 * 🔒 **THE RECIPIENT PREDICATE IS THE WHOLE ACCESS STORY ON THE READS.** A ping
 * targets exactly one recipient — that is the property the table exists to have
 * and the reason it is not a `channel_messages` row — so a read without
 * `recipient_user_id` would publish every ping to the room and make this a worse
 * message table. There is deliberately no read here that answers for a SENDER:
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
   * ⚠ **NOT A COLUMN.** The channel's slug, attached by
   * {@link hydrateChannelSlugs} after the row read so a reader can build a link
   * without a second round trip. Absent on the insert path's return (the service
   * already holds the channel there) and `undefined` rather than `null` when
   * nothing hydrated it — `toPing`'s `?? null` is what collapses the two.
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
 * ⚠ PostgREST truncates an un-limited select SILENTLY. One page of pings spans a
 * handful of channels at most, so this exists to make truncation loud rather
 * than to bound anything a reader will reach.
 */
const SLUG_HYDRATION_LIMIT = 200;

/**
 * Attach `channel_slug` to a page of rows — A SECOND BATCHED READ, NOT A JOIN.
 *
 * ⚠ **THE STYLE IS THE TREE'S, AND IT IS DELIBERATE.** No repository in
 * `features/channels` issues a PostgREST relational select; the workspace await
 * hydrates its channel labels the same way (`repository-await-workspace.ts ›
 * listMemberChannelRefs` — memberships, then channels), and
 * `app/api/user/delete/route.ts` records why: `!inner` embeds return opaque 500s
 * on this schema. A third style here would be a shape a future reader has to
 * learn to debug.
 *
 * ⚠ IT WIDENS NOTHING. The ids come from rows the recipient fence already
 * returned, so this read can only name channels the caller is a party to a ping
 * in. A channel deleted under a ping simply resolves to nothing, and the row
 * keeps a `null` slug rather than a fabricated label.
 */
async function hydrateChannelSlugs(
  workspaceId: string,
  rows: ChannelPingRow[]
): Promise<ChannelPingRow[]> {
  if (rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r.channel_id))];
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channels")
    .select("id, slug")
    .eq("workspace_id", workspaceId)
    .in("id", ids)
    .limit(SLUG_HYDRATION_LIMIT);
  if (error) throw error;
  const slugs = new Map(
    ((data ?? []) as Array<{ id: string; slug: string }>).map((c) => [
      c.id,
      c.slug,
    ])
  );
  return rows.map((row) => ({
    ...row,
    // ⚠ `null` WHEN IT DID NOT RESOLVE, never an empty string: a render must fall
    // back to the id rather than print a blank label.
    channel_slug: slugs.get(row.channel_id) ?? null,
  }));
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
  opts: { since?: number; limit: number }
): Promise<ChannelPingRow[]> {
  const db = supabaseAdmin();
  let query = db
    .from(TABLE)
    .select("*")
    // 🔒 THE FENCE. This runs on the admin client, so the argument IS the security.
    .eq("recipient_user_id", recipientUserId)
    .eq("workspace_id", workspaceId);
  if (opts.since !== undefined) query = query.gt("seq", opts.since);
  const { data, error } = await query
    .order("seq", { ascending: true })
    .limit(opts.limit);
  if (error) throw error;
  return hydrateChannelSlugs(workspaceId, (data ?? []) as ChannelPingRow[]);
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
 * sets are `recipient_user_id`, `workspace_id` and `seq > since`, and they change
 * together or not at all.
 */
export async function hasPingForRecipient(
  recipientUserId: string,
  workspaceId: string,
  since: number | undefined
): Promise<boolean> {
  const db = supabaseAdmin();
  let query = db
    .from(TABLE)
    .select("id")
    .eq("recipient_user_id", recipientUserId)
    .eq("workspace_id", workspaceId);
  if (since !== undefined) query = query.gt("seq", since);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
