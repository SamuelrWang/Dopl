import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ChannelMessageRow } from "./dto";
import type { SessionStateRow } from "./collab-dto";
import { sessionRowsWhere } from "./repository-sessions";

/**
 * DATA ACCESS FOR THE **ACCOUNT-WIDE** CHANNEL READS — the ones that answer
 * across EVERY workspace and EVERY home-channel container at once
 * (`service-account.ts`, behind `GET /api/channels/account/**`).
 *
 * ── 🔒 THE FENCE, AND IT IS ONE PREDICATE ──────────────────────────────────
 *
 * **`channel_members.user_id = <caller>`, and nothing else.** Every read below
 * takes a `channelIds` array, and {@link listAccountChannelRefs} is the ONLY
 * legitimate source of one. That array is literally the `WHERE channel_id IN
 * (…)` of every query here, exactly as it is for the workspace-wide await
 * (`repository-await-workspace.ts`) — a channel the caller is not a member of is
 * never NAMED, not merely filtered out afterwards.
 *
 * ⚠ **THIS IS A NARROWING OF THE WORKSPACE-WIDE READ, NOT A WIDENING.** Dropping
 * the `workspace_id` filter looks like the scary direction and is the safe one:
 * the workspace filter never granted anything, it only ever removed rows the
 * membership predicate had already admitted. What replaces it is nothing,
 * because there was nothing there to replace — a caller is a member of the
 * channels they are a member of, wherever those channels live.
 *
 * ⚠ **MEMBERSHIP, DELIBERATELY NOT `op="read"`'s VISIBILITY.** A channel read
 * admits a non-member to a PUBLIC channel (INVARIANTS §5) and these reads do
 * not — the same decision, for the same reason, that
 * `listMemberChannelRefs` records: an orchestrator's check-in must not fill with
 * rooms nobody invited it into. Fewer rows can never be a leak.
 *
 * ⚠ **EVERY FUNCTION USES THE RLS-BYPASSING ADMIN CLIENT.** Never build a
 * `channelIds` array from anything a caller sent.
 *
 * ── WHY IT IS ITS OWN MODULE ───────────────────────────────────────────────
 *
 * The same two reasons `repository-await-workspace.ts` gives. `repository.ts` is
 * at the §1 cap; and more importantly a THIRD set of queries with a THIRD fence
 * sitting beside the hot per-channel pair is how one of them gets "unified" with
 * another and quietly inherits the wrong `WHERE`.
 */

/** A read that may have hit its ceiling. ⚠ AT the ceiling counts as clipped —
 *  at is indistinguishable from over (INVARIANTS §9). */
export interface AccountScan<T> {
  rows: T[];
  truncated: boolean;
}

function scan<T>(rows: T[], limit: number): AccountScan<T> {
  return { rows, truncated: rows.length >= limit };
}

/**
 * One channel the caller belongs to, with the two labels a cross-tenancy page
 * needs: what to CALL it, and which workspace to pass as `workspace=` to reach
 * it with any other tool.
 */
export interface AccountChannelRef {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
}

/**
 * ⚠ A ceiling, so PostgREST's silent truncation becomes a reported one. An
 * account's channel count is small (a room per working relationship, plus one
 * per home channel), so this exists to make a clip LOUD rather than to bound
 * anything anyone will reach.
 */
export const ACCOUNT_CHANNEL_LIMIT = 500;

/** One account-wide message page. ⚠ The same 200 every other channel page uses
 *  — the page is wider in CHANNELS, not in messages, and a bigger cap here would
 *  let one busy room's burst crowd every other room off the page. */
export const ACCOUNT_MESSAGE_LIMIT = 200;

/**
 * ⚠ The unread TALLY reads `(channel_id, seq)` and nothing else, so it is cheap
 * per row and the ceiling can be high. Past it the counts are a FLOOR and the
 * service says so — a count rendered as exact when it was clipped is the §9
 * failure this constant exists to make visible.
 */
export const ACCOUNT_TALLY_LIMIT = 1_000;

/** How many "addressed to you" items one status answer carries. */
export const ACCOUNT_ADDRESSED_LIMIT = 50;

/**
 * How far back the caller's OWN messages are scanned to decide whether an
 * addressed message has been answered. ⚠ Bounded, and the failure direction is
 * SHOWING AN EXTRA CARD rather than hiding one: a channel whose rows all fall
 * below this window contributes no "I replied" evidence, so its item stays open.
 */
export const ACCOUNT_OWN_REPLY_LIMIT = 500;

/**
 * 🔒 **THE PROOF OF ACCESS FOR EVERY ACCOUNT-WIDE READ** — every LIVE channel
 * the caller is a member of, in any workspace and any home-channel container.
 *
 * ⚠ `deleted_at IS NULL` is not optional: a soft-deleted channel is NOT-FOUND to
 * every other read and a membership row outlives the tombstone.
 * ⚠ ARCHIVED channels are KEPT — archive is a sidebar state, not a revocation,
 * and `resolveReadableChannelId` admits one too.
 * ⚠ `workspace_id` comes off the MEMBERSHIP row, which carries it denormalised,
 * so the tenancy of each channel is known without a second join.
 *
 * ⚠ **`lockedWorkspaceId` IS `ctx.apiKeyWorkspaceId`, NEVER A REQUEST FIELD**
 * (R3). Absent/null ⇒ every tenancy, which is what an ordinary session or device
 * token gets. Set ⇒ that one, and the narrowing is total: no query below can
 * name a channel outside it, because none of them is handed an id from it.
 *
 * TWO QUERIES, for any number of workspaces.
 */
export async function listAccountChannelRefs(
  userId: string,
  lockedWorkspaceId?: string | null
): Promise<AccountScan<AccountChannelRef>> {
  const db = supabaseAdmin();
  let memberQuery = db
    .from("channel_members")
    .select("channel_id, workspace_id")
    .eq("user_id", userId);
  // 🔒 B1's CEILING, APPLIED AT THE PROOF (R3, 2026-09-02). A container-locked
  // credential may act in ONE workspace, and these reads are the only ones in
  // the tree that span tenancies — so the lock has to narrow the very array that
  // becomes every `WHERE channel_id IN (…)` below. Applied here rather than in
  // the service because a filter downstream of the proof is a filter a future
  // caller can forget.
  if (lockedWorkspaceId) {
    memberQuery = memberQuery.eq("workspace_id", lockedWorkspaceId);
  }
  const { data: memberships, error: memberError } = await memberQuery.limit(
    ACCOUNT_CHANNEL_LIMIT
  );
  if (memberError) throw memberError;
  const rows = (memberships ?? []) as Array<{
    channel_id: string;
    workspace_id: string;
  }>;
  if (rows.length === 0) return { rows: [], truncated: false };
  const workspaceByChannel = new Map(
    rows.map((r) => [r.channel_id, r.workspace_id])
  );

  const { data, error } = await db
    .from("channels")
    .select("id, name, slug")
    .is("deleted_at", null)
    .in("id", [...workspaceByChannel.keys()])
    .limit(ACCOUNT_CHANNEL_LIMIT);
  if (error) throw error;
  const channels = ((data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
  }>).map((c) => ({
    ...c,
    // ⚠ Non-null by construction — the id set came from `workspaceByChannel`.
    workspaceId: workspaceByChannel.get(c.id) as string,
  }));
  // ⚠ The MEMBERSHIP read is the one that can clip: the channel read is bounded
  // by the id set it was handed, so a truncated answer there would mean rows
  // vanished between the two statements, not that a page ended.
  return { rows: channels, truncated: rows.length >= ACCOUNT_CHANNEL_LIMIT };
}

/**
 * THE AUTHOR-EXCLUSION PREDICATE — `author_user_id IS NULL OR <> $1`.
 *
 * ⚠ A DELIBERATE THIRD COPY of the string in `repository-messages.ts` and
 * `repository-await-workspace.ts`, pinned by `repository-account.test.ts` rather
 * than removed. The rule it encodes — **a NULL author is never "my own post", so
 * a SYSTEM row must not be dropped by an exclusion** — is the half that must not
 * drift; the three fences around it are different, and a shared helper between
 * three query families whose `WHERE` clauses differ is how one of them inherits
 * the wrong one. That trade is `repository-await-workspace.ts`'s, made twice.
 *
 * ⚠ `userId` is a uuid at every entry, so interpolating into PostgREST's `or`
 * grammar is safe.
 */
function excludeAuthorFilter(userId: string): string {
  return `author_user_id.is.null,author_user_id.neq.${userId}`;
}

/**
 * One account-wide message page: `seq > since` across `channelIds`, ASCENDING,
 * capped.
 *
 * ⚠ **`seq` IS A TABLE-WIDE IDENTITY (`channel_messages.seq BIGINT GENERATED
 * ALWAYS AS IDENTITY`), WHICH IS WHY ONE CURSOR IS LEGAL HERE.** It is not merely
 * workspace-global: the sequence is allocated per TABLE, so ordering by it
 * interleaves every channel of every workspace and every home container in true
 * arrival order, and a caller that advances to the highest seq on a page has
 * provably seen everything below it EVERYWHERE. No second cursor, no per-channel
 * and no per-workspace bookkeeping.
 *
 * ⚠ ALWAYS CURSORED at the route. A cursorless account-wide read is the newest N
 * messages of somebody's whole working life, which is a firehose and not a read.
 */
export async function listAccountMessagesAfter(
  channelIds: string[],
  since: number,
  limit: number,
  excludeAuthor?: string
): Promise<AccountScan<ChannelMessageRow>> {
  if (channelIds.length === 0) return { rows: [], truncated: false };
  const capped = Math.min(Math.max(1, limit), ACCOUNT_MESSAGE_LIMIT);
  const db = supabaseAdmin();
  let query = db
    .from("channel_messages")
    .select("*")
    .in("channel_id", channelIds)
    .gt("seq", since);
  if (excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(excludeAuthor));
  }
  const { data, error } = await query
    .order("seq", { ascending: true })
    .limit(capped);
  if (error) throw error;
  return scan((data ?? []) as ChannelMessageRow[], capped);
}

/**
 * HOW MANY are past `since`, per channel — the unread half of a status answer.
 *
 * ⚠ **TWO COLUMNS AND NOTHING ELSE.** The point of a status read is to say WHERE
 * to look; hauling bodies to count them is the payload §9 exists to prevent, and
 * a `head: true` count per channel would be one round trip per room, which is
 * the fan this whole endpoint replaces.
 */
export async function tallyAccountMessagesAfter(
  channelIds: string[],
  since: number,
  excludeAuthor?: string
): Promise<AccountScan<{ channel_id: string; seq: number }>> {
  if (channelIds.length === 0) return { rows: [], truncated: false };
  const db = supabaseAdmin();
  let query = db
    .from("channel_messages")
    .select("channel_id, seq")
    .in("channel_id", channelIds)
    .gt("seq", since);
  if (excludeAuthor !== undefined) {
    query = query.or(excludeAuthorFilter(excludeAuthor));
  }
  const { data, error } = await query
    .order("seq", { ascending: true })
    .limit(ACCOUNT_TALLY_LIMIT);
  if (error) throw error;
  return scan(
    (data ?? []) as Array<{ channel_id: string; seq: number }>,
    ACCOUNT_TALLY_LIMIT
  );
}

/** The high-water mark of one channel. */
export interface ChannelHighWater {
  seq: number;
  at: string;
}

/**
 * Per-channel latest `(seq, created_at)` via the bounded `channels_last_message`
 * RPC.
 *
 * ⚠ **IT KEEPS `last_seq`, WHICH `repository-messages.ts › lastMessages`
 * DISCARDS.** That wrapper answers "when did this room last move" for a sidebar;
 * this one answers "what cursor names the end of this room", which is what an
 * orchestrator needs to arm an `await` — and the RPC has always returned both.
 * Two wrappers over one RPC, because widening the sidebar's return type would
 * make every one of its callers carry a field none of them reads.
 */
export async function lastSeqByChannel(
  channelIds: string[]
): Promise<Map<string, ChannelHighWater>> {
  const out = new Map<string, ChannelHighWater>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("channels_last_message", {
    p_channel_ids: channelIds,
  });
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    channel_id: string;
    last_seq: number | string;
    last_at: string;
  }>) {
    out.set(row.channel_id, { seq: Number(row.last_seq), at: row.last_at });
  }
  return out;
}

/**
 * Messages ADDRESSED to the caller — `metadata.to_user_id` is the key
 * `service-writes-metadata.ts` stamps from `to`, and the same one every
 * "· to you" tag renders from.
 *
 * ⚠ NEWEST FIRST AND BOUNDED. The caller wants what is outstanding, and an
 * unbounded scan of every request anybody ever addressed to them is a different
 * feature. A clipped answer is reported.
 */
export async function listAddressedToMe(
  channelIds: string[],
  userId: string
): Promise<AccountScan<ChannelMessageRow>> {
  if (channelIds.length === 0) return { rows: [], truncated: false };
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("*")
    .in("channel_id", channelIds)
    .eq("metadata->>to_user_id", userId)
    .order("seq", { ascending: false })
    .limit(ACCOUNT_ADDRESSED_LIMIT);
  if (error) throw error;
  return scan((data ?? []) as ChannelMessageRow[], ACCOUNT_ADDRESSED_LIMIT);
}

/**
 * The caller's OWN highest seq per channel, above `sinceSeq` — the evidence that
 * an addressed message has been answered.
 *
 * ⚠ **DESCENDING, SO THE FIRST ROW OF EACH CHANNEL IS ITS MAXIMUM**, which is
 * what makes one bounded scan answer a per-channel aggregate PostgREST cannot
 * group for us.
 * ⚠ **`sinceSeq` IS WHAT MAKES THE BOUND HONEST.** The caller passes the LOWEST
 * seq among the addressed messages being judged, so every row this can return is
 * a row that could change an answer. A clip therefore costs an extra open item,
 * never a missed one.
 */
export async function listMyLatestSeqByChannel(
  channelIds: string[],
  userId: string,
  sinceSeq: number
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (channelIds.length === 0) return out;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_messages")
    .select("channel_id, seq")
    .in("channel_id", channelIds)
    .eq("author_user_id", userId)
    .gt("seq", sinceSeq)
    .order("seq", { ascending: false })
    .limit(ACCOUNT_OWN_REPLY_LIMIT);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    channel_id: string;
    seq: number;
  }>) {
    if (!out.has(row.channel_id)) out.set(row.channel_id, Number(row.seq));
  }
  return out;
}

/**
 * The caller's own live sessions across every channel in `channelIds`.
 *
 * 🔒 **TWO FENCES, AND BOTH ARE REQUIRED.** `user_id` is the audience fence — a
 * session belongs to one member's machine and the OPERATOR-ONLY telemetry rides
 * on these rows (`collab-dto.ts › OPERATOR_ONLY_SESSION_COLUMNS`). `channel_id`
 * is the tenancy fence, and it is what replaces the `workspace_id` the
 * per-workspace read carries: without it this would answer rows for a channel
 * the caller has since left, whose membership row is gone but whose session row
 * is not.
 *
 * ⚠ It reuses `repository-sessions.ts › sessionRowsWhere` rather than restating
 * the query, because the part that must not diverge is the missing-relation
 * DEGRADE and the row BOUND, not the fence — see that function's docblock.
 */
export async function listAccountSessionStates(
  userId: string,
  channelIds: string[]
): Promise<SessionStateRow[]> {
  if (channelIds.length === 0) return [];
  return sessionRowsWhere((q) =>
    q.eq("user_id", userId).in("channel_id", channelIds)
  );
}

/**
 * Is ANY machine of this operator's heartbeating right now?
 *
 * ⚠ **THE ACCOUNT-WIDE SIBLING of `repository-collab.ts › presenceForUser`, and
 * it is a WEAKER claim on purpose.** `agent_presence` is keyed
 * `(user_id, workspace_id)`, so the per-workspace read answers "is this operator
 * present HERE". A cross-tenancy status page has no single "here", and the only
 * honest account-wide question is whether a listener of this operator's beat
 * recently — anywhere. It therefore only ever SOFTENS a quiet session row into
 * "unchanged"; it never hardens anything into a claim about a particular
 * machine. See `channel-session-render.ts › SessionRenderOpts.operatorOnline`.
 *
 * ⚠ NO ROW, NO STAMP AND AN UNREADABLE STAMP ALL READ AS OFFLINE — the fail-safe
 * direction every other presence reader picks.
 */
export async function presenceAnywhereForUser(
  userId: string,
  windowMs: number
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agent_presence")
    .select("last_seen_at")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const lastSeenAt = ((data ?? []) as Array<{ last_seen_at: string }>)[0]
    ?.last_seen_at;
  if (!lastSeenAt) return false;
  const seenAt = Date.parse(lastSeenAt);
  if (Number.isNaN(seenAt)) return false;
  return Date.now() - seenAt < windowMs;
}
